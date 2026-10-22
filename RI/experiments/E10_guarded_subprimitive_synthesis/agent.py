"""M17 (E10) — Formal Sub-Primitive DSL Synthesizer, 6-Stage Guarded Lifecycle
(Candidate -> Validation -> Adversarial Checks -> Quarantine -> Promotion -> Rollback),
and Fair Comparison Methods.
"""
from collections import Counter
from dataclasses import dataclass, field
from functools import lru_cache
import random
from statistics import mean
from typing import Any, Dict, List, Optional, Tuple

from environment import (
    CHARGES,
    COLORS,
    POSITIONS,
    SIZES,
    SubPrimitiveSpec,
    eval_combinator,
    eval_m16_base_primitive,
    eval_subprimitive_dsl,
    validate_scene_objects,
)

BINARY_COMBINATORS = ("AND", "OR", "XOR", "AND_NOT")

# Pre-registered Promotion Gate Thresholds (Fixed before running benchmarks)
PRE_REGISTERED_PROMOTION_GATE = {
    "min_train_accuracy": 0.90,
    "min_val_accuracy": 0.85,
    "min_independent_size_val_accuracy": 0.85,
    "min_gain_over_base_grammar": 0.12,
    "require_permutation_invariance": True,
    "require_non_degenerate_large_size_support": True,
    "max_surviving_distinct_alternatives": 1,
    "max_regression_drop": 0.0,
}


def build_probe_scenes(seed: int = 2027, n_probes: int = 36) -> List[List[Dict[str, int]]]:
    """Fixed unlabeled probe scenes covering N in [3..10] for canonical deduplication and ambiguity audits."""
    rng = random.Random(seed)
    probes: List[List[Dict[str, int]]] = []
    for idx in range(n_probes):
        n_obj = 3 + (idx % 8)
        objs = [
            {
                "color": rng.choice(COLORS),
                "size": rng.choice(SIZES),
                "charge": rng.choice(CHARGES),
                "pos": rng.choice(POSITIONS),
            }
            for _ in range(n_obj)
        ]
        probes.append(objs)
    return probes


CANONICAL_PROBE_SCENES = build_probe_scenes()
LARGE_PROBE_SCENES = [s for s in CANONICAL_PROBE_SCENES if len(s) >= 7]


@dataclass(frozen=True)
class CandidateRuleAST:
    """Explicit AST representing either an M16 base rule, a synthesized sub-primitive, or a composition."""

    candidate_id: str
    origin: str  # "m16_base", "synthesized_subprimitive", "memory_composition", "enumerated_composition"
    combinator: str
    left_kind: str  # "m16_base" or "subprimitive"
    left_name: str
    left_params: Dict[str, Any]
    right_kind: Optional[str] = None
    right_name: Optional[str] = None
    right_params: Optional[Dict[str, Any]] = None
    depth: int = 1
    complexity: int = 1

    def _eval_node(self, kind: str, name: str, params: Dict[str, Any], objects: List[Dict[str, int]]) -> int:
        if kind == "m16_base":
            return eval_m16_base_primitive(name, params, objects)
        if kind == "subprimitive":
            return eval_subprimitive_dsl(name, params, objects)
        raise ValueError(f"unknown node kind: {kind}")

    def predict_scene_unchecked(self, objects: List[Dict[str, int]]) -> int:
        lv = self._eval_node(self.left_kind, self.left_name, self.left_params, objects)
        if self.combinator in ("ID", "NOT"):
            return eval_combinator(self.combinator, lv)
        if self.right_kind is None or self.right_name is None or self.right_params is None:
            raise ValueError("binary combinator requires right node")
        rv = self._eval_node(self.right_kind, self.right_name, self.right_params, objects)
        return eval_combinator(self.combinator, lv, rv)

    def predict_scene(self, objects: List[Dict[str, int]]) -> int:
        validate_scene_objects(objects)
        return self.predict_scene_unchecked(objects)

    def predict_all(self, examples: List[Dict[str, Any]]) -> List[int]:
        for ex in examples:
            if "label" in ex:
                raise ValueError("test examples passed to predict_all() must not contain 'label'")
            validate_scene_objects(ex["objects"])
        return [self.predict_scene_unchecked(ex["objects"]) for ex in examples]

    def format_dsl(self) -> str:
        l_str = f"{self.left_kind}:{self.left_name}({self.left_params})"
        if self.combinator == "ID":
            return l_str
        if self.combinator == "NOT":
            return f"NOT({l_str})"
        r_str = f"{self.right_kind}:{self.right_name}({self.right_params})"
        return f"{self.combinator}({l_str}, {r_str})"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "candidate_id": self.candidate_id,
            "origin": self.origin,
            "expression": self.format_dsl(),
            "combinator": self.combinator,
            "left_kind": self.left_kind,
            "left_name": self.left_name,
            "left_params": dict(self.left_params),
            "right_kind": self.right_kind,
            "right_name": self.right_name,
            "right_params": dict(self.right_params) if self.right_params is not None else None,
            "depth": self.depth,
            "complexity": self.complexity,
        }


def truth_table_signature(cand: CandidateRuleAST, probes: List[List[Dict[str, int]]] = CANONICAL_PROBE_SCENES) -> Tuple[int, ...]:
    return tuple(cand.predict_scene_unchecked(s) for s in probes)


class SubPrimitiveSynthesizer:
    """Bounded enumerative synthesizer over the M16 base grammar and the M17 sub-primitive DSL."""

    def __init__(self, max_base_candidates: int = 160, max_dsl_candidates: int = 48, deduplicate: bool = True) -> None:
        if max_base_candidates < 1 or max_dsl_candidates < 1:
            raise ValueError("candidate budgets must be >= 1")
        self.max_base_candidates = max_base_candidates
        self.max_dsl_candidates = max_dsl_candidates
        self.deduplicate = deduplicate

    @staticmethod
    def enumerate_m16_base_primitives() -> List[Tuple[str, Dict[str, Any], int]]:
        prims: List[Tuple[str, Dict[str, Any], int]] = []
        for c in COLORS:
            for s in (4, 5, 6):
                prims.append(("exists_color_size_ge", {"color": c, "min_size": s}, 1))
        for s in (2, 3, 4):
            prims.append(("all_size_ge", {"min_size": s}, 1))
        for num, den in ((1, 3), (1, 2), (2, 3)):
            prims.append(("charge_ratio_ge", {"num": num, "den": den}, 1))
        for p in (0, 1):
            prims.append(("parity_sum_charge", {"parity": p}, 1))
        for ch in (0, 1):
            prims.append(("argmax_size_has_charge", {"charge": ch}, 2))
        for c in COLORS:
            prims.append(("argmax_size_has_color", {"color": c}, 2))
        return prims

    @staticmethod
    def enumerate_dsl_subprimitives() -> List[Tuple[str, Dict[str, Any], int]]:
        """Enumerate candidate sub-primitives from the bounded M17 DSL (depth <= 2)."""
        dsl: List[Tuple[str, Dict[str, Any], int]] = []
        # 1. Pair color size delta: exists (o1, o2) with colors (c1, c2) and o2.size - o1.size == delta
        for c1 in (0, 1):
            for c2 in (1, 2):
                if c1 == c2:
                    continue
                for delta in (1, 2, 3):
                    dsl.append(("pair_color_size_delta", {"c1": c1, "c2": c2, "delta": delta}, 2))

        # 2. Pair proximal dipole: exists same-color pair with |pos1 - pos2| <= max_gap and opposite charge
        for c in COLORS:
            for gap in (1, 2, 3):
                dsl.append(("pair_proximal_dipole", {"color": c, "max_gap": gap}, 2))

        # 3. Triad monotone size across distinct colors (0, 1, 2)
        for ch in (0, 1):
            dsl.append(("triad_monotone_size_distinct_color", {"charge": ch}, 3))

        # 4. Non-vacuous universal color charge
        for c in COLORS:
            for ch in (0, 1):
                dsl.append(("forall_color_charged", {"color": c, "charge": ch}, 2))

        # 5. Spurious / non-invariant templates in raw DSL search space (to test adversarial filtering)
        for ch in (0, 1):
            dsl.append(("spurious_slot0_charge", {"charge": ch}, 1))
        for max_cnt in (4, 5):
            for c in COLORS:
                dsl.append(("spurious_exact_count_and_color", {"max_count": max_cnt, "color": c}, 1))

        return dsl

    def generate_m16_base_grammar(self, include_depth2: bool = True) -> Tuple[List[CandidateRuleAST], int]:
        cands, dups = _cached_m16_base_grammar(self.max_base_candidates, include_depth2, self.deduplicate)
        return list(cands), dups

    def synthesize_subprimitive_candidates(self) -> Tuple[List[CandidateRuleAST], int]:
        cands, dups = _cached_dsl_subprimitives(self.max_dsl_candidates, self.deduplicate)
        return list(cands), dups


@lru_cache(maxsize=32)
def _cached_m16_base_grammar(
    max_candidates: int,
    include_depth2: bool,
    deduplicate: bool,
) -> Tuple[Tuple[CandidateRuleAST, ...], int]:
    prims = SubPrimitiveSynthesizer.enumerate_m16_base_primitives()
    raw: List[CandidateRuleAST] = []
    for idx, (name, params, comp) in enumerate(prims):
        raw.append(
            CandidateRuleAST(
                candidate_id=f"m16_d1_id_{idx}_{name}",
                origin="m16_base",
                combinator="ID",
                left_kind="m16_base",
                left_name=name,
                left_params=dict(params),
                depth=1,
                complexity=comp,
            )
        )
        raw.append(
            CandidateRuleAST(
                candidate_id=f"m16_d1_not_{idx}_{name}",
                origin="m16_base",
                combinator="NOT",
                left_kind="m16_base",
                left_name=name,
                left_params=dict(params),
                depth=1,
                complexity=comp + 1,
            )
        )
    if include_depth2:
        core = [p for p in prims if p[0] in ("exists_color_size_ge", "parity_sum_charge", "charge_ratio_ge")]
        for i, (ln, lp, lc) in enumerate(core):
            for j, (rn, rp, rc) in enumerate(core):
                if i >= j or ln == rn:
                    continue
                for op in BINARY_COMBINATORS:
                    raw.append(
                        CandidateRuleAST(
                            candidate_id=f"m16_d2_{op.lower()}_{i}_{j}",
                            origin="m16_base",
                            combinator=op,
                            left_kind="m16_base",
                            left_name=ln,
                            left_params=dict(lp),
                            right_kind="m16_base",
                            right_name=rn,
                            right_params=dict(rp),
                            depth=2,
                            complexity=lc + rc + 2,
                        )
                    )
    if not deduplicate:
        return tuple(raw[:max_candidates]), 0
    unique: List[CandidateRuleAST] = []
    seen: set = set()
    dups = 0
    for c in raw:
        sig = truth_table_signature(c)
        if sig in seen:
            dups += 1
            continue
        seen.add(sig)
        unique.append(c)
        if len(unique) >= max_candidates:
            break
    return tuple(unique), dups


@lru_cache(maxsize=32)
def _cached_dsl_subprimitives(
    max_candidates: int,
    deduplicate: bool,
) -> Tuple[Tuple[CandidateRuleAST, ...], int]:
    dsl_specs = SubPrimitiveSynthesizer.enumerate_dsl_subprimitives()
    raw: List[CandidateRuleAST] = []
    for idx, (name, params, comp) in enumerate(dsl_specs):
        param_tag = "_".join(f"{k}{v}" for k, v in sorted(params.items()))
        raw.append(
            CandidateRuleAST(
                candidate_id=f"dsl_{idx}_{name}_{param_tag}",
                origin="synthesized_subprimitive",
                combinator="ID",
                left_kind="subprimitive",
                left_name=name,
                left_params=dict(params),
                depth=1,
                complexity=comp,
            )
        )
    if not deduplicate:
        return tuple(raw[:max_candidates]), 0
    unique: List[CandidateRuleAST] = []
    seen: set = set()
    dups = 0
    for c in raw:
        sig = truth_table_signature(c)
        if sig in seen:
            dups += 1
            continue
        seen.add(sig)
        unique.append(c)
        if len(unique) >= max_candidates:
            break
    return tuple(unique), dups


# --- 6-Stage Lifecycle Records and Versioned Skill Memory ---

@dataclass
class SubPrimitiveLifecycleRecord:
    """Tracks a synthesized sub-primitive through Stages 1 to 6."""

    candidate: CandidateRuleAST
    stage: str = "candidate"  # "candidate", "validated", "quarantined", "promoted", "rolled_back"
    active: bool = False
    train_accuracy: float = 0.0
    val_accuracy: float = 0.0
    independent_size_val_accuracy: float = 0.0
    gain_over_base_grammar: float = 0.0
    permutation_invariant: Optional[bool] = None
    large_size_non_degenerate: Optional[bool] = None
    n_surviving_alternatives: int = 0
    regression_drop: float = 0.0
    quarantine_or_rejection_reasons: List[str] = field(default_factory=list)
    promoted_version: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "candidate": self.candidate.to_dict(),
            "stage": self.stage,
            "active": self.active,
            "train_accuracy": round(self.train_accuracy, 4),
            "val_accuracy": round(self.val_accuracy, 4),
            "independent_size_val_accuracy": round(self.independent_size_val_accuracy, 4),
            "gain_over_base_grammar": round(self.gain_over_base_grammar, 4),
            "permutation_invariant": self.permutation_invariant,
            "large_size_non_degenerate": self.large_size_non_degenerate,
            "n_surviving_alternatives": self.n_surviving_alternatives,
            "regression_drop": round(self.regression_drop, 4),
            "quarantine_or_rejection_reasons": list(self.quarantine_or_rejection_reasons),
            "promoted_version": self.promoted_version,
        }


@dataclass
class ActiveSkillEntry:
    skill_id: str
    version: int
    ast: CandidateRuleAST
    unit_tests: List[Dict[str, Any]]
    status: str = "active"  # "active", "rolled_back"

    def verify_unit_tests(self) -> bool:
        if not self.unit_tests:
            return False
        for ex in self.unit_tests:
            if self.ast.predict_scene_unchecked(ex["objects"]) != int(ex["label"]):
                return False
        return True


class GuardedSkillLibrary:
    """Manages Staging, Quarantine, Active Skill Memory, Compositional Synthesis, and Rollback."""

    def __init__(self) -> None:
        self.version: int = 1
        self.active_skills: List[ActiveSkillEntry] = []
        self.staging_candidates: List[SubPrimitiveLifecycleRecord] = []
        self.quarantined_records: List[SubPrimitiveLifecycleRecord] = []
        self.promoted_records: List[SubPrimitiveLifecycleRecord] = []
        self.rolled_back_records: List[SubPrimitiveLifecycleRecord] = []
        self._snapshots: List[Tuple[int, List[ActiveSkillEntry]]] = []
        self.locked_regression_baseline_scores: Dict[str, float] = {}

    def _save_snapshot(self) -> None:
        copied = [
            ActiveSkillEntry(
                skill_id=s.skill_id,
                version=s.version,
                ast=s.ast,
                unit_tests=list(s.unit_tests),
                status=s.status,
            )
            for s in self.active_skills
        ]
        self._snapshots.append((self.version, copied))

    def register_base_skill(self, skill_id: str, ast: CandidateRuleAST, unit_tests: List[Dict[str, Any]]) -> ActiveSkillEntry:
        entry = ActiveSkillEntry(
            skill_id=skill_id,
            version=self.version,
            ast=ast,
            unit_tests=list(unit_tests[:6]),
            status="active",
        )
        if not entry.verify_unit_tests():
            raise ValueError(f"base skill '{skill_id}' failed unit tests")
        self.active_skills.append(entry)
        return entry

    def stage_candidate(self, cand: CandidateRuleAST, train_acc: float) -> SubPrimitiveLifecycleRecord:
        """Stage 1 (Candidate): Create inactive lifecycle record in staging without touching active_skills."""
        rec = SubPrimitiveLifecycleRecord(
            candidate=cand,
            stage="candidate",
            active=False,
            train_accuracy=train_acc,
        )
        self.staging_candidates.append(rec)
        return rec

    def quarantine_candidate(self, rec: SubPrimitiveLifecycleRecord, reasons: List[str]) -> None:
        """Stage 4 (Quarantine): Isolate ambiguous, unstable, or failed candidate."""
        rec.stage = "quarantined"
        rec.active = False
        rec.quarantine_or_rejection_reasons.extend(reasons)
        self.quarantined_records.append(rec)

    def promote_candidate(
        self,
        rec: SubPrimitiveLifecycleRecord,
        unit_tests: List[Dict[str, Any]],
    ) -> ActiveSkillEntry:
        """Stage 5 (Promotion): Snapshot current state and promote verified candidate to active SkillMemory."""
        if rec.quarantine_or_rejection_reasons:
            raise ValueError("cannot promote a candidate that has rejection or quarantine reasons")
        self._save_snapshot()
        self.version += 1
        rec.stage = "promoted"
        rec.active = True
        rec.promoted_version = self.version
        skill_id = f"promoted_v{self.version}_{rec.candidate.candidate_id}"
        entry = ActiveSkillEntry(
            skill_id=skill_id,
            version=self.version,
            ast=rec.candidate,
            unit_tests=list(unit_tests[:6]),
            status="active",
        )
        if not entry.verify_unit_tests():
            # Restore snapshot immediately if unit tests fail.
            _, prev_skills = self._snapshots.pop()
            self.active_skills = prev_skills
            self.version -= 1
            raise ValueError("promoted candidate failed unit test verification")
        self.active_skills.append(entry)
        self.promoted_records.append(rec)
        return entry

    def rollback(self) -> int:
        """Stage 6 (Rollback): Restore active_skills and version to the last snapshot before the latest promotion."""
        if not self._snapshots:
            raise ValueError("no snapshot available for rollback")
        prev_version, prev_skills = self._snapshots.pop()
        if self.promoted_records:
            last_prom = self.promoted_records.pop()
            last_prom.stage = "rolled_back"
            last_prom.active = False
            self.rolled_back_records.append(last_prom)
        self.active_skills = prev_skills
        self.version = prev_version
        return self.version

    def synthesize_memory_compositions(self) -> List[CandidateRuleAST]:
        """Compose active sub-primitive skills with active base skills using binary combinators."""
        active = [s for s in self.active_skills if s.status == "active" and s.verify_unit_tests()]
        direct = [s.ast for s in active]
        composed: List[CandidateRuleAST] = []
        sub_skills = [s for s in active if s.ast.left_kind == "subprimitive" and s.ast.depth == 1]
        base_skills = [s for s in active if s.ast.left_kind == "m16_base" and s.ast.depth == 1]

        for s_sub in sub_skills:
            for s_base in base_skills:
                for op in BINARY_COMBINATORS:
                    composed.append(
                        CandidateRuleAST(
                            candidate_id=f"mem_comp_{op}({s_sub.skill_id},{s_base.skill_id})",
                            origin="memory_composition",
                            combinator=op,
                            left_kind=s_sub.ast.left_kind,
                            left_name=s_sub.ast.left_name,
                            left_params=dict(s_sub.ast.left_params),
                            right_kind=s_base.ast.left_kind,
                            right_name=s_base.ast.left_name,
                            right_params=dict(s_base.ast.left_params),
                            depth=2,
                            complexity=s_sub.ast.complexity + s_base.ast.complexity + 1,
                        )
                    )
        return direct + composed


# --- Adversarial & Structural Invariance Audits (Stage 3) ---

def check_permutation_invariance(
    cand: CandidateRuleAST,
    scenes: List[List[Dict[str, int]]] = CANONICAL_PROBE_SCENES,
    seed: int = 909,
) -> bool:
    """Verify that shuffling object order in scenes never alters the candidate's output."""
    rng = random.Random(seed)
    for scene in scenes:
        orig_pred = cand.predict_scene_unchecked(scene)
        for _ in range(3):
            shuffled = list(scene)
            rng.shuffle(shuffled)
            if cand.predict_scene_unchecked(shuffled) != orig_pred:
                return False
    return True


def check_large_size_support(
    cand: CandidateRuleAST,
    large_scenes: List[List[Dict[str, int]]] = LARGE_PROBE_SCENES,
) -> bool:
    """Verify that the candidate does not collapse to a constant 0 or 1 across all large scenes (N >= 7)."""
    preds = {cand.predict_scene_unchecked(s) for s in large_scenes}
    return len(preds) > 1


class M17GuardedSynthesizerAgent:
    """Configurable agent supporting the full M17 6-stage pipeline and all comparison ablations."""

    def __init__(
        self,
        allow_subprimitive_synthesis: bool = True,
        use_skill_memory: bool = True,
        use_validation_guard: bool = True,
        use_adversarial_checks: bool = True,
        max_base_candidates: int = 160,
        max_dsl_candidates: int = 48,
        seed: int = 0,
    ) -> None:
        self.allow_subprimitive_synthesis = allow_subprimitive_synthesis
        self.use_skill_memory = use_skill_memory
        self.use_validation_guard = use_validation_guard
        self.use_adversarial_checks = use_adversarial_checks
        self.max_base_candidates = max_base_candidates
        self.max_dsl_candidates = max_dsl_candidates
        self.seed = seed

        self.synthesizer = SubPrimitiveSynthesizer(
            max_base_candidates=max_base_candidates,
            max_dsl_candidates=max_dsl_candidates,
            deduplicate=True,
        )
        self.library = GuardedSkillLibrary()

    @staticmethod
    def _accuracy(cand: CandidateRuleAST, examples: List[Dict[str, Any]]) -> float:
        if not examples:
            return 0.0
        return sum(
            1 for e in examples if cand.predict_scene_unchecked(e["objects"]) == int(e["label"])
        ) / len(examples)

    def lock_regression_suite(self, regression_tasks: List[Dict[str, Any]]) -> Dict[str, float]:
        base_cands, _ = self.synthesizer.generate_m16_base_grammar(include_depth2=True)
        scores: Dict[str, float] = {}
        for r_task in regression_tasks:
            best = max(base_cands, key=lambda c: (self._accuracy(c, r_task["train_examples"]), -c.complexity))
            scores[r_task["task_id"]] = self._accuracy(best, r_task["test_examples"])
        self.library.locked_regression_baseline_scores = dict(scores)
        return scores

    def compute_regression_drop(self, regression_tasks: List[Dict[str, Any]], extra_cand: Optional[CandidateRuleAST] = None) -> float:
        if not regression_tasks:
            return 0.0
        base_cands, _ = self.synthesizer.generate_m16_base_grammar(include_depth2=True)
        mem_cands = self.library.synthesize_memory_compositions() if self.use_skill_memory else []
        pool = list(base_cands) + mem_cands + ([extra_cand] if extra_cand is not None else [])
        drops: List[float] = []
        for r_task in regression_tasks:
            tid = r_task["task_id"]
            baseline_acc = self.library.locked_regression_baseline_scores.get(tid, 1.0)
            best = max(pool, key=lambda c: (self._accuracy(c, r_task["train_examples"]), -c.complexity))
            curr_acc = self._accuracy(best, r_task["test_examples"])
            drops.append(max(0.0, baseline_acc - curr_acc))
        return max(drops) if drops else 0.0

    def acquire_warmup_base_skills(self, warmup_tasks: List[Dict[str, Any]]) -> int:
        if not self.use_skill_memory:
            return 0
        base_d1, _ = self.synthesizer.generate_m16_base_grammar(include_depth2=False)
        count = 0
        for w_task in warmup_tasks:
            best = max(
                base_d1,
                key=lambda c: (
                    0.5 * self._accuracy(c, w_task["train_examples"])
                    + 0.5 * self._accuracy(c, w_task["val_examples"]),
                    -c.complexity,
                ),
            )
            self.library.register_base_skill(w_task["skill_id"], best, w_task["train_examples"][:6])
            count += 1
        return count

    def solve_task(
        self,
        task: Dict[str, Any],
        regression_tasks: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        train_ex = task["train_examples"]
        val_ex = task["val_examples"]
        ind_size_val_ex = task["independent_size_val_examples"]
        if not train_ex or not val_ex or not ind_size_val_ex:
            raise ValueError("train, val, and independent_size_val splits must not be empty")

        gate = PRE_REGISTERED_PROMOTION_GATE

        # Step A: Evaluate existing active grammar (M16 base grammar + active SkillMemory compositions).
        base_cands, n_base_dedup = self.synthesizer.generate_m16_base_grammar(include_depth2=True)
        mem_cands = self.library.synthesize_memory_compositions() if self.use_skill_memory else []
        initial_pool = mem_cands + base_cands

        def score_initial(c: CandidateRuleAST) -> Tuple[float, float, int, str]:
            tr = self._accuracy(c, train_ex)
            vl = 0.5 * self._accuracy(c, val_ex) + 0.5 * self._accuracy(c, ind_size_val_ex)
            bonus = 0.02 if c.origin == "memory_composition" else 0.0
            comb = (0.6 * tr + 0.4 * vl if self.use_validation_guard else tr) + bonus - 0.005 * c.complexity
            return (round(comb, 6), round(tr, 6), -c.complexity, c.candidate_id)

        best_base = max(initial_pool, key=score_initial)
        base_train_acc = self._accuracy(best_base, train_ex)
        base_val_acc = 0.5 * self._accuracy(best_base, val_ex) + 0.5 * self._accuracy(best_base, ind_size_val_ex)

        # If sub-primitive synthesis is disabled OR existing grammar/memory compositions already solve the task:
        if not self.allow_subprimitive_synthesis or (
            base_train_acc >= gate["min_train_accuracy"] and base_val_acc >= gate["min_val_accuracy"]
        ):
            return {
                "selected_candidate": best_base,
                "used_memory_composition": best_base.origin == "memory_composition",
                "synthesis_triggered": False,
                "n_synthesized_candidates": 0,
                "n_validated_candidates": 0,
                "n_total_candidates_evaluated": len(initial_pool),
                "lifecycle_record": None,
                "promoted": False,
                "quarantined": False,
                "status": "solved_by_active_grammar" if base_val_acc >= gate["min_val_accuracy"] else "unsolved_base_grammar",
            }

        # Step B: Trigger Guarded Sub-Primitive Synthesis (6-Stage Admission Pipeline).
        dsl_cands, _ = self.synthesizer.synthesize_subprimitive_candidates()
        if not self.use_skill_memory:
            # Enumerative baseline without SkillMemory also enumerates binary combinations of DSL + base primitives
            # if solving a compositional task, up to a bounded cap.
            extra_enum: List[CandidateRuleAST] = []
            base_d1, _ = self.synthesizer.generate_m16_base_grammar(include_depth2=False)
            for d_cand in dsl_cands[:18]:
                for b_cand in base_d1[:8]:
                    for op in ("AND", "XOR"):
                        extra_enum.append(
                            CandidateRuleAST(
                                candidate_id=f"enum_comp_{op}({d_cand.candidate_id},{b_cand.candidate_id})",
                                origin="enumerated_composition",
                                combinator=op,
                                left_kind=d_cand.left_kind,
                                left_name=d_cand.left_name,
                                left_params=dict(d_cand.left_params),
                                right_kind=b_cand.left_kind,
                                right_name=b_cand.left_name,
                                right_params=dict(b_cand.left_params),
                                depth=2,
                                complexity=d_cand.complexity + b_cand.complexity + 1,
                            )
                        )
            dsl_pool = list(dsl_cands) + extra_enum[:60]
        else:
            dsl_pool = list(dsl_cands)

        n_synthesized = len(dsl_pool)

        # Stage 1: Candidate selection on training split (inactive in staging buffer).
        train_scored = []
        for cand in dsl_pool:
            tr_acc = self._accuracy(cand, train_ex)
            train_scored.append((tr_acc, -cand.complexity, cand))
        train_scored.sort(key=lambda x: (x[0], x[1], x[2].candidate_id), reverse=True)

        # Identify all candidates meeting min_train_accuracy (or top candidate if none meet threshold).
        passing_train = [item[2] for item in train_scored if item[0] >= gate["min_train_accuracy"]]
        top_train_acc, _, top_dsl_cand = train_scored[0]
        rec = self.library.stage_candidate(top_dsl_cand, train_acc=top_train_acc)

        reasons: List[str] = []
        if top_train_acc < gate["min_train_accuracy"]:
            reasons.append(f"train_accuracy {top_train_acc:.3f} < {gate['min_train_accuracy']:.3f}")

        # Stage 2: Independent Validation Check.
        n_validated = len(passing_train) if passing_train else 1
        if self.use_validation_guard:
            # Re-rank candidates that passed training using validation accuracy.
            val_candidates = passing_train if passing_train else [top_dsl_cand]
            val_scored = []
            for c in val_candidates:
                tr_a = self._accuracy(c, train_ex)
                vl_a = self._accuracy(c, val_ex)
                sz_a = self._accuracy(c, ind_size_val_ex)
                mean_score = (tr_a + vl_a + sz_a) / 3.0
                val_scored.append((round(mean_score, 6), round(vl_a, 6), round(sz_a, 6), round(tr_a, 6), -c.complexity, c))
            val_scored.sort(key=lambda x: (x[0], x[1], x[2], x[4], x[5].candidate_id), reverse=True)
            best_mean, best_vl, best_sz, best_tr, _, chosen_cand = val_scored[0]

            # Update staged record to the validation-selected candidate.
            rec.candidate = chosen_cand
            rec.train_accuracy = best_tr
            rec.val_accuracy = best_vl
            rec.independent_size_val_accuracy = best_sz
            rec.gain_over_base_grammar = 0.5 * (best_vl + best_sz) - base_val_acc

            if best_vl < gate["min_val_accuracy"]:
                reasons.append(f"val_accuracy {best_vl:.3f} < {gate['min_val_accuracy']:.3f}")
            if best_sz < gate["min_independent_size_val_accuracy"]:
                reasons.append(
                    f"independent_size_val_accuracy {best_sz:.3f} < {gate['min_independent_size_val_accuracy']:.3f}"
                )
            if rec.gain_over_base_grammar < gate["min_gain_over_base_grammar"]:
                reasons.append(
                    f"gain_over_base_grammar {rec.gain_over_base_grammar:.3f} < {gate['min_gain_over_base_grammar']:.3f}"
                )

            # Candidates that explain the observations equally well as the top candidate:
            surviving_val = [
                item[5]
                for item in val_scored
                if abs(item[0] - best_mean) < 1e-6
            ]
        else:
            # Validation guard disabled: evaluate metrics for logging, but do not filter or reject on them.
            rec.val_accuracy = self._accuracy(rec.candidate, val_ex)
            rec.independent_size_val_accuracy = self._accuracy(rec.candidate, ind_size_val_ex)
            rec.gain_over_base_grammar = rec.train_accuracy - base_train_acc
            surviving_val = [
                item[2] for item in train_scored if abs(item[0] - top_train_acc) < 1e-6
            ]

        # Stage 3: Adversarial & Structural Invariance Checks.
        if self.use_adversarial_checks:
            # Filter surviving validation candidates by permutation invariance and large-size non-degeneracy.
            invariant_survivors: List[CandidateRuleAST] = []
            for c in surviving_val:
                if check_permutation_invariance(c) and check_large_size_support(c):
                    invariant_survivors.append(c)

            # If the top validation candidate failed invariance but another validation-passing candidate is invariant,
            # check whether an invariant survivor exists; otherwise record the invariance failure on rec.candidate.
            perm_ok = check_permutation_invariance(rec.candidate)
            size_ok = check_large_size_support(rec.candidate)
            rec.permutation_invariant = perm_ok
            rec.large_size_non_degenerate = size_ok

            if not perm_ok:
                reasons.append("failed_permutation_invariance_audit")
            if not size_ok:
                reasons.append("failed_large_size_non_degeneracy_audit")

            # Count functionally distinct invariant survivors on CANONICAL_PROBE_SCENES.
            distinct_sigs = {truth_table_signature(c) for c in invariant_survivors}
            rec.n_surviving_alternatives = len(distinct_sigs)
            if len(distinct_sigs) > gate["max_surviving_distinct_alternatives"]:
                reasons.append(
                    f"ambiguous_alternative_rules ({len(distinct_sigs)} distinct candidates tied on train+val)"
                )

            # Check regression drop on locked M16 tasks.
            reg_drop = self.compute_regression_drop(regression_tasks or [], extra_cand=rec.candidate)
            rec.regression_drop = reg_drop
            if reg_drop > gate["max_regression_drop"]:
                reasons.append(f"regression_drop_on_locked_tasks {reg_drop:.3f} > 0.0")
        else:
            rec.permutation_invariant = check_permutation_invariance(rec.candidate)
            rec.large_size_non_degenerate = check_large_size_support(rec.candidate)
            rec.n_surviving_alternatives = 1
            rec.regression_drop = 0.0

        # Stage 4 & 5: Quarantine vs. Promotion Decision.
        if reasons:
            self.library.quarantine_candidate(rec, reasons)
            # Fall back to best verified active grammar candidate when synthesis is quarantined!
            return {
                "selected_candidate": best_base,
                "used_memory_composition": best_base.origin == "memory_composition",
                "synthesis_triggered": True,
                "n_synthesized_candidates": n_synthesized,
                "n_validated_candidates": n_validated,
                "n_total_candidates_evaluated": len(initial_pool) + n_synthesized,
                "lifecycle_record": rec,
                "promoted": False,
                "quarantined": True,
                "status": "quarantined_fallback_to_base",
            }

        # Promote verified candidate into active SkillMemory (if use_skill_memory is enabled).
        if self.use_skill_memory and rec.candidate.depth == 1:
            self.library.promote_candidate(rec, unit_tests=train_ex[:6])
        else:
            rec.stage = "promoted"
            rec.active = True
            self.library.promoted_records.append(rec)

        return {
            "selected_candidate": rec.candidate,
            "used_memory_composition": False,
            "synthesis_triggered": True,
            "n_synthesized_candidates": n_synthesized,
            "n_validated_candidates": n_validated,
            "n_total_candidates_evaluated": len(initial_pool) + n_synthesized,
            "lifecycle_record": rec,
            "promoted": True,
            "quarantined": False,
            "status": "promoted_new_subprimitive",
        }


class MajorityReferenceBaseline:
    """5. Simple Majority / Random Reference Baseline."""

    def __init__(self, seed: int = 0) -> None:
        self.seed = seed
        self.majority_label: int = 0

    def fit(self, train_examples: List[Dict[str, Any]]) -> "MajorityReferenceBaseline":
        if not train_examples:
            raise ValueError("train_examples must not be empty")
        counts = Counter(int(e["label"]) for e in train_examples)
        self.majority_label = min(counts, key=lambda k: (-counts[k], k))
        return self

    def predict_all(self, unlabeled_examples: List[Dict[str, Any]]) -> List[int]:
        for ex in unlabeled_examples:
            if "label" in ex:
                raise ValueError("test examples passed to predict_all() must not contain 'label'")
        return [self.majority_label for _ in unlabeled_examples]
