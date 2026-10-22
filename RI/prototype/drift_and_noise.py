"""M15 — Non-Stationary Concept Drift, Label Noise Robustness & Quarantine/Rollback Dynamics.

Evaluates how SkillMemory and the RI prototype handle:
1. Label noise in development examples (0% to 20% corruption).
2. Abrupt concept drift (rule parameters shift mid-stream).
3. High-noise / adversarial batch shocks (quarantine and rollback protection).
4. Recurring regimes (reactivating prior verified versions in SkillMemory).
"""
from dataclasses import dataclass
import random
from statistics import mean
from typing import Any, Dict, List, Optional, Tuple

from .analyzer import TaskAnalyzer
from .candidates import (
    CandidateGenerator,
    CandidateHypothesis,
    MajorityBaselineModel,
)
from .memory import SkillMemory, SkillRecord
from .selector import CandidateSelector
from .task import TaskSpec, generate_grid_task

STREAM_POLICIES = ("guarded_drift_controller", "naive_overwrite", "static_frozen", "majority_baseline")


def corrupt_training_labels(
    examples: List[Dict[str, int]],
    noise_prob: float,
    seed: int,
) -> List[Dict[str, int]]:
    """Return a copy of examples where each binary label is flipped with probability noise_prob."""
    if not 0.0 <= noise_prob < 0.5:
        raise ValueError("noise_prob must be in [0.0, 0.5)")
    rng = random.Random(seed)
    noisy: List[Dict[str, int]] = []
    for item in examples:
        flipped = rng.random() < noise_prob
        label = (1 - int(item["label"])) if flipped else int(item["label"])
        noisy.append({"x": int(item["x"]), "y": int(item["y"]), "label": label})
    return noisy


@dataclass(frozen=True)
class DriftStepOutcome:
    phase: str
    family: str
    policy: str
    action_taken: str
    active_version: Optional[int]
    batch_error_of_prior_skill: Optional[float]
    held_out_accuracy: float
    quarantined_versions: int
    rolled_back_versions: int

    def to_dict(self) -> Dict[str, Any]:
        return {
            "phase": self.phase,
            "family": self.family,
            "policy": self.policy,
            "action_taken": self.action_taken,
            "active_version": self.active_version,
            "batch_error_of_prior_skill": (
                round(self.batch_error_of_prior_skill, 4)
                if self.batch_error_of_prior_skill is not None
                else None
            ),
            "held_out_accuracy": round(self.held_out_accuracy, 4),
            "quarantined_versions": self.quarantined_versions,
            "rolled_back_versions": self.rolled_back_versions,
        }


class DriftAndNoiseController:
    """Manage versioned skills across noisy and non-stationary continual task streams."""

    def __init__(
        self,
        memory: Optional[SkillMemory] = None,
        noise_tolerance: float = 0.20,
        max_adapt_batch_error: float = 0.22,
    ) -> None:
        if not 0.0 <= noise_tolerance <= 0.45:
            raise ValueError("noise_tolerance must be in [0.0, 0.45]")
        if not 0.0 <= max_adapt_batch_error <= 0.45:
            raise ValueError("max_adapt_batch_error must be in [0.0, 0.45]")
        self.memory = memory if memory is not None else SkillMemory(quarantine_failure_threshold=1)
        self.noise_tolerance = noise_tolerance
        self.max_adapt_batch_error = max_adapt_batch_error
        self.generator = CandidateGenerator()
        self.analyzer = TaskAnalyzer()
        self.selector = CandidateSelector(complexity_weight=0.01, reuse_bonus=0.0)

    @staticmethod
    def _empirical_error(cand: CandidateHypothesis, examples: List[Dict[str, int]]) -> float:
        if not examples:
            raise ValueError("examples must not be empty")
        return mean(int(cand.predict_one(e["x"], e["y"]) != e["label"]) for e in examples)

    def _fit_family_candidate(self, task: TaskSpec) -> Tuple[CandidateHypothesis, float]:
        candidates = self.generator.generate(
            allowed_actions=task.constraints.allowed_actions,
            include_composed=False,
            extra_families=[task.family],
        )
        analysis = self.analyzer.analyze(task)
        decision = self.selector.select(candidates, task.train_examples, analysis)
        err_rate = decision.train_errors / len(task.train_examples)
        return decision.selected, err_rate

    def step_task(self, phase: str, task: TaskSpec, policy: str = "guarded_drift_controller") -> DriftStepOutcome:
        if policy not in STREAM_POLICIES:
            raise ValueError(f"unknown stream policy: {policy}")

        skill_id = f"lineage_{task.family}"

        if policy == "majority_baseline":
            maj_preds = MajorityBaselineModel().fit(task.train_examples).predict(task.test_examples)
            acc = mean(int(p == e["label"]) for p, e in zip(maj_preds, task.test_examples))
            return DriftStepOutcome(
                phase=phase,
                family=task.family,
                policy=policy,
                action_taken="majority_predict",
                active_version=None,
                batch_error_of_prior_skill=None,
                held_out_accuracy=acc,
                quarantined_versions=0,
                rolled_back_versions=0,
            )

        active_rec: Optional[SkillRecord] = self.memory.get_skill(skill_id)
        prior_batch_err: Optional[float] = None
        if active_rec is not None and active_rec.status == "active":
            prior_batch_err = self._empirical_error(active_rec.to_candidate(), task.train_examples)

        if policy == "static_frozen":
            if active_rec is None or active_rec.status != "active":
                cand, _ = self._fit_family_candidate(task)
                unit_tests = [
                    {"x": e["x"], "y": e["y"], "label": cand.predict_one(e["x"], e["y"])}
                    for e in task.train_examples[:8]
                ]
                active_rec = self.memory.register_skill(
                    skill_id=skill_id,
                    name=f"{task.family}_frozen",
                    purpose="Initial frozen skill",
                    candidate=cand,
                    unit_tests=unit_tests,
                    validation_metrics={"held_out_accuracy": 1.0},
                )
                action_taken = "acquired_initial"
            else:
                action_taken = "kept_frozen"

        elif policy == "naive_overwrite":
            cand, _ = self._fit_family_candidate(task)
            unit_tests = [
                {"x": e["x"], "y": e["y"], "label": cand.predict_one(e["x"], e["y"])}
                for e in task.train_examples[:8]
            ]
            active_rec = self.memory.register_skill(
                skill_id=skill_id,
                name=f"{task.family}_naive",
                purpose="Naively overwritten skill",
                candidate=cand,
                unit_tests=unit_tests,
                validation_metrics={"held_out_accuracy": 1.0},
            )
            action_taken = "overwritten"

        else:  # guarded_drift_controller
            if active_rec is None or active_rec.status != "active":
                cand, err_rate = self._fit_family_candidate(task)
                unit_tests = [
                    {"x": e["x"], "y": e["y"], "label": cand.predict_one(e["x"], e["y"])}
                    for e in task.train_examples[:8]
                ]
                active_rec = self.memory.register_skill(
                    skill_id=skill_id,
                    name=f"{task.family}_guarded",
                    purpose="Guarded skill",
                    candidate=cand,
                    unit_tests=unit_tests,
                    validation_metrics={"held_out_accuracy": 1.0 - err_rate},
                    min_held_out_accuracy=0.70,
                )
                action_taken = "acquired_initial"
            elif prior_batch_err is not None and prior_batch_err <= self.noise_tolerance:
                # Batch error is within expected label noise bounds; preserve verified skill.
                self.memory.record_outcome(active_rec.to_candidate(), passed=True)
                action_taken = "retained_under_noise"
            else:
                # Potential drift or severe batch corruption.
                # 1. Check if any prior version in the lineage matches this batch within noise_tolerance.
                recovered_rec: Optional[SkillRecord] = None
                for hist_rec in self.memory.get_lineage(skill_id):
                    if hist_rec.version == active_rec.version or hist_rec.status == "quarantined":
                        continue
                    hist_err = self._empirical_error(hist_rec.to_candidate(), task.train_examples)
                    if hist_err <= self.noise_tolerance and hist_rec.run_unit_tests():
                        recovered_rec = self.memory.reactivate_version(skill_id, hist_rec.version)
                        break

                if recovered_rec is not None:
                    active_rec = recovered_rec
                    action_taken = "recovered_prior_version"
                else:
                    # 2. Fit a new candidate on the batch, but verify that its batch error is within max_adapt_batch_error.
                    cand, cand_err = self._fit_family_candidate(task)
                    if cand_err <= self.max_adapt_batch_error:
                        # Genuine new realizable regime: register adapted version (superseding prior active version).
                        unit_tests = [
                            {"x": e["x"], "y": e["y"], "label": cand.predict_one(e["x"], e["y"])}
                            for e in task.train_examples[:8]
                        ]
                        active_rec = self.memory.register_skill(
                            skill_id=skill_id,
                            name=f"{task.family}_adapted",
                            purpose="Adapted after concept drift",
                            candidate=cand,
                            unit_tests=unit_tests,
                            validation_metrics={"held_out_accuracy": 1.0 - cand_err},
                            min_held_out_accuracy=0.70,
                        )
                        action_taken = "adapted_new_version"
                    else:
                        # High-noise / adversarial shock where no candidate fits cleanly: reject update and keep current skill!
                        action_taken = "rejected_noisy_shock_kept_prior"

        pred_cand = active_rec.to_candidate()
        held_out_acc = mean(
            int(pred_cand.predict_one(e["x"], e["y"]) == e["label"])
            for e in task.test_examples
        )
        mem_summary = self.memory.summary()
        return DriftStepOutcome(
            phase=phase,
            family=task.family,
            policy=policy,
            action_taken=action_taken,
            active_version=active_rec.version,
            batch_error_of_prior_skill=prior_batch_err,
            held_out_accuracy=held_out_acc,
            quarantined_versions=mem_summary["quarantined_skills"],
            rolled_back_versions=mem_summary["rolled_back_skills"],
        )


def _make_noisy_task(
    seed: int,
    family: str,
    params: Dict[str, Any],
    train_size: int,
    test_size: int,
    noise_prob: float,
    task_id: str,
) -> TaskSpec:
    clean_task = generate_grid_task(
        seed=seed,
        family=family,
        train_size=train_size,
        test_size=test_size,
        task_id=task_id,
        parameter_override=params,
    )
    if noise_prob <= 0.0:
        return clean_task
    noisy_train = corrupt_training_labels(clean_task.train_examples, noise_prob=noise_prob, seed=seed + 999)
    return TaskSpec(
        task_id=clean_task.task_id,
        family=clean_task.family,
        description=clean_task.description,
        train_examples=noisy_train,
        test_examples=clean_task.test_examples,
        metadata={**clean_task.metadata, "noise_prob": noise_prob},
    ).validate()


def run_drift_stream_episode(seed: int) -> Dict[str, Any]:
    t_a = 5 + (seed % 3)
    t_b = t_a + 4  # distinct shifted threshold
    phases = [
        ("phase_1_clean_regime_a", {"threshold": t_a}, 24, 0.00),
        ("phase_2_noisy_regime_a", {"threshold": t_a}, 10, 0.15),
        ("phase_3_abrupt_drift_regime_b", {"threshold": t_b}, 24, 0.05),
        ("phase_4_corrupted_batch_shock", {"threshold": t_b}, 10, 0.40),
        ("phase_5_recurring_regime_a", {"threshold": t_a}, 10, 0.15),
    ]

    policy_results: Dict[str, Any] = {}
    for policy in STREAM_POLICIES:
        controller = DriftAndNoiseController()
        phase_outcomes: Dict[str, Any] = {}
        for p_idx, (phase_name, params, train_sz, noise_p) in enumerate(phases):
            task = _make_noisy_task(
                seed=seed * 50 + p_idx + 1,
                family="sum_threshold",
                params=params,
                train_size=train_sz,
                test_size=24,
                noise_prob=noise_p,
                task_id=f"{phase_name}_s{seed}",
            )
            outcome = controller.step_task(phase_name, task, policy=policy)
            phase_outcomes[phase_name] = outcome.to_dict()

        policy_results[policy] = {
            "mean_stream_accuracy": mean(v["held_out_accuracy"] for v in phase_outcomes.values()),
            "phases": phase_outcomes,
            "memory_summary": controller.memory.summary(),
        }

    return {"seed": seed, "policies": policy_results}


def evaluate_noise_sensitivity_curve(
    seeds: List[int],
    noise_levels: Tuple[float, ...] = (0.00, 0.05, 0.10, 0.20),
    train_size: int = 24,
    test_size: int = 24,
) -> Dict[str, Any]:
    generator = CandidateGenerator()
    analyzer = TaskAnalyzer()
    selector = CandidateSelector(complexity_weight=0.01, reuse_bonus=0.0)
    families = ("sum_threshold", "parity", "diff_threshold", "coord_box")

    curve: Dict[str, Any] = {}
    for noise_p in noise_levels:
        accs: List[float] = []
        maj_accs: List[float] = []
        train_accs: List[float] = []
        for idx, seed in enumerate(seeds):
            fam = families[idx % len(families)]
            clean = generate_grid_task(
                seed=seed + 6000,
                family=fam,
                train_size=train_size,
                test_size=test_size,
            )
            noisy_train = corrupt_training_labels(clean.train_examples, noise_prob=noise_p, seed=seed + 7777)
            noisy_task = TaskSpec(
                task_id=f"noise_{noise_p}_{fam}_s{seed}",
                family=fam,
                description=clean.description,
                train_examples=noisy_train,
                test_examples=clean.test_examples,
                metadata=clean.metadata,
            )
            cands = generator.generate(
                allowed_actions=noisy_task.constraints.allowed_actions,
                include_composed=False,
                extra_families=list(families),
            )
            decision = selector.select(cands, noisy_train, analyzer.analyze(noisy_task))
            train_accs.append(decision.train_accuracy)
            accs.append(
                mean(
                    int(decision.selected.predict_one(e["x"], e["y"]) == e["label"])
                    for e in clean.test_examples
                )
            )
            maj_preds = MajorityBaselineModel().fit(noisy_train).predict(clean.test_examples)
            maj_accs.append(mean(int(p == e["label"]) for p, e in zip(maj_preds, clean.test_examples)))

        key = f"noise_{int(round(noise_p * 100)):02d}pct"
        curve[key] = {
            "noise_prob": noise_p,
            "mean_noisy_train_accuracy": mean(train_accs),
            "mean_clean_held_out_accuracy": mean(accs),
            "majority_baseline_accuracy": mean(maj_accs),
        }
    return curve


def evaluate_drift_and_noise_robustness(seeds: List[int]) -> Dict[str, Any]:
    if not seeds:
        raise ValueError("at least one seed required")

    rows = [run_drift_stream_episode(s) for s in seeds]
    phase_names = (
        "phase_1_clean_regime_a",
        "phase_2_noisy_regime_a",
        "phase_3_abrupt_drift_regime_b",
        "phase_4_corrupted_batch_shock",
        "phase_5_recurring_regime_a",
    )

    policies_summary: Dict[str, Any] = {}
    for policy in STREAM_POLICIES:
        per_phase = {
            p_name: mean(r["policies"][policy]["phases"][p_name]["held_out_accuracy"] for r in rows)
            for p_name in phase_names
        }
        policies_summary[policy] = {
            "mean_stream_held_out_accuracy": mean(
                r["policies"][policy]["mean_stream_accuracy"] for r in rows
            ),
            "per_phase_held_out_accuracy": per_phase,
        }

    guarded_actions = {
        p_name: {
            act: sum(
                1
                for r in rows
                if r["policies"]["guarded_drift_controller"]["phases"][p_name]["action_taken"] == act
            )
            for act in (
                "acquired_initial",
                "retained_under_noise",
                "adapted_new_version",
                "rejected_noisy_shock_kept_prior",
                "recovered_prior_version",
            )
            if sum(
                1
                for r in rows
                if r["policies"]["guarded_drift_controller"]["phases"][p_name]["action_taken"] == act
            )
            > 0
        }
        for p_name in phase_names
    }

    noise_curve = evaluate_noise_sensitivity_curve(seeds)

    g_acc = policies_summary["guarded_drift_controller"]["mean_stream_held_out_accuracy"]
    n_acc = policies_summary["naive_overwrite"]["mean_stream_held_out_accuracy"]
    s_acc = policies_summary["static_frozen"]["mean_stream_held_out_accuracy"]
    m_acc = policies_summary["majority_baseline"]["mean_stream_held_out_accuracy"]

    return {
        "n_seeds": len(rows),
        "stream_policies": policies_summary,
        "guarded_gain_over_baselines": {
            "vs_naive_overwrite": g_acc - n_acc,
            "vs_static_frozen": g_acc - s_acc,
            "vs_majority_baseline": g_acc - m_acc,
        },
        "guarded_phase_action_counts": guarded_actions,
        "noise_sensitivity_curve": noise_curve,
        "rows": rows,
        "limitations": [
            "Drift detection uses empirical batch error thresholds (noise_tolerance and max_adapt_batch_error).",
            "Severe noise (>25%) on small batches can blur the boundary between transient noise and gradual concept drift.",
        ],
    }
