"""Measure rule-family selection and held-out generalization against explicit baselines."""
import argparse
import json
from pathlib import Path
from statistics import mean
from environment import RuleWorld
from agent import (
    RuleDiscoveryAgent,
    MajorityBaseline,
    FixedThresholdBaseline,
    RandomHypothesisBaseline,
)


def _accuracy(predictions, examples):
    return mean(int(pred == item["label"]) for pred, item in zip(predictions, examples))


def episode(seed, train_size=16, test_size=24):
    world = RuleWorld(seed)
    train, test = world.split(train_size, test_size)

    agent = RuleDiscoveryAgent().fit(train)
    majority = MajorityBaseline().fit(train)
    fixed = FixedThresholdBaseline(threshold=7).fit(train)
    random_base = RandomHypothesisBaseline(seed=seed + 100_003).fit(train)

    predictions = agent.predict(test)
    accuracy = _accuracy(predictions, test)
    majority_acc = _accuracy(majority.predict(test), test)
    fixed_acc = _accuracy(fixed.predict(test), test)
    random_acc = _accuracy(random_base.predict(test), test)

    true_threshold = world.threshold if world.family == "sum_threshold" else None
    exact_rule_recovered = bool(
        agent.family == world.family
        and (world.family == "parity" or agent.threshold == world.threshold)
    )

    return {
        "seed": seed,
        "true_family": world.family,
        "true_threshold": true_threshold,
        "selected_family": agent.family,
        "selected_threshold": agent.threshold,
        "family_selected_correctly": agent.family == world.family,
        "exact_rule_recovered": exact_rule_recovered,
        "train_error": agent.train_error,
        "n_tied_candidates": len(agent.tied_candidates),
        "family_tie": agent.family_tie,
        "threshold_tie": agent.threshold_tie,
        "held_out_accuracy": accuracy,
        "baseline_family_selected_correctly": {
            "fixed_threshold": fixed.family == world.family,
            "random_hypothesis": random_base.family == world.family,
        },
        "baseline_held_out_accuracy": {
            "majority": majority_acc,
            "fixed_threshold": fixed_acc,
            "random_hypothesis": random_acc,
        },
        "train_size": len(train),
        "test_size": len(test),
    }


def evaluate(seeds, train_size=16, test_size=24):
    if not seeds:
        raise ValueError("at least one seed required")
    if (
        isinstance(train_size, bool)
        or isinstance(test_size, bool)
        or not isinstance(train_size, int)
        or not isinstance(test_size, int)
        or train_size < 1
        or test_size < 1
        or train_size + test_size > 64
    ):
        raise ValueError("train_size and test_size must be positive integers summing to at most 64")

    rows = [episode(seed, train_size, test_size) for seed in seeds]
    mean_acc = mean(r["held_out_accuracy"] for r in rows)
    majority_mean = mean(r["baseline_held_out_accuracy"]["majority"] for r in rows)
    fixed_mean = mean(r["baseline_held_out_accuracy"]["fixed_threshold"] for r in rows)
    random_mean = mean(r["baseline_held_out_accuracy"]["random_hypothesis"] for r in rows)

    by_true_family = {}
    for family in RuleWorld.FAMILIES:
        fam_rows = [r for r in rows if r["true_family"] == family]
        if fam_rows:
            by_true_family[family] = {
                "n_episodes": len(fam_rows),
                "rule_family_selection_rate": mean(
                    float(r["family_selected_correctly"]) for r in fam_rows
                ),
                "exact_rule_recovery_rate": mean(
                    float(r["exact_rule_recovered"]) for r in fam_rows
                ),
                "mean_held_out_accuracy": mean(r["held_out_accuracy"] for r in fam_rows),
            }
        else:
            by_true_family[family] = {
                "n_episodes": 0,
                "rule_family_selection_rate": None,
                "exact_rule_recovery_rate": None,
                "mean_held_out_accuracy": None,
            }

    return {
        "n_seeds": len(rows),
        "train_size": train_size,
        "test_size": test_size,
        "rule_family_selection_rate": mean(float(r["family_selected_correctly"]) for r in rows),
        "exact_rule_recovery_rate": mean(float(r["exact_rule_recovered"]) for r in rows),
        "mean_held_out_accuracy": mean_acc,
        "family_tie_rate": mean(float(r["family_tie"]) for r in rows),
        "threshold_tie_rate": mean(float(r["threshold_tie"]) for r in rows),
        "by_true_family": by_true_family,
        "baselines": {
            "majority": {
                "rule_family_selection_rate": None,
                "mean_held_out_accuracy": majority_mean,
            },
            "fixed_threshold": {
                "rule_family_selection_rate": mean(
                    float(r["baseline_family_selected_correctly"]["fixed_threshold"]) for r in rows
                ),
                "mean_held_out_accuracy": fixed_mean,
            },
            "random_hypothesis": {
                "rule_family_selection_rate": mean(
                    float(r["baseline_family_selected_correctly"]["random_hypothesis"]) for r in rows
                ),
                "mean_held_out_accuracy": random_mean,
            },
        },
        "mean_gain_over_baselines": {
            "majority": mean_acc - majority_mean,
            "fixed_threshold": mean_acc - fixed_mean,
            "random_hypothesis": mean_acc - random_mean,
        },
        "rows": rows,
        "limitations": [
            "Only two hand-specified rule families are candidates; this is bounded hypothesis selection, not unrestricted rule discovery.",
            "All tasks use a small synthetic 8x8 grid with deterministic labels.",
            "Tie-breaking favors sum_threshold and lower thresholds when small training sets leave multiple candidates with equal error.",
            "The experiment does not demonstrate general intelligence, autonomous research, or real-world transfer.",
        ],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seeds", nargs="+", type=int, default=list(range(30)))
    parser.add_argument("--train-size", type=int, default=16)
    parser.add_argument("--test-size", type=int, default=24)
    parser.add_argument("--output", default="results/results.json")
    args = parser.parse_args()
    if args.train_size < 1 or args.test_size < 1 or args.train_size + args.test_size > 64:
        parser.error("train-size and test-size must be positive and sum to at most 64")
    data = evaluate(args.seeds, args.train_size, args.test_size)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in data.items() if k != "rows"}, indent=2))


if __name__ == "__main__":
    main()
