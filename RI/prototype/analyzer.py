"""Step 2 — Task Analysis: decompose task into verifiable subgoals and structural signatures."""
from dataclasses import dataclass
from typing import Any, Dict, List
from .task import TaskSpec


@dataclass(frozen=True)
class TaskAnalysis:
    task_id: str
    n_train: int
    n_test: int
    positive_rate: float
    is_constant_label: bool
    is_underdetermined: bool
    structural_signals: Dict[str, float]
    recommended_families: List[str]
    required_capabilities: List[str]
    subgoals: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "task_id": self.task_id,
            "n_train": self.n_train,
            "n_test": self.n_test,
            "positive_rate": round(self.positive_rate, 4),
            "is_constant_label": self.is_constant_label,
            "is_underdetermined": self.is_underdetermined,
            "structural_signals": {k: round(v, 4) for k, v in self.structural_signals.items()},
            "recommended_families": list(self.recommended_families),
            "required_capabilities": list(self.required_capabilities),
            "subgoals": list(self.subgoals),
        }


class TaskAnalyzer:
    """Analyze training examples (without accessing held-out labels) to derive subgoals and signals."""

    def analyze(self, task: TaskSpec) -> TaskAnalysis:
        task.validate()
        train = task.train_examples
        n_train = len(train)
        positives = sum(e["label"] for e in train)
        pos_rate = positives / n_train
        is_constant = positives in (0, n_train)
        is_underdetermined = n_train < 6 or is_constant

        # Compute empirical alignment with structural feature axes on train_examples only.
        sum_pos = [e["x"] + e["y"] for e in train if e["label"] == 1]
        sum_neg = [e["x"] + e["y"] for e in train if e["label"] == 0]
        sum_separation = (
            abs((sum(sum_pos) / len(sum_pos)) - (sum(sum_neg) / len(sum_neg))) / 14.0
            if sum_pos and sum_neg
            else 0.0
        )

        diff_pos = [e["x"] - e["y"] for e in train if e["label"] == 1]
        diff_neg = [e["x"] - e["y"] for e in train if e["label"] == 0]
        diff_separation = (
            abs((sum(diff_pos) / len(diff_pos)) - (sum(diff_neg) / len(diff_neg))) / 14.0
            if diff_pos and diff_neg
            else 0.0
        )

        even_match = sum(int(((e["x"] + e["y"]) % 2 == 0) == bool(e["label"])) for e in train) / n_train
        parity_signal = abs(even_match - 0.5) * 2.0

        signals = {
            "sum_monotonic_signal": sum_separation,
            "diff_monotonic_signal": diff_separation,
            "parity_alternation_signal": parity_signal,
        }

        # Rank primitive families by signal strength, always keeping full search fallback.
        ordered = []
        if parity_signal >= 0.75:
            ordered.append("parity")
        if sum_separation >= 0.25:
            ordered.append("sum_threshold")
        if diff_separation >= 0.25:
            ordered.append("diff_threshold")
        for fallback in ("sum_threshold", "parity", "diff_threshold", "mod_sum", "coord_box", "composed_and"):
            if fallback not in ordered:
                ordered.append(fallback)

        capabilities = [
            "feature_extraction_2d",
            "bounded_hypothesis_evaluation",
            "held_out_generalization_check",
        ]
        if parity_signal >= 0.25 and sum_separation >= 0.20:
            capabilities.append("skill_composition")

        subgoals = [
            "Validate task input and verify train/test split disjointness",
            "Query skill memory for matching active skills or composable primitives",
            "Generate and score bounded candidate hypotheses on development examples",
            "Execute best candidate within sandbox step and timeout limits",
            "Evaluate predictions on held-out examples against majority, fixed, and random baselines",
            "Persist verified skill or trigger bounded counterexample refinement loop",
        ]

        return TaskAnalysis(
            task_id=task.task_id,
            n_train=n_train,
            n_test=len(task.test_examples),
            positive_rate=pos_rate,
            is_constant_label=is_constant,
            is_underdetermined=is_underdetermined,
            structural_signals=signals,
            recommended_families=ordered,
            required_capabilities=capabilities,
            subgoals=subgoals,
        )
