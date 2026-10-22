"""Step 4 — Reasoning and Selection: score, rank, and select bounded candidates."""
from dataclasses import dataclass
from typing import Any, Dict, List, Tuple
from .analyzer import TaskAnalysis
from .candidates import CandidateHypothesis


@dataclass(frozen=True)
class SelectionDecision:
    selected: CandidateHypothesis
    train_accuracy: float
    train_errors: int
    n_candidates_evaluated: int
    n_tied_at_best_error: int
    tie_detected: bool
    uncertainty_score: float
    rationale: str
    top_candidates: List[Dict[str, Any]]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "selected": self.selected.to_dict(),
            "train_accuracy": round(self.train_accuracy, 4),
            "train_errors": self.train_errors,
            "n_candidates_evaluated": self.n_candidates_evaluated,
            "n_tied_at_best_error": self.n_tied_at_best_error,
            "tie_detected": self.tie_detected,
            "uncertainty_score": round(self.uncertainty_score, 4),
            "rationale": self.rationale,
            "top_candidates": self.top_candidates,
        }


class CandidateSelector:
    """Rank candidates by development error, skill reuse preference, family alignment, and simplicity."""

    def __init__(self, complexity_weight: float = 0.01, reuse_bonus: float = 0.005) -> None:
        if not 0.0 <= complexity_weight <= 0.5:
            raise ValueError("complexity_weight must be in [0.0, 0.5]")
        if not 0.0 <= reuse_bonus <= 0.5:
            raise ValueError("reuse_bonus must be in [0.0, 0.5]")
        self.complexity_weight = complexity_weight
        self.reuse_bonus = reuse_bonus

    def select(
        self,
        candidates: List[CandidateHypothesis],
        train_examples: List[Dict[str, int]],
        analysis: TaskAnalysis,
    ) -> SelectionDecision:
        if not candidates:
            raise ValueError("candidates list must not be empty")
        if not train_examples:
            raise ValueError("train_examples must not be empty")

        n_train = len(train_examples)
        scored: List[Tuple[Tuple[float, int, int, int, str], int, float, CandidateHypothesis]] = []
        fam_rank = {fam: idx for idx, fam in enumerate(analysis.recommended_families)}

        for cand in candidates:
            errors = sum(
                int(cand.predict_one(e["x"], e["y"]) != e["label"])
                for e in train_examples
            )
            error_rate = errors / n_train
            is_reused = cand.source in ("memory_reuse", "memory_composition")
            complexity_penalty = 0.0 if is_reused else self.complexity_weight * (cand.complexity - 1)
            effective_loss = (
                error_rate
                + complexity_penalty
                - (self.reuse_bonus if is_reused else 0.0)
            )
            sort_key = (
                round(effective_loss, 9),
                errors,
                0 if is_reused else cand.complexity,
                fam_rank.get(cand.family, 99),
                -int(cand.parameters.get("threshold", 0)),
                cand.candidate_id,
            )
            scored.append((sort_key, errors, 1.0 - error_rate, cand))

        scored.sort(key=lambda item: item[0])
        _, best_errors, best_acc, best_cand = scored[0]
        tied_best = [item[3] for item in scored if item[1] == best_errors]
        tie_detected = len(tied_best) > 1

        # Uncertainty combines training error rate, tie multiplicity, and small-sample penalty.
        tie_fraction = min(1.0, (len(tied_best) - 1) / max(1, len(candidates)))
        sample_penalty = 0.25 if analysis.is_underdetermined else 0.0
        uncertainty = min(1.0, (1.0 - best_acc) + 0.5 * tie_fraction + sample_penalty)

        rationale = (
            f"Selected '{best_cand.candidate_id}' (family={best_cand.family}, source={best_cand.source}, "
            f"complexity={best_cand.complexity}) with {best_errors}/{n_train} development errors "
            f"(accuracy={best_acc:.3f}); {len(tied_best)} candidate(s) tied at minimum error."
        )

        top_view = [
            {
                "candidate_id": c.candidate_id,
                "family": c.family,
                "source": c.source,
                "complexity": c.complexity,
                "train_errors": err,
                "train_accuracy": round(acc, 4),
            }
            for _, err, acc, c in scored[:5]
        ]

        return SelectionDecision(
            selected=best_cand,
            train_accuracy=best_acc,
            train_errors=best_errors,
            n_candidates_evaluated=len(candidates),
            n_tied_at_best_error=len(tied_best),
            tie_detected=tie_detected,
            uncertainty_score=uncertainty,
            rationale=rationale,
            top_candidates=top_view,
        )
