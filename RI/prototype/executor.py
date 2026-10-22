"""Step 6 — Execution: bounded, allow-listed sandbox execution with step and timeout guards."""
from dataclasses import dataclass
import time
from typing import Any, Dict, List
from .candidates import CandidateHypothesis
from .task import ALLOWED_ACTIONS, TaskConstraints, validate_example


@dataclass(frozen=True)
class ExecutionResult:
    status: str
    predictions: List[int]
    steps_used: int
    duration_ms: float
    error_type: str = ""
    error_message: str = ""

    @property
    def ok(self) -> bool:
        return self.status == "ok"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "status": self.status,
            "ok": self.ok,
            "steps_used": self.steps_used,
            "duration_ms": round(self.duration_ms, 4),
            "error_type": self.error_type,
            "error_message": self.error_message,
            "n_predictions": len(self.predictions),
        }


class SandboxExecutor:
    """Execute a CandidateHypothesis on examples within strict action, step, and timeout bounds."""

    def execute(
        self,
        candidate: CandidateHypothesis,
        examples: List[Dict[str, int]],
        constraints: TaskConstraints,
    ) -> ExecutionResult:
        start = time.perf_counter()
        if candidate.action_name not in ALLOWED_ACTIONS or candidate.action_name not in constraints.allowed_actions:
            elapsed = (time.perf_counter() - start) * 1000.0
            return ExecutionResult(
                status="error_disallowed_action",
                predictions=[],
                steps_used=0,
                duration_ms=elapsed,
                error_type="DisallowedActionError",
                error_message=f"action '{candidate.action_name}' is not in task allowed_actions",
            )

        predictions: List[int] = []
        steps = 0
        for item in examples:
            steps += 1
            if steps > constraints.max_steps:
                elapsed = (time.perf_counter() - start) * 1000.0
                return ExecutionResult(
                    status="error_step_limit",
                    predictions=predictions,
                    steps_used=steps - 1,
                    duration_ms=elapsed,
                    error_type="StepLimitExceeded",
                    error_message=f"execution exceeded max_steps={constraints.max_steps}",
                )

            elapsed = (time.perf_counter() - start) * 1000.0
            if elapsed > constraints.timeout_ms:
                return ExecutionResult(
                    status="error_timeout",
                    predictions=predictions,
                    steps_used=steps - 1,
                    duration_ms=elapsed,
                    error_type="ExecutionTimeout",
                    error_message=f"execution exceeded timeout_ms={constraints.timeout_ms}",
                )

            try:
                validate_example(item, constraints.input_bounds, require_label=False)
                pred = candidate.predict_one(item["x"], item["y"])
            except Exception as exc:
                elapsed = (time.perf_counter() - start) * 1000.0
                return ExecutionResult(
                    status="error_invalid_input",
                    predictions=predictions,
                    steps_used=steps,
                    duration_ms=elapsed,
                    error_type=type(exc).__name__,
                    error_message=str(exc),
                )
            predictions.append(int(pred))

        elapsed = (time.perf_counter() - start) * 1000.0
        return ExecutionResult(
            status="ok",
            predictions=predictions,
            steps_used=steps,
            duration_ms=elapsed,
        )
