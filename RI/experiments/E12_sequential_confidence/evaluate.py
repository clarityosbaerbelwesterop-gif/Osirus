"""M19 (E12) benchmark for adaptive sequential confidence, abstention and drift."""
import argparse
import json
import math
import os
import subprocess
import time
from pathlib import Path
from statistics import mean, stdev

from environment import TASKS, make_observations, make_drift_sequence
from sequential import sprt_bernoulli, empirical_bernstein_sequential, DualStreamDriftMonitor, guarded_promotion_decision

VERSION = "M19.E12.v1"
METHODS = ("fixed_m18_baseline", "sequential_sprt", "empirical_bernstein_sequential")
MAX_N = 4000
THRESHOLD = .85


def commit_hash():
    override = os.environ.get("RI_M19_IMPLEMENTATION_COMMIT")
    if override:
        return override
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], stderr=subprocess.DEVNULL, text=True).strip()
    except Exception:
        return "unknown"


def stats(vals, clamp_unit=True):
    if not vals:
        return {"n": 0, "mean": None, "ci95_low": None, "ci95_high": None}
    m = mean(vals)
    sd = stdev(vals) if len(vals) > 1 else 0.0
    hw = 1.96 * sd / math.sqrt(len(vals))
    lo, hi = m - hw, m + hw
    if clamp_unit:
        lo, hi = max(0.0, lo), min(1.0, hi)
    return {"n": len(vals), "mean": round(m, 6), "std": round(sd, 6),
            "ci95_low": round(lo, 6), "ci95_high": round(hi, 6)}


def rate_stats(flags):
    """Wilson 95% interval for a Bernoulli rate; nonzero upper bound at 0/n."""
    vals = [float(bool(v)) for v in flags]
    n = len(vals)
    if not n:
        return {"numerator": 0, "denominator": 0, "mean": None, "ci95_low": None, "ci95_high": None}
    successes = sum(vals)
    p = successes / n
    z = 1.96
    denom = 1.0 + z * z / n
    center = (p + z * z / (2.0 * n)) / denom
    radius = z * math.sqrt((p * (1.0 - p) / n) + (z * z / (4.0 * n * n))) / denom
    return {"numerator": int(successes), "denominator": n, "mean": round(p, 6),
            "ci95_low": round(max(0.0, center - radius), 6),
            "ci95_high": round(min(1.0, center + radius), 6)}


def observed_noise_fields(observations):
    """Estimate mismatch frequency using only the observations consumed by the method."""
    if not observations:
        return {"estimated_noise_rate": None, "estimated_noise_rate_wilson_95": None}
    errors = [int(x == 0) for x in observations]
    return {
        "estimated_noise_rate": round(mean(errors), 6),
        "estimated_noise_rate_wilson_95": rate_stats(errors),
    }


def run_method(method, observations):
    if not observations:
        return {"status": "abstain", "accepted_by_statistical_gate": False, "n": 0, "estimate": None,
                **observed_noise_fields([]),
                "reason": "no_identifying_evidence_available"}
    if method == "fixed_m18_baseline":
        prefix = observations[:14]
        estimate = sum(prefix) / len(prefix)
        accepted = estimate >= THRESHOLD
        return {"status": "accept_candidate" if accepted else "reject_candidate",
                "accepted_by_statistical_gate": accepted, "n": len(prefix), "estimate": estimate,
                **observed_noise_fields(prefix),
                "reason": "fixed_m18_14_example_accuracy_threshold"}
    if method == "sequential_sprt":
        result = sprt_bernoulli(observations, p0=.85, p1=.95, alpha=.05, beta=.10, max_n=MAX_N)
    elif method == "empirical_bernstein_sequential":
        result = empirical_bernstein_sequential(observations, threshold=THRESHOLD, alpha=.05, max_n=MAX_N)
    else:
        raise ValueError(method)
    accepted = result.status == "accept_candidate"
    guard = guarded_promotion_decision(result.status, independent_validation_pass=False,
                                       adversarial_checks_pass=False, regression_pass=False, rollback_available=False)
    used = observations[:result.n]
    return {"status": result.status, "accepted_by_statistical_gate": accepted,
            "m17_guard_example": guard, "n": result.n,
            "estimate": round(result.estimate, 6), **observed_noise_fields(used),
            "noise_rate_bound_from_accuracy_bounds": (
                [round(1.0 - result.upper_bound, 6), round(1.0 - result.lower_bound, 6)]
                if result.lower_bound is not None and result.upper_bound is not None else None),
            "lower_bound": result.lower_bound, "upper_bound": result.upper_bound,
            "log_likelihood_ratio": result.log_likelihood_ratio, "reason": result.reason}


def run_drift(seed, kind):
    monitor = DualStreamDriftMonitor(window=20, min_baseline=20, drop_threshold=.30, anchor_tolerance=.15)
    for target, anchor in make_drift_sequence(seed, kind):
        monitor.update(target, anchor)
        if monitor.alarm:
            break
    expected = None if kind == "stationary" else (
        "target_specific_drift" if kind in ("concept_drift", "gradual_drift", "recovery")
        else "common_mode_noise_or_environment_shift")
    return {"kind": kind, "detected": monitor.alarm, "detected_at": monitor.alarm_at,
            "expected_class": expected, "correct_classification": monitor.alarm == expected}


def evaluate(seeds):
    start = time.perf_counter()
    rows = []
    for seed in seeds:
        for task_name, task in TASKS.items():
            observations = make_observations(seed, task_name, MAX_N)
            for method in METHODS:
                outcome = run_method(method, observations)
                outcome.update({"seed": seed, "task": task_name, "method": method,
                                "ground_truth_quality": task.get("p_correct"),
                                "ground_truth_identifiable": task["identifiable"]})
                outcome["false_statistical_acceptance"] = bool(
                    outcome["accepted_by_statistical_gate"] and
                    (not task["identifiable"] or task.get("p_correct", 0) < THRESHOLD))
                p_true = task.get("p_correct")
                if not task["identifiable"]:
                    outcome["correct_action"] = not outcome["accepted_by_statistical_gate"]
                elif p_true is not None and p_true >= .95:
                    outcome["correct_action"] = outcome["accepted_by_statistical_gate"]
                elif p_true is not None and p_true <= .85:
                    outcome["correct_action"] = not outcome["accepted_by_statistical_gate"]
                else:
                    outcome["correct_action"] = None
                rows.append(outcome)

    task_summary = {}
    for method in METHODS:
        subset = [r for r in rows if r["method"] == method]
        seed_groups = [[r for r in subset if r["seed"] == seed] for seed in seeds]
        seed_groups = [g for g in seed_groups if g]
        accepted_flags = [bool(r["accepted_by_statistical_gate"]) for r in subset]
        false_flags = [bool(r["false_statistical_acceptance"]) for r in subset]
        valid_correctness = [r for r in subset if r["correct_action"] is not None]
        correct_flags = [bool(r["correct_action"]) for r in valid_correctness]
        task_summary[method] = {
            "observations_used_ci95_task_level": stats([float(r["n"]) for r in subset], clamp_unit=False),
            "mean_observations_used": round(mean([r["n"] for r in subset]), 3),
            "mean_observations_used_identifiable_only": round(
                mean([r["n"] for r in subset if r["ground_truth_identifiable"]]), 3),
            "mean_observations_used_seed_cluster_ci95": stats([mean([r["n"] for r in g]) for g in seed_groups], clamp_unit=False),
            "statistical_acceptance_rate": round(mean([float(x) for x in accepted_flags]), 6),
            "statistical_acceptance_rate_ci95_wilson": rate_stats(accepted_flags),
            "false_statistical_acceptance_rate": round(mean([float(x) for x in false_flags]), 6),
            "false_statistical_acceptance_rate_ci95_wilson_task_level": rate_stats(false_flags),
            "false_statistical_acceptance_rate_seed_cluster_ci95": stats(
                [mean([float(r["false_statistical_acceptance"]) for r in g]) for g in seed_groups]),
            "correct_action_rate_outside_indifference_region": round(mean([float(x) for x in correct_flags]), 6),
            "correct_action_rate_ci95_wilson": rate_stats(correct_flags),
            "inconclusive_rate": round(mean([float(r["status"] == "inconclusive") for r in subset]), 6),
            "abstention_rate": round(mean([float(r["status"] in ("inconclusive", "abstain")) for r in subset]), 6),
            "by_task": {}
        }
        for task_name in TASKS:
            ts = [r for r in subset if r["task"] == task_name]
            task_summary[method]["by_task"][task_name] = {
                "mean_n": round(mean([r["n"] for r in ts]), 3),
                "statistical_acceptance_rate": round(mean([float(r["accepted_by_statistical_gate"]) for r in ts]), 6),
                "false_statistical_acceptances": sum(int(r["false_statistical_acceptance"]) for r in ts),
                "n": len(ts),
                "inconclusive_rate": round(mean([float(r["status"] == "inconclusive") for r in ts]), 6),
            }

    fixed_identifiable_cost = task_summary["fixed_m18_baseline"]["mean_observations_used_identifiable_only"]
    for method in METHODS:
        cost = task_summary[method]["mean_observations_used_identifiable_only"]
        task_summary[method]["sample_cost_multiple_vs_fixed_identifiable"] = (
            round(cost / fixed_identifiable_cost, 4) if fixed_identifiable_cost else None
        )
        task_summary[method]["mean_identifiable_observations_saved_vs_fixed"] = round(
            fixed_identifiable_cost - cost, 3
        )

    drift_rows = []
    drift_kinds = ("stationary", "concept_drift", "gradual_drift", "noise_surge", "recovery")
    for seed in seeds:
        for kind in drift_kinds:
            result = run_drift(seed, kind)
            result["seed"] = seed
            drift_rows.append(result)
    drift_summary = {}
    for kind in drift_kinds:
        vals = [r for r in drift_rows if r["kind"] == kind]
        detected = [r["detected"] is not None for r in vals]
        correct = [r["correct_classification"] for r in vals]
        delays = [r["detected_at"] - 60 for r in vals if r["detected_at"] is not None and kind != "stationary"]
        drift_summary[kind] = {
            "n": len(vals), "alarm_rate": round(mean([float(x) for x in detected]), 6),
            "alarm_rate_ci95_wilson": rate_stats(detected),
            "correct_classification_rate": round(mean([float(x) for x in correct]), 6),
            "correct_classification_rate_ci95_wilson": rate_stats(correct),
            "mean_detection_delay_after_change": round(mean(delays), 3) if delays else None,
            "no_monitor_ablation": {
                "alarm_rate": 0.0,
                "missed_change_rate": 0.0 if kind == "stationary" else 1.0,
                "correct_classification_rate": 1.0 if kind == "stationary" else 0.0,
            },
        }

    return {
        "experiment_version": VERSION, "commit_hash": commit_hash(), "execution_status": "completed",
        "n_seeds": len(seeds), "seeds": list(seeds), "max_samples": MAX_N,
        "pre_registered": {"alpha": .05, "beta": .10, "accuracy_threshold": THRESHOLD,
                           "sprt_p0": .85, "sprt_p1": .95, "max_samples": MAX_N,
                           "baseline_samples": 14, "drift_window": 20},
        "methods": task_summary, "drift": drift_summary, "rows": rows,
        "total_runtime_ms": round((time.perf_counter() - start) * 1000, 3),
        "limitations": [
            "Synthetic Bernoulli validation streams and synthetic paired target/anchor probe streams only.",
            "Classical SPRT error guarantees require independent Bernoulli observations under p0/p1; the indifference region is not covered by those simple-hypothesis guarantees.",
            "The empirical-Bernstein method uses time-indexed alpha spending with a conservative radius; it assumes independent bounded observations and is not valid under unmodelled dependence or arbitrary drift.",
            "The fixed M18 comparison models its 14-example validation threshold but does not reproduce the entire M17 candidate lifecycle; these are statistical-gate decisions, not production promotions.",
            "Drift classification assumes stable calibration anchors. Without trustworthy reference signals, concept drift and higher observation noise may be indistinguishable.",
            "The M17 adapter never mutates productive SkillMemory; it only grants eligibility after all independent safety gates pass. The experiment does not switch the production M18 gate.",
            "No results establish general intelligence or real-world reliability beyond the tested synthetic domain."
        ]
    }


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--seeds", nargs="+", type=int, default=list(range(30)))
    parser.add_argument("--output", default="results/results.json")
    parser.add_argument("--summary-output", default="../../results/m19_summary.json")
    parser.add_argument("--ablation-output", default="../../results/m19_ablation_results.json")
    args = parser.parse_args(argv)
    data = evaluate(args.seeds)
    out = Path(args.output); out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    summary = {k: v for k, v in data.items() if k != "rows"}
    path = Path(args.summary_output); path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    ablation = {"experiment_version": VERSION, "commit_hash": data["commit_hash"], "n_seeds": data["n_seeds"],
                "methods": data["methods"], "drift": data["drift"], "pre_registered": data["pre_registered"],
                "limitations": data["limitations"]}
    path = Path(args.ablation_output); path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(ablation, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"version": VERSION, "n_seeds": len(args.seeds),
                      "mean_n": {m: data["methods"][m]["mean_observations_used"] for m in METHODS},
                      "false_statistical_acceptance_rate": {m: data["methods"][m]["false_statistical_acceptance_rate"] for m in METHODS},
                      "drift": data["drift"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
