"""Measure rule-family selection and held-out generalization."""
import argparse
import json
from pathlib import Path
from statistics import mean
from environment import RuleWorld
from agent import RuleDiscoveryAgent


def episode(seed, train_size=16, test_size=24):
    world = RuleWorld(seed)
    train, test = world.split(train_size, test_size)
    agent = RuleDiscoveryAgent().fit(train)
    predictions = agent.predict(test)
    accuracy = mean(int(pred == item["label"]) for pred, item in zip(predictions, test))
    return {
        "seed": seed,
        "true_family": world.family,
        "selected_family": agent.family,
        "family_selected_correctly": agent.family == world.family,
        "held_out_accuracy": accuracy,
        "train_size": len(train),
        "test_size": len(test),
    }


def evaluate(seeds, train_size=16, test_size=24):
    if not seeds:
        raise ValueError("at least one seed required")
    rows = [episode(seed, train_size, test_size) for seed in seeds]
    return {
        "n_seeds": len(rows),
        "train_size": train_size,
        "test_size": test_size,
        "rule_family_selection_rate": mean(float(r["family_selected_correctly"]) for r in rows),
        "mean_held_out_accuracy": mean(r["held_out_accuracy"] for r in rows),
        "rows": rows,
        "limitations": [
            "Only two hand-specified rule families are candidates; this is bounded hypothesis selection, not unrestricted rule discovery.",
            "All tasks use a small synthetic 8x8 grid with deterministic labels.",
            "The experiment does not demonstrate general intelligence, autonomous research, or real-world transfer.",
            "Results should be interpreted alongside per-seed rows and compared with a majority or random-family baseline before promotion.",
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
