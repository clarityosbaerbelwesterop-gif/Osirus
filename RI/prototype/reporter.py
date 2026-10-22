"""Step 10 — Report: structured, secret-safe report generation."""
from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any, Dict, List, Optional
from .analyzer import TaskAnalysis
from .evaluator import EvaluationResult
from .executor import ExecutionResult
from .learning_loop import RefinementTrace
from .selector import SelectionDecision
from .task import TaskSpec, ensure_no_secrets


@dataclass(frozen=True)
class TaskRunReport:
    task_id: str
    family: str
    analysis: TaskAnalysis
    selection: SelectionDecision
    execution: ExecutionResult
    evaluation: EvaluationResult
    refinement: RefinementTrace
    reused_skill: bool
    composed_skill: bool
    stored_skill_id: Optional[str]
    total_runtime_ms: float
    limitations: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "task_id": self.task_id,
            "family": self.family,
            "passed": self.evaluation.passed,
            "reused_skill": self.reused_skill,
            "composed_skill": self.composed_skill,
            "stored_skill_id": self.stored_skill_id,
            "total_runtime_ms": round(self.total_runtime_ms, 4),
            "analysis": self.analysis.to_dict(),
            "selection": self.selection.to_dict(),
            "execution": self.execution.to_dict(),
            "evaluation": self.evaluation.to_dict(),
            "learning_loop": self.refinement.to_dict(),
            "limitations": list(self.limitations),
        }

    def save_json(self, path: Path) -> None:
        raw = json.dumps(self.to_dict(), indent=2) + "\n"
        ensure_no_secrets(raw)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(raw, encoding="utf-8")
