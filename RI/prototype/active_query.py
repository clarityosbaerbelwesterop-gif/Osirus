"""M13 — Active Boundary Querying for Hypothesis Disambiguation.

When multiple candidate hypotheses tie at minimum development error (for example,
adjacent thresholds when boundary coordinates are missing from the initial sample),
ActiveBoundaryQuerier selects unlabeled coordinates from a disjoint query pool that
maximize disagreement among the tied version space.
"""
from dataclasses import dataclass
import math
import random
from statistics import mean
from typing import Any, Dict, List, Optional, Tuple

from .analyzer import TaskAnalyzer
from .candidates import (
    CandidateGenerator,
    CandidateHypothesis,
    FixedRuleBaselineModel,
    MajorityBaselineModel,
)
from .selector import CandidateSelector
from .task import TaskSpec, generate_grid_task


@dataclass(frozen=True)
class QueryStepRecord:
    step: int
    x: int
    y: int
    revealed_label: int
    version_space_before: int
    version_space_after: int
    disagreement_score: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "step": self.step,
            "x": self.x,
            "y": self.y,
            "revealed_label": self.revealed_label,
            "version_space_before": self.version_space_before,
            "version_space_after": self.version_space_after,
            "disagreement_score": round(self.disagreement_score, 4),
        }


@dataclass(frozen=True)
class ActiveQueryTrace:
    policy: str
    budget: int
    queries_used: int
    initial_version_space_size: int
    final_version_space_size: int
    tie_resolved: bool
    steps: List[QueryStepRecord]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "policy": self.policy,
            "budget": self.budget,
            "queries_used": self.queries_used,
            "initial_version_space_size": self.initial_version_space_size,
            "final_version_space_size": self.final_version_space_size,
            "tie_resolved": self.tie_resolved,
            "steps": [s.to_dict() for s in self.steps],
        }


class ActiveBoundaryQuerier:
    """Resolve hypothesis ties by querying maximally informative points from an unlabeled pool."""

    POLICIES = ("active_disagreement", "random_query", "passive_no_query")

    def __init__(self, policy: str = "active_disagreement", budget: int = 3, seed: int = 0) -> None:
        if policy not in self.POLICIES:
            raise ValueError(f"unknown query policy: {policy}")
        if isinstance(budget, bool) or not isinstance(budget, int) or budget < 0:
            raise ValueError("budget must be a non-negative integer")
        self.policy = policy
        self.budget = budget
        self.seed = seed

    @staticmethod
    def version_space(
        candidates: List[CandidateHypothesis],
        examples: List[Dict[str, int]],
    ) -> List[CandidateHypothesis]:
        if not candidates:
            raise ValueError("candidates must not be empty")
        if not examples:
            raise ValueError("examples must not be empty")
        scored = []
        for cand in candidates:
            err = sum(int(cand.predict_one(e["x"], e["y"]) != e["label"]) for e in examples)
            scored.append((err, cand))
        min_err = min(err for err, _ in scored)
        return [cand for err, cand in scored if err == min_err]

    @staticmethod
    def disagreement_score(tied_candidates: List[CandidateHypothesis], x: int, y: int) -> float:
        """Compute normalized split balance in [0.0, 0.5] and Shannon entropy bonus."""
        n = len(tied_candidates)
        if n <= 1:
            return 0.0
        pos = sum(int(c.predict_one(x, y) == 1) for c in tied_candidates)
        neg = n - pos
        if pos == 0 or neg == 0:
            return 0.0
        p = pos / n
        entropy = -(p * math.log2(p) + (1.0 - p) * math.log2(1.0 - p))
        return entropy

    def query_and_augment(
        self,
        candidates: List[CandidateHypothesis],
        train_examples: List[Dict[str, int]],
        query_pool: List[Dict[str, int]],
    ) -> Tuple[List[Dict[str, int]], ActiveQueryTrace]:
        augmented = list(train_examples)
        available_pool = list(query_pool)
        vspace = self.version_space(candidates, augmented)
        initial_vs_size = len(vspace)

        if self.policy == "passive_no_query" or self.budget == 0 or initial_vs_size <= 1 or not available_pool:
            return augmented, ActiveQueryTrace(
                policy=self.policy,
                budget=self.budget,
                queries_used=0,
                initial_version_space_size=initial_vs_size,
                final_version_space_size=initial_vs_size,
                tie_resolved=(initial_vs_size <= 1),
                steps=[],
            )

        rng = random.Random(self.seed)
        steps: List[QueryStepRecord] = []

        for step_idx in range(1, self.budget + 1):
            vspace = self.version_space(candidates, augmented)
            if len(vspace) <= 1 or not available_pool:
                break

            if self.policy == "active_disagreement":
                scored_points = []
                for idx, item in enumerate(available_pool):
                    score = self.disagreement_score(vspace, item["x"], item["y"])
                    scored_points.append((score, -idx, idx, item))
                scored_points.sort(reverse=True)
                best_score, _, chosen_idx, chosen_item = scored_points[0]
                if best_score <= 0.0:
                    # Remaining pool points cannot distinguish the tied hypotheses.
                    break
            else:  # random_query
                chosen_idx = rng.randrange(len(available_pool))
                chosen_item = available_pool[chosen_idx]
                best_score = self.disagreement_score(vspace, chosen_item["x"], chosen_item["y"])

            vs_before = len(vspace)
            available_pool.pop(chosen_idx)
            augmented.append(chosen_item)
            vspace_after = self.version_space(candidates, augmented)

            steps.append(
                QueryStepRecord(
                    step=step_idx,
                    x=chosen_item["x"],
                    y=chosen_item["y"],
                    revealed_label=chosen_item["label"],
                    version_space_before=vs_before,
                    version_space_after=len(vspace_after),
                    disagreement_score=best_score,
                )
            )
            if len(vspace_after) <= 1:
                break

        final_vspace = self.version_space(candidates, augmented)
        return augmented, ActiveQueryTrace(
            policy=self.policy,
            budget=self.budget,
            queries_used=len(steps),
            initial_version_space_size=initial_vs_size,
            final_version_space_size=len(final_vspace),
            tie_resolved=(len(final_vspace) == 1),
            steps=steps,
        )


def _matches_ground_truth(candidate: CandidateHypothesis, task: TaskSpec) -> bool:
    gt = task.metadata.get("ground_truth_params", {})
    if candidate.family != task.family:
        return False
    for k, v in gt.items():
        if candidate.parameters.get(k) != v:
            return False
    return True


def evaluate_active_boundary_querying(
    seeds: List[int],
    initial_train_size: int = 10,
    query_pool_size: int = 30,
    test_size: int = 24,
    query_budget: int = 3,
) -> Dict[str, Any]:
    """Compare active_disagreement, random_query, and passive_no_query across seeds."""
    if not seeds:
        raise ValueError("at least one seed required")
    if initial_train_size + query_pool_size + test_size > 64:
        raise ValueError("initial_train_size + query_pool_size + test_size must be <= 64")

    families = ("sum_threshold", "diff_threshold", "coord_box", "parity")
    generator = CandidateGenerator()
    analyzer = TaskAnalyzer()
    selector = CandidateSelector(complexity_weight=0.01, reuse_bonus=0.005)

    rows: List[Dict[str, Any]] = []
    for idx, seed in enumerate(seeds):
        fam = families[idx % len(families)]
        # Generate full 64-point task split into initial_train (10), query_pool (30), and test (24).
        full_task = generate_grid_task(
            seed=seed + 3000,
            family=fam,
            train_size=initial_train_size + query_pool_size,
            test_size=test_size,
            task_id=f"m13_{fam}_s{seed}",
        )
        initial_train = full_task.train_examples[:initial_train_size]
        query_pool = full_task.train_examples[initial_train_size:]
        test_examples = full_task.test_examples

        base_task = TaskSpec(
            task_id=full_task.task_id,
            family=fam,
            description=full_task.description,
            train_examples=initial_train,
            test_examples=test_examples,
            metadata=full_task.metadata,
        ).validate()

        candidates = generator.generate(
            allowed_actions=base_task.constraints.allowed_actions,
            include_composed=False,
            extra_families=list(families),
        )

        policy_outcomes: Dict[str, Any] = {}
        for policy in ActiveBoundaryQuerier.POLICIES:
            querier = ActiveBoundaryQuerier(policy=policy, budget=query_budget, seed=seed + 70_000)
            augmented_train, trace = querier.query_and_augment(candidates, initial_train, query_pool)
            aug_task = TaskSpec(
                task_id=f"{full_task.task_id}_{policy}",
                family=fam,
                description=full_task.description,
                train_examples=augmented_train,
                test_examples=test_examples,
                metadata=full_task.metadata,
            )
            analysis = analyzer.analyze(aug_task)
            decision = selector.select(candidates, augmented_train, analysis)
            held_out_acc = mean(
                int(decision.selected.predict_one(e["x"], e["y"]) == e["label"])
                for e in test_examples
            )
            exact_match = _matches_ground_truth(decision.selected, base_task)
            policy_outcomes[policy] = {
                "held_out_accuracy": held_out_acc,
                "exact_rule_recovered": exact_match,
                "queries_used": trace.queries_used,
                "initial_version_space_size": trace.initial_version_space_size,
                "final_version_space_size": trace.final_version_space_size,
                "tie_resolved": trace.tie_resolved,
                "selected_candidate_id": decision.selected.candidate_id,
            }

        maj_preds = MajorityBaselineModel().fit(initial_train).predict(test_examples)
        fix_preds = FixedRuleBaselineModel(threshold=7).fit(initial_train).predict(test_examples)
        rows.append(
            {
                "seed": seed,
                "family": fam,
                "initial_tie": policy_outcomes["passive_no_query"]["initial_version_space_size"] > 1,
                "policies": policy_outcomes,
                "baselines": {
                    "majority": mean(int(p == e["label"]) for p, e in zip(maj_preds, test_examples)),
                    "fixed_rule": mean(int(p == e["label"]) for p, e in zip(fix_preds, test_examples)),
                },
            }
        )

    initial_tie_rows = [r for r in rows if r["initial_tie"]]
    policies_summary: Dict[str, Any] = {}
    for policy in ActiveBoundaryQuerier.POLICIES:
        policies_summary[policy] = {
            "mean_held_out_accuracy": mean(r["policies"][policy]["held_out_accuracy"] for r in rows),
            "exact_rule_recovery_rate": mean(
                float(r["policies"][policy]["exact_rule_recovered"]) for r in rows
            ),
            "mean_queries_used": mean(r["policies"][policy]["queries_used"] for r in rows),
            "mean_final_version_space_size": mean(
                r["policies"][policy]["final_version_space_size"] for r in rows
            ),
            "tie_resolution_rate_on_tied_seeds": (
                mean(float(r["policies"][policy]["tie_resolved"]) for r in initial_tie_rows)
                if initial_tie_rows
                else 1.0
            ),
        }

    active_acc = policies_summary["active_disagreement"]["mean_held_out_accuracy"]
    random_acc = policies_summary["random_query"]["mean_held_out_accuracy"]
    passive_acc = policies_summary["passive_no_query"]["mean_held_out_accuracy"]

    return {
        "n_seeds": len(rows),
        "initial_train_size": initial_train_size,
        "query_pool_size": query_pool_size,
        "test_size": test_size,
        "query_budget": query_budget,
        "initial_tie_rate": mean(float(r["initial_tie"]) for r in rows),
        "policies": policies_summary,
        "baselines": {
            "majority": mean(r["baselines"]["majority"] for r in rows),
            "fixed_rule": mean(r["baselines"]["fixed_rule"] for r in rows),
        },
        "active_gain_over_controls": {
            "held_out_accuracy_vs_passive": active_acc - passive_acc,
            "held_out_accuracy_vs_random_query": active_acc - random_acc,
            "exact_recovery_vs_passive": (
                policies_summary["active_disagreement"]["exact_rule_recovery_rate"]
                - policies_summary["passive_no_query"]["exact_rule_recovery_rate"]
            ),
            "exact_recovery_vs_random_query": (
                policies_summary["active_disagreement"]["exact_rule_recovery_rate"]
                - policies_summary["random_query"]["exact_rule_recovery_rate"]
            ),
        },
        "rows": rows,
        "limitations": [
            "Active queries are restricted to an unlabeled pool disjoint from held-out test examples.",
            "Version-space disagreement assumes realizable noiseless oracle responses during boundary disambiguation.",
        ],
    }
