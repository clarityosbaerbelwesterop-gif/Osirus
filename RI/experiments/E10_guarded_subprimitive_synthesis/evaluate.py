"""M17 (E10) — Evaluation, Fair Method Comparisons, Ablations, and Artifact Generation."""
import argparse
import json
import math
from pathlib import Path
from statistics import mean, stdev
import subprocess
import time
from typing import Any, Dict, List, Optional

from agent import (
    CANONICAL_PROBE_SCENES,
    PRE_REGISTERED_PROMOTION_GATE,
    CandidateRuleAST,
    M17GuardedSynthesizerAgent,
    MajorityReferenceBaseline,
)
from environment import (
    TASK_FAMILIES,
    M17TaskRule,
    SubPrimitiveSynthesisWorld,
    strip_labels,
)

EXPERIMENT_VERSION = "M17.E10.v1"
METHODS = (
    "m17_full_guarded_synthesis",
    "m16_unchanged_grammar",
    "enumerative_no_skill_memory",
    "synthesis_no_validation_guard",
    "synthesis_no_adversarial_checks",
    "random_or_majority_reference",
)


def get_git_commit_hash() -> str:
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=Path(__file__).resolve().parent,
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
        return out if out else "unknown"
    except Exception:
        return "unknown"


def clamped_ci95(values: List[float], clamp_unit: bool = True) -> Dict[str, float]:
    """Compute mean, std, and 95% confidence interval clamped to [0.0, 1.0] for probabilities/accuracies."""
    if not values:
        return {"mean": 0.0, "std": 0.0, "ci95_half_width": 0.0, "ci95_low": 0.0, "ci95_high": 0.0}
    m = mean(values)
    if len(values) < 2:
        s = 0.0
        hw = 0.0
    else:
        s = stdev(values)
        hw = 1.96 * s / math.sqrt(len(values))
    lo = m - hw
    hi = m + hw
    if clamp_unit:
        lo = max(0.0, min(1.0, lo))
        hi = max(0.0, min(1.0, hi))
        m = max(0.0, min(1.0, m))
    return {
        "mean": round(m, 6),
        "std": round(s, 6),
        "ci95_half_width": round(hw, 6),
        "ci95_low": round(lo, 6),
        "ci95_high": round(hi, 6),
    }


def score_predictions(preds: List[int], labeled_examples: List[Dict[str, Any]]) -> float:
    if not labeled_examples:
        return 0.0
    return mean(int(p == int(e["label"])) for p, e in zip(preds, labeled_examples))


def is_exact_rule_match(
    cand: Optional[CandidateRuleAST],
    ground_truth: M17TaskRule,
    test_examples: List[Dict[str, Any]],
) -> bool:
    if cand is None or not ground_truth.is_valid_target:
        return False
    for scene in CANONICAL_PROBE_SCENES:
        if cand.predict_scene_unchecked(scene) != ground_truth.evaluate(scene):
            return False
    for item in test_examples:
        if cand.predict_scene_unchecked(item["objects"]) != int(item["label"]):
            return False
    return True


def build_agent_for_method(method: str, seed: int) -> Optional[M17GuardedSynthesizerAgent]:
    if method == "m17_full_guarded_synthesis":
        return M17GuardedSynthesizerAgent(
            allow_subprimitive_synthesis=True,
            use_skill_memory=True,
            use_validation_guard=True,
            use_adversarial_checks=True,
            seed=seed,
        )
    if method == "m16_unchanged_grammar":
        return M17GuardedSynthesizerAgent(
            allow_subprimitive_synthesis=False,
            use_skill_memory=True,
            use_validation_guard=True,
            use_adversarial_checks=True,
            seed=seed,
        )
    if method == "enumerative_no_skill_memory":
        return M17GuardedSynthesizerAgent(
            allow_subprimitive_synthesis=True,
            use_skill_memory=False,
            use_validation_guard=False,
            use_adversarial_checks=False,
            seed=seed,
        )
    if method == "synthesis_no_validation_guard":
        return M17GuardedSynthesizerAgent(
            allow_subprimitive_synthesis=True,
            use_skill_memory=True,
            use_validation_guard=False,
            use_adversarial_checks=True,
            seed=seed,
        )
    if method == "synthesis_no_adversarial_checks":
        return M17GuardedSynthesizerAgent(
            allow_subprimitive_synthesis=True,
            use_skill_memory=True,
            use_validation_guard=True,
            use_adversarial_checks=False,
            seed=seed,
        )
    if method == "random_or_majority_reference":
        return None
    raise ValueError(f"unknown method: {method}")


def run_method_on_bundle(method: str, bundle) -> Dict[str, Any]:
    start = time.perf_counter()
    tasks = [bundle.family_a_task, bundle.family_b_task, bundle.family_c_task]

    if method == "random_or_majority_reference":
        task_results: Dict[str, Any] = {}
        for t in tasks:
            fam = t["family"]
            maj = MajorityReferenceBaseline(seed=bundle.seed).fit(t["train_examples"])
            preds_all = maj.predict_all(strip_labels(t["test_examples"]))
            preds_large = maj.predict_all(strip_labels(t["test_large_size_examples"]))
            task_results[fam] = {
                "held_out_accuracy": score_predictions(preds_all, t["test_examples"]),
                "large_size_held_out_accuracy": score_predictions(
                    preds_large, t["test_large_size_examples"]
                ),
                "exact_rule_recovered": False,
                "used_memory_composition": False,
                "promoted": False,
                "quarantined": False,
                "false_candidate_rejected": False,
                "false_promotion": False,
                "n_synthesized_candidates": 0,
                "n_validated_candidates": 0,
                "n_total_candidates_evaluated": 1,
                "status": "majority_reference",
                "selected_expression": f"constant({maj.majority_label})",
                "rejection_reasons": [],
            }
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        return {
            "tasks": task_results,
            "regression_drop_after_sequence": 0.0,
            "rollback_drill_passed": False,
            "active_skills_count": 0,
            "runtime_ms": round(elapsed_ms, 4),
        }

    agent = build_agent_for_method(method, bundle.seed)
    assert agent is not None
    agent.lock_regression_suite(bundle.locked_m16_regression_tasks)
    agent.acquire_warmup_base_skills(bundle.base_warmup_tasks)

    task_results = {}
    for t in tasks:
        fam = t["family"]
        outcome = agent.solve_task(t, regression_tasks=bundle.locked_m16_regression_tasks)
        sel: CandidateRuleAST = outcome["selected_candidate"]
        preds_all = sel.predict_all(strip_labels(t["test_examples"]))
        preds_large = sel.predict_all(strip_labels(t["test_large_size_examples"]))
        acc_all = score_predictions(preds_all, t["test_examples"])
        acc_large = score_predictions(preds_large, t["test_large_size_examples"])
        exact = is_exact_rule_match(sel, t["ground_truth_rule"], t["test_examples"])

        promoted = bool(outcome["promoted"])
        quarantined = bool(outcome["quarantined"])
        is_trap = fam == "C_spurious_and_noisy_traps"
        false_rejected = is_trap and not promoted
        false_promoted = is_trap and promoted
        rec = outcome["lifecycle_record"]

        task_results[fam] = {
            "held_out_accuracy": acc_all,
            "large_size_held_out_accuracy": acc_large,
            "exact_rule_recovered": exact,
            "used_memory_composition": bool(outcome["used_memory_composition"]),
            "promoted": promoted,
            "quarantined": quarantined,
            "false_candidate_rejected": false_rejected,
            "false_promotion": false_promoted,
            "n_synthesized_candidates": outcome["n_synthesized_candidates"],
            "n_validated_candidates": outcome["n_validated_candidates"],
            "n_total_candidates_evaluated": outcome["n_total_candidates_evaluated"],
            "status": outcome["status"],
            "selected_expression": sel.format_dsl(),
            "staged_candidate_expression": rec.candidate.format_dsl() if rec is not None else None,
            "rejection_reasons": list(rec.quarantine_or_rejection_reasons) if rec is not None else [],
        }

    reg_drop = agent.compute_regression_drop(bundle.locked_m16_regression_tasks)

    # Stage 6 Rollback Verification Drill: if at least one promotion occurred, verify that
    # snapshot rollback restores the exact pre-promotion version and active skill count.
    rollback_drill_passed = False
    if agent.library._snapshots:
        ver_before = agent.library.version
        skills_before = list(agent.library.active_skills)
        rec_before = list(agent.library.promoted_records)
        restored_ver = agent.library.rollback()
        rollback_drill_passed = (restored_ver == ver_before - 1) and (
            len(agent.library.active_skills) == len(skills_before) - 1
        )
        # Restore state after drill so final active_skills_count reflects actual run.
        agent.library.version = ver_before
        agent.library.active_skills = skills_before
        agent.library.promoted_records = rec_before
        if agent.library.rolled_back_records:
            agent.library.rolled_back_records.pop()

    elapsed_ms = (time.perf_counter() - start) * 1000.0
    return {
        "tasks": task_results,
        "regression_drop_after_sequence": reg_drop,
        "rollback_drill_passed": rollback_drill_passed,
        "active_skills_count": len(agent.library.active_skills),
        "runtime_ms": round(elapsed_ms, 4),
    }


def aggregate_method(rows: List[Dict[str, Any]], method: str) -> Dict[str, Any]:
    fam_a_acc = [r["methods"][method]["tasks"]["A_primitive_synthesis"]["held_out_accuracy"] for r in rows]
    fam_b_acc = [r["methods"][method]["tasks"]["B_composition_with_synthesized"]["held_out_accuracy"] for r in rows]
    fam_c_acc = [r["methods"][method]["tasks"]["C_spurious_and_noisy_traps"]["held_out_accuracy"] for r in rows]
    valid_ab_acc = fam_a_acc + fam_b_acc

    fam_a_large = [
        r["methods"][method]["tasks"]["A_primitive_synthesis"]["large_size_held_out_accuracy"]
        for r in rows
    ]
    fam_b_large = [
        r["methods"][method]["tasks"]["B_composition_with_synthesized"]["large_size_held_out_accuracy"]
        for r in rows
    ]
    valid_ab_large = fam_a_large + fam_b_large

    exact_a = [
        float(r["methods"][method]["tasks"]["A_primitive_synthesis"]["exact_rule_recovered"])
        for r in rows
    ]
    comp_b = [
        float(r["methods"][method]["tasks"]["B_composition_with_synthesized"]["exact_rule_recovered"])
        for r in rows
    ]
    used_mem_b = [
        float(r["methods"][method]["tasks"]["B_composition_with_synthesized"]["used_memory_composition"])
        for r in rows
    ]
    false_rej_c = [
        float(r["methods"][method]["tasks"]["C_spurious_and_noisy_traps"]["false_candidate_rejected"])
        for r in rows
    ]
    false_prom_c = [
        float(r["methods"][method]["tasks"]["C_spurious_and_noisy_traps"]["false_promotion"])
        for r in rows
    ]

    all_synth = [
        r["methods"][method]["tasks"][f]["n_synthesized_candidates"]
        for r in rows
        for f in TASK_FAMILIES
    ]
    all_val = [
        r["methods"][method]["tasks"][f]["n_validated_candidates"]
        for r in rows
        for f in TASK_FAMILIES
    ]
    all_eval = [
        r["methods"][method]["tasks"][f]["n_total_candidates_evaluated"]
        for r in rows
        for f in TASK_FAMILIES
    ]
    prom_a = [float(r["methods"][method]["tasks"]["A_primitive_synthesis"]["promoted"]) for r in rows]
    quar_c = [float(r["methods"][method]["tasks"]["C_spurious_and_noisy_traps"]["quarantined"]) for r in rows]
    reg_drops = [r["methods"][method]["regression_drop_after_sequence"] for r in rows]
    rollbacks = [float(r["methods"][method]["rollback_drill_passed"]) for r in rows]
    runtimes = [r["methods"][method]["runtime_ms"] for r in rows]

    return {
        "valid_tasks_ab_held_out_accuracy": clamped_ci95(valid_ab_acc, clamp_unit=True),
        "valid_tasks_ab_large_size_accuracy": clamped_ci95(valid_ab_large, clamp_unit=True),
        "family_a_primitive_synthesis": {
            "held_out_accuracy": clamped_ci95(fam_a_acc, clamp_unit=True),
            "large_size_accuracy": clamped_ci95(fam_a_large, clamp_unit=True),
            "exact_primitive_recovery_rate": clamped_ci95(exact_a, clamp_unit=True),
            "promotion_rate": round(mean(prom_a), 6),
        },
        "family_b_composition_with_synthesized": {
            "held_out_accuracy": clamped_ci95(fam_b_acc, clamp_unit=True),
            "large_size_accuracy": clamped_ci95(fam_b_large, clamp_unit=True),
            "exact_composition_recovery_rate": clamped_ci95(comp_b, clamp_unit=True),
            "memory_composition_usage_rate": round(mean(used_mem_b), 6),
        },
        "family_c_adversarial_traps": {
            "false_candidate_rejection_rate": clamped_ci95(false_rej_c, clamp_unit=True),
            "false_promotion_rate": clamped_ci95(false_prom_c, clamp_unit=True),
            "quarantine_rate": round(mean(quar_c), 6),
            "fallback_held_out_accuracy": clamped_ci95(fam_c_acc, clamp_unit=True),
        },
        "search_and_lifecycle_stats": {
            "mean_synthesized_candidates_per_task": round(mean(all_synth), 2),
            "mean_validated_candidates_per_task": round(mean(all_val), 2),
            "mean_total_candidates_evaluated_per_task": round(mean(all_eval), 2),
            "mean_regression_drop_on_locked_tasks": round(mean(reg_drops), 6),
            "regression_rate_on_prior_tasks": round(mean(float(d > 0.0) for d in reg_drops), 6),
            "rollback_verification_pass_rate": round(mean(rollbacks), 6),
            "mean_runtime_ms_per_seed": round(mean(runtimes), 4),
        },
    }


def evaluate(
    seeds: List[int],
    train_size: int = 18,
    val_size: int = 14,
    independent_size_val: int = 14,
    test_size: int = 36,
) -> Dict[str, Any]:
    if not seeds:
        raise ValueError("at least one seed required")
    commit_hash = get_git_commit_hash()

    rows: List[Dict[str, Any]] = []
    for seed in seeds:
        world = SubPrimitiveSynthesisWorld(seed)
        bundle = world.generate_bundle(
            train_size=train_size,
            val_size=val_size,
            independent_size_val=independent_size_val,
            test_size=test_size,
        )
        method_outcomes = {m: run_method_on_bundle(m, bundle) for m in METHODS}
        rows.append(
            {
                "seed": seed,
                "family_a_rule": bundle.family_a_task["ground_truth_rule"].to_dict(),
                "family_b_rule": bundle.family_b_task["ground_truth_rule"].to_dict(),
                "family_c_rule": bundle.family_c_task["ground_truth_rule"].to_dict(),
                "methods": method_outcomes,
            }
        )

    methods_summary = {m: aggregate_method(rows, m) for m in METHODS}

    # Collect concrete examples of promoted and rejected/quarantined candidates from seeds 0..2.
    promoted_examples = []
    rejected_examples = []
    for r in rows[:3]:
        m17_tasks = r["methods"]["m17_full_guarded_synthesis"]["tasks"]
        a_info = m17_tasks["A_primitive_synthesis"]
        c_info = m17_tasks["C_spurious_and_noisy_traps"]
        promoted_examples.append(
            {
                "seed": r["seed"],
                "target_rule": r["family_a_rule"]["subprimitive"],
                "promoted_expression": a_info["selected_expression"],
                "held_out_accuracy": a_info["held_out_accuracy"],
                "large_size_held_out_accuracy": a_info["large_size_held_out_accuracy"],
            }
        )
        rejected_examples.append(
            {
                "seed": r["seed"],
                "trap_type": r["family_c_rule"]["trap_type"],
                "staged_candidate": c_info["staged_candidate_expression"],
                "status": c_info["status"],
                "rejection_reasons": c_info["rejection_reasons"],
            }
        )

    # Paired comparisons: m17_full_guarded_synthesis minus each baseline on valid tasks (A + B) and trap rejection (C).
    paired_comparisons: Dict[str, Any] = {}
    for other in METHODS:
        if other == "m17_full_guarded_synthesis":
            continue
        ab_diffs = []
        false_prom_diffs = []
        for r in rows:
            m17_t = r["methods"]["m17_full_guarded_synthesis"]["tasks"]
            oth_t = r["methods"][other]["tasks"]
            for fam in ("A_primitive_synthesis", "B_composition_with_synthesized"):
                ab_diffs.append(m17_t[fam]["held_out_accuracy"] - oth_t[fam]["held_out_accuracy"])
            false_prom_diffs.append(
                float(m17_t["C_spurious_and_noisy_traps"]["false_promotion"])
                - float(oth_t["C_spurious_and_noisy_traps"]["false_promotion"])
            )
        paired_comparisons[other] = {
            "valid_tasks_ab_accuracy_gain": clamped_ci95(ab_diffs, clamp_unit=False),
            "false_promotion_rate_difference": clamped_ci95(false_prom_diffs, clamp_unit=False),
        }

    return {
        "commit_hash": commit_hash,
        "experiment_version": EXPERIMENT_VERSION,
        "execution_status": "completed",
        "n_seeds": len(seeds),
        "seeds": list(seeds),
        "split_sizes": {
            "train_size": train_size,
            "val_size": val_size,
            "independent_size_val": independent_size_val,
            "test_size": test_size,
        },
        "pre_registered_promotion_gate": dict(PRE_REGISTERED_PROMOTION_GATE),
        "task_families": list(TASK_FAMILIES),
        "methods": methods_summary,
        "paired_comparisons_m17_full_minus_other": paired_comparisons,
        "candidate_examples": {
            "promoted_subprimitives": promoted_examples,
            "rejected_or_quarantined_traps": rejected_examples,
        },
        "rows": rows,
        "limitations": [
            "Sub-primitive synthesis searches a bounded, typed relational DSL (48 candidate templates) rather than open-ended program synthesis.",
            "Ambiguous candidates (Trap 1) are quarantined using a finite set of unlabeled canonical probe scenes; subtler equivalences outside the probe distribution could remain undetected.",
            "All experiments run on synthetic relational object scenes on CPU and do not establish autonomous open-world self-improvement.",
        ],
    }


def write_m17_artifacts(
    data: Dict[str, Any],
    output_path: Path,
    summary_path: Optional[Path] = None,
    ablation_path: Optional[Path] = None,
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

    if summary_path is not None:
        summary_payload = {k: v for k, v in data.items() if k != "rows"}
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        summary_path.write_text(json.dumps(summary_payload, indent=2) + "\n", encoding="utf-8")

    if ablation_path is not None:
        ablation_methods = (
            "m17_full_guarded_synthesis",
            "synthesis_no_validation_guard",
            "synthesis_no_adversarial_checks",
            "enumerative_no_skill_memory",
            "m16_unchanged_grammar",
        )
        ablation_payload = {
            "commit_hash": data["commit_hash"],
            "experiment_version": data["experiment_version"],
            "execution_status": data["execution_status"],
            "n_seeds": data["n_seeds"],
            "pre_registered_promotion_gate": data["pre_registered_promotion_gate"],
            "ablation_variants": {m: data["methods"][m] for m in ablation_methods},
            "paired_comparisons_m17_full_minus_other": data["paired_comparisons_m17_full_minus_other"],
            "candidate_examples": data["candidate_examples"],
            "limitations": data["limitations"],
        }
        ablation_path.parent.mkdir(parents=True, exist_ok=True)
        ablation_path.write_text(json.dumps(ablation_payload, indent=2) + "\n", encoding="utf-8")


def main(argv: Optional[List[str]] = None) -> int:
    root_ri = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description="Run M17 E10 guarded sub-primitive synthesis benchmark.")
    parser.add_argument("--seeds", nargs="+", type=int, default=list(range(30)))
    parser.add_argument("--train-size", type=int, default=18)
    parser.add_argument("--val-size", type=int, default=14)
    parser.add_argument("--independent-size-val", type=int, default=14)
    parser.add_argument("--test-size", type=int, default=36)
    parser.add_argument("--output", default="results/results.json")
    parser.add_argument(
        "--summary-output",
        default=str(root_ri / "results/m17_summary.json"),
    )
    parser.add_argument(
        "--ablation-output",
        default=str(root_ri / "results/m17_ablation_results.json"),
    )
    args = parser.parse_args(argv)
    if args.train_size < 6 or args.val_size < 6 or args.independent_size_val < 6 or args.test_size < 12:
        parser.error("require train-size>=6, val-size>=6, independent-size-val>=6, test-size>=12")

    data = evaluate(
        seeds=args.seeds,
        train_size=args.train_size,
        val_size=args.val_size,
        independent_size_val=args.independent_size_val,
        test_size=args.test_size,
    )
    write_m17_artifacts(
        data,
        output_path=Path(args.output),
        summary_path=Path(args.summary_output) if args.summary_output else None,
        ablation_path=Path(args.ablation_output) if args.ablation_output else None,
    )
    compact = {
        "commit_hash": data["commit_hash"],
        "experiment_version": data["experiment_version"],
        "n_seeds": data["n_seeds"],
        "valid_tasks_ab_held_out_accuracy": {
            m: data["methods"][m]["valid_tasks_ab_held_out_accuracy"]["mean"] for m in METHODS
        },
        "family_a_exact_primitive_recovery": {
            m: data["methods"][m]["family_a_primitive_synthesis"]["exact_primitive_recovery_rate"]["mean"]
            for m in METHODS
        },
        "family_b_exact_composition_recovery": {
            m: data["methods"][m]["family_b_composition_with_synthesized"]["exact_composition_recovery_rate"]["mean"]
            for m in METHODS
        },
        "family_c_false_promotion_rate": {
            m: data["methods"][m]["family_c_adversarial_traps"]["false_promotion_rate"]["mean"]
            for m in METHODS
        },
    }
    print(json.dumps(compact, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
