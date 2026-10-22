"""M12 — Guarded Self-Improvement with Baseline Lock, Regression Suite, Held-Out Gate, and Rollback."""
from dataclasses import dataclass
from statistics import mean
from typing import Any, Dict, List, Optional
from .memory import SkillMemory
from .orchestrator import RIPrototypeOrchestrator
from .task import TaskSpec, generate_grid_task


@dataclass(frozen=True)
class PrototypeConfig:
    version: int = 1
    enable_learning_loop: bool = False
    complexity_weight: float = 0.02
    reuse_bonus: float = 0.005
    max_refinement_rounds: int = 1
    description: str = "Baseline single-pass configuration without counterexample refinement"

    def validate(self) -> "PrototypeConfig":
        if isinstance(self.version, bool) or not isinstance(self.version, int) or self.version < 1:
            raise ValueError("version must be a positive integer")
        if not isinstance(self.enable_learning_loop, bool):
            raise ValueError("enable_learning_loop must be a bool")
        if isinstance(self.complexity_weight, bool) or not isinstance(self.complexity_weight, (int, float)) or not 0.0 <= float(self.complexity_weight) <= 0.2:
            raise ValueError("complexity_weight outside allow-list bounds [0.0, 0.2]")
        if isinstance(self.reuse_bonus, bool) or not isinstance(self.reuse_bonus, (int, float)) or not 0.0 <= float(self.reuse_bonus) <= 0.1:
            raise ValueError("reuse_bonus outside allow-list bounds [0.0, 0.1]")
        if isinstance(self.max_refinement_rounds, bool) or not isinstance(self.max_refinement_rounds, int) or not 1 <= self.max_refinement_rounds <= 3:
            raise ValueError("max_refinement_rounds outside allow-list bounds [1, 3]")
        return self

    def build_orchestrator(self, memory: Optional[SkillMemory] = None) -> RIPrototypeOrchestrator:
        self.validate()
        orch = RIPrototypeOrchestrator(
            memory=memory if memory is not None else SkillMemory(),
            complexity_weight=self.complexity_weight,
            reuse_bonus=self.reuse_bonus,
            enable_learning_loop=self.enable_learning_loop,
        )
        orch.learning_loop.max_rounds = self.max_refinement_rounds
        return orch

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version,
            "enable_learning_loop": self.enable_learning_loop,
            "complexity_weight": self.complexity_weight,
            "reuse_bonus": self.reuse_bonus,
            "max_refinement_rounds": self.max_refinement_rounds,
            "description": self.description,
        }


def propose_configuration_improvement(baseline: PrototypeConfig, weakest_area: str) -> PrototypeConfig:
    """Allow-listed parameter proposal: never modifies program code."""
    baseline.validate()
    if weakest_area in ("multi_family_refinement", "composed_and_modular_tasks"):
        return PrototypeConfig(
            version=baseline.version + 1,
            enable_learning_loop=True,
            complexity_weight=0.01,
            reuse_bonus=baseline.reuse_bonus,
            max_refinement_rounds=2,
            description="Enable 2-round counterexample refinement loop and balanced complexity weight",
        ).validate()
    return baseline


class GuardedSelfImprover:
    """Evaluate a proposed PrototypeConfig against a locked baseline, regression suite, and held-out gate."""

    def __init__(self, minimum_gain: float = 0.05, max_regression_drop: float = 0.0) -> None:
        if not 0.0 <= minimum_gain <= 1.0:
            raise ValueError("minimum_gain must be in [0.0, 1.0]")
        if not 0.0 <= max_regression_drop <= 1.0:
            raise ValueError("max_regression_drop must be in [0.0, 1.0]")
        self.minimum_gain = minimum_gain
        self.max_regression_drop = max_regression_drop

    @staticmethod
    def build_regression_tasks() -> List[TaskSpec]:
        """Fixed regression suite of previously solved core task families."""
        return [
            generate_grid_task(101, family="sum_threshold", train_size=18, test_size=24, task_id="reg_sum_101"),
            generate_grid_task(102, family="parity", train_size=18, test_size=24, task_id="reg_parity_102"),
            generate_grid_task(103, family="diff_threshold", train_size=18, test_size=24, task_id="reg_diff_103"),
        ]

    @staticmethod
    def build_held_out_tasks(seeds: List[int]) -> List[TaskSpec]:
        """Disjoint held-out benchmark tasks spanning all 6 families, never used to tune the proposal."""
        families = ("sum_threshold", "parity", "diff_threshold", "mod_sum", "coord_box", "composed_and")
        tasks: List[TaskSpec] = []
        for idx, seed in enumerate(seeds):
            fam = families[idx % len(families)]
            tasks.append(
                generate_grid_task(
                    seed=seed + 10_000,
                    family=fam,
                    train_size=20,
                    test_size=24,
                    task_id=f"heldout_{fam}_s{seed}",
                )
            )
        return tasks

    def evaluate_candidate(
        self,
        baseline: PrototypeConfig,
        candidate: PrototypeConfig,
        held_out_seeds: List[int],
    ) -> Dict[str, Any]:
        if not held_out_seeds:
            raise ValueError("at least one held-out seed required")
        baseline.validate()
        candidate.validate()

        regression_tasks = self.build_regression_tasks()
        base_reg_orch = baseline.build_orchestrator()
        cand_reg_orch = candidate.build_orchestrator()

        base_reg_scores = [base_reg_orch.run_task(t, seed=i).evaluation.held_out_accuracy for i, t in enumerate(regression_tasks)]
        cand_reg_scores = [cand_reg_orch.run_task(t, seed=i).evaluation.held_out_accuracy for i, t in enumerate(regression_tasks)]
        regression_drop = max(0.0, mean(base_reg_scores) - mean(cand_reg_scores))
        no_per_task_regression = all(c >= b for b, c in zip(base_reg_scores, cand_reg_scores))
        regression_passed = regression_drop <= self.max_regression_drop and no_per_task_regression

        held_out_tasks = self.build_held_out_tasks(held_out_seeds)
        base_eval_orch = baseline.build_orchestrator()
        cand_eval_orch = candidate.build_orchestrator()

        rows: List[Dict[str, Any]] = []
        for seed, task in zip(held_out_seeds, held_out_tasks):
            b_rep = base_eval_orch.run_task(task, seed=seed)
            c_rep = cand_eval_orch.run_task(task, seed=seed)
            b_acc = b_rep.evaluation.held_out_accuracy
            c_acc = c_rep.evaluation.held_out_accuracy
            rows.append(
                {
                    "seed": seed,
                    "task_id": task.task_id,
                    "family": task.family,
                    "baseline_held_out_accuracy": b_acc,
                    "candidate_held_out_accuracy": c_acc,
                    "paired_gain": c_acc - b_acc,
                    "baseline_passed": b_rep.evaluation.passed,
                    "candidate_passed": c_rep.evaluation.passed,
                }
            )

        base_mean = mean(r["baseline_held_out_accuracy"] for r in rows)
        cand_mean = mean(r["candidate_held_out_accuracy"] for r in rows)
        mean_gain = cand_mean - base_mean
        base_pass_rate = mean(float(r["baseline_passed"]) for r in rows)
        cand_pass_rate = mean(float(r["candidate_passed"]) for r in rows)

        promoted = bool(regression_passed and mean_gain >= self.minimum_gain)
        active_config = candidate if promoted else baseline
        status = "promoted" if promoted else "rolled_back_to_baseline"

        reasons: List[str] = []
        if not regression_passed:
            reasons.append(f"regression check failed (drop={regression_drop:.4f})")
        if mean_gain < self.minimum_gain:
            reasons.append(f"mean held-out gain {mean_gain:.4f} < minimum_gain {self.minimum_gain:.4f}")
        if not reasons:
            reasons.append(
                f"regression suite passed (drop={regression_drop:.4f}) and held-out gain {mean_gain:.4f} >= {self.minimum_gain:.4f}"
            )

        return {
            "status": status,
            "promoted": promoted,
            "active_version": active_config.version,
            "baseline_config": baseline.to_dict(),
            "candidate_config": candidate.to_dict(),
            "active_config": active_config.to_dict(),
            "regression_gate": {
                "n_tasks": len(regression_tasks),
                "baseline_mean_accuracy": mean(base_reg_scores),
                "candidate_mean_accuracy": mean(cand_reg_scores),
                "regression_drop": regression_drop,
                "passed": regression_passed,
            },
            "held_out_gate": {
                "n_seeds": len(held_out_seeds),
                "minimum_gain": self.minimum_gain,
                "baseline_mean_accuracy": base_mean,
                "candidate_mean_accuracy": cand_mean,
                "mean_paired_gain": mean_gain,
                "baseline_task_pass_rate": base_pass_rate,
                "candidate_task_pass_rate": cand_pass_rate,
                "passed": mean_gain >= self.minimum_gain,
            },
            "decision_reason": "; ".join(reasons),
            "rows": rows,
            "limitations": [
                "Self-improvement is strictly limited to allow-listed PrototypeConfig parameters.",
                "Program source code is never generated, modified, or executed dynamically.",
                "Promotion is gated by deterministic regression checks and disjoint held-out tasks.",
            ],
        }
