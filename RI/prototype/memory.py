"""Steps 5 & 8 (and M11) — Versioned Skill Memory, Reuse, I/O Contracts, Composition, and Quarantine."""
from dataclasses import dataclass, field
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from .candidates import CandidateHypothesis
from .task import ensure_no_secrets


@dataclass(frozen=True)
class IOContract:
    input_schema: Dict[str, str] = field(
        default_factory=lambda: {"x": "int[0,7]", "y": "int[0,7]"}
    )
    preconditions: Tuple[str, ...] = ("0 <= x <= 7", "0 <= y <= 7")
    output_schema: str = "int{0,1}"

    def is_compatible_with(self, other: "IOContract") -> bool:
        return (
            self.input_schema == other.input_schema
            and self.output_schema == "int{0,1}"
            and other.output_schema == "int{0,1}"
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "input_schema": dict(self.input_schema),
            "preconditions": list(self.preconditions),
            "output_schema": self.output_schema,
        }


@dataclass
class SkillRecord:
    skill_id: str
    name: str
    version: int
    purpose: str
    family: str
    action_name: str
    parameters: Dict[str, Any]
    contract: IOContract
    unit_tests: List[Dict[str, int]]
    validation_metrics: Dict[str, float]
    status: str = "active"  # "active", "quarantined", "superseded", "rolled_back"
    usage_count: int = 0
    success_count: int = 0
    failure_count: int = 0
    parent_version: Optional[int] = None
    component_skills: Tuple[str, ...] = field(default_factory=tuple)
    known_limitations: List[str] = field(
        default_factory=lambda: [
            "Bounded to discrete 8x8 integer coordinate grid.",
            "Rule is deterministic and does not adapt online without explicit re-selection.",
        ]
    )

    @property
    def success_rate(self) -> float:
        if self.usage_count == 0:
            return float(self.validation_metrics.get("held_out_accuracy", 0.0))
        return self.success_count / self.usage_count

    def to_candidate(self, source: str = "memory_reuse") -> CandidateHypothesis:
        complexity = 3 if self.family == "composed_and" else (2 if self.family in ("mod_sum", "coord_box") else 1)
        return CandidateHypothesis(
            candidate_id=f"{self.skill_id}@v{self.version}",
            family=self.family,
            action_name=self.action_name,
            parameters=dict(self.parameters),
            complexity=complexity,
            source=source,
            component_skills=self.component_skills,
        )

    def run_unit_tests(self) -> bool:
        if not self.unit_tests:
            return False
        cand = self.to_candidate()
        for case in self.unit_tests:
            if cand.predict_one(case["x"], case["y"]) != case["label"]:
                return False
        return True

    def to_dict(self) -> Dict[str, Any]:
        return {
            "skill_id": self.skill_id,
            "name": self.name,
            "version": self.version,
            "purpose": self.purpose,
            "family": self.family,
            "action_name": self.action_name,
            "parameters": dict(self.parameters),
            "contract": self.contract.to_dict(),
            "unit_tests": list(self.unit_tests),
            "validation_metrics": {k: round(v, 4) for k, v in self.validation_metrics.items()},
            "status": self.status,
            "usage_count": self.usage_count,
            "success_count": self.success_count,
            "failure_count": self.failure_count,
            "success_rate": round(self.success_rate, 4),
            "parent_version": self.parent_version,
            "component_skills": list(self.component_skills),
            "known_limitations": list(self.known_limitations),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SkillRecord":
        c_dict = data.get("contract", {})
        contract = IOContract(
            input_schema=dict(c_dict.get("input_schema", {"x": "int[0,7]", "y": "int[0,7]"})),
            preconditions=tuple(c_dict.get("preconditions", ("0 <= x <= 7", "0 <= y <= 7"))),
            output_schema=str(c_dict.get("output_schema", "int{0,1}")),
        )
        return cls(
            skill_id=data["skill_id"],
            name=data["name"],
            version=int(data["version"]),
            purpose=data["purpose"],
            family=data["family"],
            action_name=data["action_name"],
            parameters=dict(data["parameters"]),
            contract=contract,
            unit_tests=list(data["unit_tests"]),
            validation_metrics=dict(data["validation_metrics"]),
            status=data.get("status", "active"),
            usage_count=int(data.get("usage_count", 0)),
            success_count=int(data.get("success_count", 0)),
            failure_count=int(data.get("failure_count", 0)),
            parent_version=data.get("parent_version"),
            component_skills=tuple(data.get("component_skills", ())),
            known_limitations=list(data.get("known_limitations", [])),
        )


class SkillMemory:
    """Versioned skill store supporting unit-test gating, reuse, composition, quarantine, and rollback."""

    def __init__(self, storage_path: Optional[Path] = None, quarantine_failure_threshold: int = 2) -> None:
        self.storage_path = Path(storage_path) if storage_path is not None else None
        self.quarantine_failure_threshold = quarantine_failure_threshold
        self._versions: Dict[str, List[SkillRecord]] = {}
        if self.storage_path and self.storage_path.is_file():
            self.load()

    def register_skill(
        self,
        skill_id: str,
        name: str,
        purpose: str,
        candidate: CandidateHypothesis,
        unit_tests: List[Dict[str, int]],
        validation_metrics: Dict[str, float],
        min_held_out_accuracy: float = 0.85,
    ) -> SkillRecord:
        ensure_no_secrets(f"{skill_id} {name} {purpose} {candidate.parameters}")
        if validation_metrics.get("held_out_accuracy", 0.0) < min_held_out_accuracy:
            raise ValueError("cannot register skill below min_held_out_accuracy gate")

        existing = self._versions.get(skill_id, [])
        # If an identical active skill with same family and parameters already exists, return it.
        for rec in reversed(existing):
            if rec.status == "active" and rec.family == candidate.family and rec.parameters == candidate.parameters:
                return rec

        next_version = len(existing) + 1
        parent_version = existing[-1].version if existing else None

        record = SkillRecord(
            skill_id=skill_id,
            name=name,
            version=next_version,
            purpose=purpose,
            family=candidate.family,
            action_name=candidate.action_name,
            parameters=dict(candidate.parameters),
            contract=IOContract(),
            unit_tests=list(unit_tests[:8]),
            validation_metrics=dict(validation_metrics),
            status="active",
            parent_version=parent_version,
            component_skills=candidate.component_skills,
        )
        if not record.run_unit_tests():
            raise ValueError(f"skill '{skill_id}' v{next_version} failed its own unit tests before activation")

        for prev in existing:
            if prev.status == "active":
                prev.status = "superseded"
        self._versions.setdefault(skill_id, []).append(record)
        self._persist()
        return record

    def active_skills(self) -> List[SkillRecord]:
        result: List[SkillRecord] = []
        for versions in self._versions.values():
            for rec in reversed(versions):
                if rec.status == "active":
                    result.append(rec)
                    break
        return result

    def get_skill(self, skill_id: str, version: Optional[int] = None) -> Optional[SkillRecord]:
        versions = self._versions.get(skill_id, [])
        if not versions:
            return None
        if version is not None:
            for rec in versions:
                if rec.version == version:
                    return rec
            return None
        for rec in reversed(versions):
            if rec.status == "active":
                return rec
        return versions[-1]

    def find_reusable_candidates(
        self,
        allowed_actions: Tuple[str, ...],
        include_compositions: bool = True,
    ) -> List[CandidateHypothesis]:
        """Return active, unit-test-verified skills and valid compositions matching allowed actions."""
        allowed = set(allowed_actions)
        active = [
            s for s in self.active_skills()
            if s.action_name in allowed and s.run_unit_tests()
        ]
        active.sort(key=lambda s: (-s.success_rate, -s.usage_count, s.skill_id))
        candidates = [s.to_candidate(source="memory_reuse") for s in active]

        if include_compositions and "predict_composed" in allowed:
            sum_skills = [s for s in active if s.family == "sum_threshold"]
            parity_skills = [s for s in active if s.family == "parity"]
            for s_sum in sum_skills:
                for s_par in parity_skills:
                    composed = self.compose_skills(s_sum, s_par)
                    candidates.append(composed)
        return candidates

    def compose_skills(self, sum_skill: SkillRecord, parity_skill: SkillRecord) -> CandidateHypothesis:
        """Compose a sum_threshold skill and a parity skill after checking I/O contracts."""
        if sum_skill.status != "active" or parity_skill.status != "active":
            raise ValueError("only active skills can be composed")
        if not sum_skill.contract.is_compatible_with(parity_skill.contract):
            raise ValueError("incompatible skill contracts for composition")
        if sum_skill.family != "sum_threshold" or parity_skill.family != "parity":
            raise ValueError("compose_skills requires (sum_threshold, parity) skills")
        t = int(sum_skill.parameters["threshold"])
        p = int(parity_skill.parameters["parity"])
        comp_id = f"composed({sum_skill.skill_id}@v{sum_skill.version},{parity_skill.skill_id}@v{parity_skill.version})"
        return CandidateHypothesis(
            candidate_id=comp_id,
            family="composed_and",
            action_name="predict_composed",
            parameters={"threshold": t, "parity": p},
            complexity=3,
            source="memory_composition",
            component_skills=(
                f"{sum_skill.skill_id}@v{sum_skill.version}",
                f"{parity_skill.skill_id}@v{parity_skill.version}",
            ),
        )

    def record_outcome(self, candidate: CandidateHypothesis, passed: bool) -> None:
        """Update usage/success counters and quarantine skills that repeatedly fail."""
        target_ids: List[Tuple[str, int]] = []
        if "@" in candidate.candidate_id and not candidate.candidate_id.startswith("composed("):
            sid, ver = candidate.candidate_id.split("@v", 1)
            target_ids.append((sid, int(ver)))
        for comp_ref in candidate.component_skills:
            if "@v" in comp_ref:
                sid, ver = comp_ref.split("@v", 1)
                target_ids.append((sid, int(ver)))

        for sid, ver in target_ids:
            rec = self.get_skill(sid, version=ver)
            if rec is None:
                continue
            rec.usage_count += 1
            if passed:
                rec.success_count += 1
            else:
                rec.failure_count += 1
                if rec.failure_count >= self.quarantine_failure_threshold and rec.status == "active":
                    rec.status = "quarantined"
        self._persist()

    def rollback_skill(self, skill_id: str) -> SkillRecord:
        """Roll back the current active/quarantined version of skill_id to its previous version."""
        versions = self._versions.get(skill_id, [])
        if len(versions) < 2:
            raise ValueError(f"skill '{skill_id}' has no previous version to roll back to")
        current = versions[-1]
        previous = versions[-2]
        if not previous.run_unit_tests():
            raise ValueError(f"previous version v{previous.version} failed unit tests")
        current.status = "rolled_back"
        previous.status = "active"
        self._persist()
        return previous

    def summary(self) -> Dict[str, Any]:
        all_records = [rec for versions in self._versions.values() for rec in versions]
        return {
            "total_skill_lineages": len(self._versions),
            "total_versions": len(all_records),
            "active_skills": len(self.active_skills()),
            "quarantined_skills": sum(1 for r in all_records if r.status == "quarantined"),
            "rolled_back_skills": sum(1 for r in all_records if r.status == "rolled_back"),
            "skills": [r.to_dict() for r in all_records],
        }

    def _persist(self) -> None:
        if self.storage_path is None:
            return
        payload = json.dumps(self.summary(), indent=2) + "\n"
        ensure_no_secrets(payload)
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        self.storage_path.write_text(payload, encoding="utf-8")

    def load(self) -> None:
        if self.storage_path is None or not self.storage_path.is_file():
            return
        raw = self.storage_path.read_text(encoding="utf-8")
        ensure_no_secrets(raw)
        data = json.loads(raw)
        self._versions.clear()
        for item in data.get("skills", []):
            rec = SkillRecord.from_dict(item)
            self._versions.setdefault(rec.skill_id, []).append(rec)
