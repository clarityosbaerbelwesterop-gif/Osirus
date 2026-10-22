"""Step 7 — Evaluation: verify disjointness, score held-out predictions, and compare with baselines."""
from dataclasses import dataclass
from statistics import mean
from typing import Any, Dict, List
from .candidates import (
    CandidateHypothesis,
    FixedRuleBaselineModel,
    MajorityBaselineModel,
    RandomBaselineModel,
)
from .executor import SandboxExecutor
from .task import TaskSpec


@dataclass(frozen=True)
class EvaluationResult:
    passed: bool
    train_accuracy: float
    held_out_accuracy: float
    disjoint_verified: bool
    baselines: Dict[str, float]
    gain_over_baselines: Dict[str, float]
    misclassified_train: List[Dict[str, int]]
    failure_reasons: List[str]
    execution_duration_ms: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "passed": self.passed,
            "train_accuracy": round(self.train_accuracy, 4),
            "held_out_accuracy": round(self.held_out_accuracy, 4),
            "disjoint_verified": self.disjoint_verified,
            "baselines": {k: round(v, 4) for k, v in self.baselines.items()},
            "gain_over_baselines": {k: round(v, 4) for k, v in self.gain_over_baselines.items()},
            "n_misclassified_train": len(self.misclassified_train),
            "failure_reasons": list(self.failure_reasons),
            "execution_duration_ms": round(self.execution_duration_ms, 4),
        }


class TaskEvaluator:
    """Evaluate a candidate hypothesis on development and disjoint held-out splits."""

    def __init__(self, executor: SandboxExecutor) -> None:
        self.executor = executor

    def evaluate(
        self,
        candidate: CandidateHypothesis,
        task: TaskSpec,
        seed: int = 0,
    ) -> EvaluationResult:
        train_pts = {(e["x"], e["y"]) for e in task.train_examples}
        test_pts = {(e["x"], e["y"]) for e in task.test_examples}
        disjoint = train_pts.isdisjoint(test_pts)

        train_exec = self.executor.execute(candidate, task.train_examples, task.constraints)
        test_exec = self.executor.execute(candidate, task.test_examples, task.constraints)

        failure_reasons: List[str] = []
        if task.success_criteria.require_disjoint_split and not disjoint:
            failure_reasons.append("train/test split is not disjoint")
        if not train_exec.ok:
            failure_reasons.append(f"train execution failed: {train_exec.error_type}: {train_exec.error_message}")
        if not test_exec.ok:
            failure_reasons.append(f"test execution failed: {test_exec.error_type}: {test_exec.error_message}")

        if train_exec.ok:
            train_acc = mean(
                int(p == e["label"]) for p, e in zip(train_exec.predictions, task.train_examples)
            )
            misclassified = [
                e for p, e in zip(train_exec.predictions, task.train_examples) if p != e["label"]
            ]
        else:
            train_acc = 0.0
            misclassified = list(task.train_examples)

        if test_exec.ok:
            held_out_acc = mean(
                int(p == e["label"]) for p, e in zip(test_exec.predictions, task.test_examples)
            )
        else:
            held_out_acc = 0.0

        maj_preds = MajorityBaselineModel().fit(task.train_examples).predict(task.test_examples)
        fix_preds = FixedRuleBaselineModel(threshold=7).fit(task.train_examples).predict(task.test_examples)
        rnd_preds = RandomBaselineModel(seed=seed + 90_001).fit(task.train_examples).predict(task.test_examples)

        baselines = {
            "majority": mean(int(p == e["label"]) for p, e in zip(maj_preds, task.test_examples)),
            "fixed_rule": mean(int(p == e["label"]) for p, e in zip(fix_preds, task.test_examples)),
            "random": mean(int(p == e["label"]) for p, e in zip(rnd_preds, task.test_examples)),
        }
        gains = {name: held_out_acc - val for name, val in baselines.items()}

        total_exec_ms = train_exec.duration_ms + test_exec.duration_ms
        if train_acc < task.success_criteria.min_train_accuracy:
            failure_reasons.append(
                f"train_accuracy {train_acc:.3f} < min_train_accuracy {task.success_criteria.min_train_accuracy:.3f}"
            )
        if held_out_acc < task.success_criteria.min_held_out_accuracy:
            failure_reasons.append(
                f"held_out_accuracy {held_out_acc:.3f} < min_held_out_accuracy {task.success_criteria.min_held_out_accuracy:.3f}"
            )
        if total_exec_ms > task.success_criteria.max_runtime_ms:
            failure_reasons.append(
                f"execution_duration_ms {total_exec_ms:.3f} > max_runtime_ms {task.success_criteria.max_runtime_ms:.3f}"
            )

        return EvaluationResult(
            passed=len(failure_reasons) == 0,
            train_accuracy=train_acc,
            held_out_accuracy=held_out_acc,
            disjoint_verified=disjoint,
            baselines=baselines,
            gain_over_baselines=gains,
            misclassified_train=misclassified,
            failure_reasons=failure_reasons,
            execution_duration_ms=total_exec_ms,
        )
