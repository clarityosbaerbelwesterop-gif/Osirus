"""Step 3 — Candidate Generation and Baselines within a bounded action space."""
from collections import Counter
from dataclasses import dataclass, field
import random
from typing import Any, Dict, List, Optional, Tuple


@dataclass(frozen=True)
class CandidateHypothesis:
    candidate_id: str
    family: str
    action_name: str
    parameters: Dict[str, Any]
    complexity: int = 1
    source: str = "enumerated"
    component_skills: Tuple[str, ...] = field(default_factory=tuple)

    @staticmethod
    def eval_primitive(family: str, parameters: Dict[str, Any], x: int, y: int) -> int:
        if family == "sum_threshold":
            return int(x + y >= int(parameters["threshold"]))
        if family == "diff_threshold":
            return int(x - y >= int(parameters["threshold"]))
        if family == "parity":
            return int((x + y) % 2 == int(parameters["parity"]))
        if family == "mod_sum":
            m = int(parameters["modulus"])
            r = int(parameters["remainder"])
            return int((x + y) % m == r)
        if family == "coord_box":
            return int(x >= int(parameters["min_x"]) and y >= int(parameters["min_y"]))
        raise ValueError(f"unsupported primitive family: {family}")

    @staticmethod
    def apply_operator(operator: str, left_val: int, right_val: int) -> int:
        if operator == "AND":
            return int(left_val == 1 and right_val == 1)
        if operator == "OR":
            return int(left_val == 1 or right_val == 1)
        if operator == "XOR":
            return int(left_val != right_val)
        if operator == "AND_NOT":
            return int(left_val == 1 and right_val == 0)
        raise ValueError(f"unsupported compositional operator: {operator}")

    def predict_one(self, x: int, y: int) -> int:
        if self.family in ("sum_threshold", "diff_threshold", "parity", "mod_sum", "coord_box"):
            return self.eval_primitive(self.family, self.parameters, x, y)
        if self.family == "composed_and":
            t = int(self.parameters["threshold"])
            p = int(self.parameters["parity"])
            return int((x + y >= t) and ((x + y) % 2 == p))
        if self.family == "composed_op":
            op = str(self.parameters["operator"])
            left_val = self.eval_primitive(
                str(self.parameters["left_family"]),
                dict(self.parameters["left_params"]),
                x,
                y,
            )
            right_val = self.eval_primitive(
                str(self.parameters["right_family"]),
                dict(self.parameters["right_params"]),
                x,
                y,
            )
            return self.apply_operator(op, left_val, right_val)
        raise ValueError(f"unsupported candidate family: {self.family}")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "candidate_id": self.candidate_id,
            "family": self.family,
            "action_name": self.action_name,
            "parameters": dict(self.parameters),
            "complexity": self.complexity,
            "source": self.source,
            "component_skills": list(self.component_skills),
        }


class CandidateGenerator:
    """Generate bounded, allow-listed candidate hypotheses."""

    def generate(
        self,
        allowed_actions: Tuple[str, ...],
        include_composed: bool = False,
        extra_families: Optional[List[str]] = None,
    ) -> List[CandidateHypothesis]:
        candidates: List[CandidateHypothesis] = []
        allowed = set(allowed_actions)
        enabled_families = set(extra_families or ("sum_threshold", "parity", "diff_threshold", "coord_box"))

        if "predict_sum_threshold" in allowed and "sum_threshold" in enabled_families:
            for t in range(0, 15):
                candidates.append(
                    CandidateHypothesis(
                        candidate_id=f"cand_sum_ge_{t}",
                        family="sum_threshold",
                        action_name="predict_sum_threshold",
                        parameters={"threshold": t},
                        complexity=1,
                    )
                )

        if "predict_parity" in allowed and "parity" in enabled_families:
            for p in (0, 1):
                candidates.append(
                    CandidateHypothesis(
                        candidate_id=f"cand_parity_{p}",
                        family="parity",
                        action_name="predict_parity",
                        parameters={"parity": p},
                        complexity=1,
                    )
                )

        if "predict_diff_threshold" in allowed and "diff_threshold" in enabled_families:
            for d in range(-7, 8):
                candidates.append(
                    CandidateHypothesis(
                        candidate_id=f"cand_diff_ge_{d}",
                        family="diff_threshold",
                        action_name="predict_diff_threshold",
                        parameters={"threshold": d},
                        complexity=1,
                    )
                )

        if "predict_mod_sum" in allowed and "mod_sum" in enabled_families:
            for modulus in (3, 4):
                for rem in range(modulus):
                    candidates.append(
                        CandidateHypothesis(
                            candidate_id=f"cand_mod_{modulus}_rem_{rem}",
                            family="mod_sum",
                            action_name="predict_mod_sum",
                            parameters={"modulus": modulus, "remainder": rem},
                            complexity=2,
                        )
                    )

        if "predict_coord_box" in allowed and "coord_box" in enabled_families:
            for tx in range(1, 6):
                for ty in range(1, 6):
                    candidates.append(
                        CandidateHypothesis(
                            candidate_id=f"cand_box_x{tx}_y{ty}",
                            family="coord_box",
                            action_name="predict_coord_box",
                            parameters={"min_x": tx, "min_y": ty},
                            complexity=2,
                        )
                    )

        if include_composed and "predict_composed" in allowed:
            for t in range(3, 11):
                for p in (0, 1):
                    candidates.append(
                        CandidateHypothesis(
                            candidate_id=f"cand_composed_sum_{t}_and_parity_{p}",
                            family="composed_and",
                            action_name="predict_composed",
                            parameters={"threshold": t, "parity": p},
                            complexity=3,
                        )
                    )

        return candidates


class MajorityBaselineModel:
    """Predicts the majority label observed in development examples (tie-break to 0)."""

    def __init__(self) -> None:
        self.label: Optional[int] = None

    def fit(self, examples: List[Dict[str, int]]) -> "MajorityBaselineModel":
        if not examples:
            raise ValueError("examples must not be empty")
        counts = Counter(e["label"] for e in examples)
        self.label = min(counts, key=lambda k: (-counts[k], k))
        return self

    def predict(self, examples: List[Dict[str, int]]) -> List[int]:
        if self.label is None:
            raise RuntimeError("fit must be called before predict")
        return [int(self.label) for _ in examples]


class FixedRuleBaselineModel:
    """Predicts a fixed midpoint threshold rule x + y >= 7."""

    def __init__(self, threshold: int = 7) -> None:
        self.threshold = threshold

    def fit(self, examples: List[Dict[str, int]]) -> "FixedRuleBaselineModel":
        if not examples:
            raise ValueError("examples must not be empty")
        return self

    def predict(self, examples: List[Dict[str, int]]) -> List[int]:
        return [int(e["x"] + e["y"] >= self.threshold) for e in examples]


class RandomBaselineModel:
    """Deterministically seeded random binary baseline."""

    def __init__(self, seed: int = 0) -> None:
        self.seed = seed

    def fit(self, examples: List[Dict[str, int]]) -> "RandomBaselineModel":
        if not examples:
            raise ValueError("examples must not be empty")
        return self

    def predict(self, examples: List[Dict[str, int]]) -> List[int]:
        rng = random.Random(self.seed)
        return [rng.choice((0, 1)) for _ in examples]
