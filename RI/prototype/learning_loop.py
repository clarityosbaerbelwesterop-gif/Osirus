"""Step 9 — Learning Loop: bounded counterexample-driven candidate refinement without code modification."""
from dataclasses import dataclass
from typing import Any, Dict, List, Tuple
from .analyzer import TaskAnalysis
from .candidates import CandidateGenerator, CandidateHypothesis
from .selector import CandidateSelector, SelectionDecision
from .task import TaskSpec


@dataclass(frozen=True)
class RefinementTrace:
    triggered: bool
    rounds_run: int
    counterexamples_analyzed: int
    initial_candidate_id: str
    initial_train_accuracy: float
    refined_candidate_id: str
    refined_train_accuracy: float
    improved: bool
    notes: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "triggered": self.triggered,
            "rounds_run": self.rounds_run,
            "counterexamples_analyzed": self.counterexamples_analyzed,
            "initial_candidate_id": self.initial_candidate_id,
            "initial_train_accuracy": round(self.initial_train_accuracy, 4),
            "refined_candidate_id": self.refined_candidate_id,
            "refined_train_accuracy": round(self.refined_train_accuracy, 4),
            "improved": self.improved,
            "notes": list(self.notes),
        }


class BoundedLearningLoop:
    """Derive expanded bounded candidates from counterexamples when initial selection falls short."""

    def __init__(self, generator: CandidateGenerator, selector: CandidateSelector, max_rounds: int = 2) -> None:
        if max_rounds < 1 or max_rounds > 5:
            raise ValueError("max_rounds must be in [1, 5]")
        self.generator = generator
        self.selector = selector
        self.max_rounds = max_rounds

    def refine_if_needed(
        self,
        task: TaskSpec,
        analysis: TaskAnalysis,
        initial_decision: SelectionDecision,
        misclassified_train: List[Dict[str, int]],
    ) -> Tuple[SelectionDecision, RefinementTrace]:
        if not misclassified_train and initial_decision.train_accuracy >= task.success_criteria.min_train_accuracy:
            return initial_decision, RefinementTrace(
                triggered=False,
                rounds_run=0,
                counterexamples_analyzed=0,
                initial_candidate_id=initial_decision.selected.candidate_id,
                initial_train_accuracy=initial_decision.train_accuracy,
                refined_candidate_id=initial_decision.selected.candidate_id,
                refined_train_accuracy=initial_decision.train_accuracy,
                improved=False,
                notes=["Initial candidate had 0 development counterexamples; no refinement required."],
            )

        best_decision = initial_decision
        notes: List[str] = [
            f"Initial candidate '{initial_decision.selected.candidate_id}' had "
            f"{len(misclassified_train)} counterexample(s) (train_accuracy={initial_decision.train_accuracy:.3f})."
        ]
        rounds_run = 0

        for round_idx in range(1, self.max_rounds + 1):
            rounds_run = round_idx
            if round_idx == 1:
                # Round 1: include modular sum and coordinate-box families.
                expanded: List[CandidateHypothesis] = self.generator.generate(
                    allowed_actions=task.constraints.allowed_actions,
                    include_composed=False,
                    extra_families=["sum_threshold", "parity", "diff_threshold", "mod_sum", "coord_box"],
                )
                notes.append("Round 1: expanded hypothesis space to include mod_sum and coord_box primitives.")
            else:
                # Round 2: include composed two-stage hypotheses (sum_threshold AND parity).
                expanded = self.generator.generate(
                    allowed_actions=task.constraints.allowed_actions,
                    include_composed=True,
                    extra_families=["sum_threshold", "parity", "diff_threshold", "mod_sum", "coord_box"],
                )
                notes.append("Round 2: expanded hypothesis space to include composed_and hypotheses.")

            if not expanded:
                break

            cand_decision = self.selector.select(expanded, task.train_examples, analysis)
            if cand_decision.train_accuracy > best_decision.train_accuracy:
                best_decision = cand_decision
                notes.append(
                    f"Refinement improved train_accuracy to {best_decision.train_accuracy:.3f} "
                    f"via '{best_decision.selected.candidate_id}'."
                )
            if best_decision.train_errors == 0:
                break

        improved = best_decision.train_accuracy > initial_decision.train_accuracy
        return best_decision, RefinementTrace(
            triggered=True,
            rounds_run=rounds_run,
            counterexamples_analyzed=len(misclassified_train),
            initial_candidate_id=initial_decision.selected.candidate_id,
            initial_train_accuracy=initial_decision.train_accuracy,
            refined_candidate_id=best_decision.selected.candidate_id,
            refined_train_accuracy=best_decision.train_accuracy,
            improved=improved,
            notes=notes,
        )
