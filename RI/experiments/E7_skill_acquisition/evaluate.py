"""Evaluate acquired-rule generalization on held-out points and unseen rule thresholds."""
import argparse
import json
from pathlib import Path
from statistics import mean
from environment import ThresholdWorld
from agent import ThresholdRuleLearner, NearestNeighbour, MajorityBaseline


def accuracy(model, examples):
    return mean(int(model.predict(e) == e["label"]) for e in examples)


def episode(seed, train_size=12, test_size=24):
    world = ThresholdWorld(seed)
    train = world.sample(train_size)
    # A disjoint grid sample; labels are hidden from models until prediction scoring.
    test = world.sample(64)
    train_points = {(e["x"], e["y"]) for e in train}
    test = [e for e in test if (e["x"], e["y"]) not in train_points][:test_size]
    if not test:
        raise RuntimeError("held-out split unexpectedly empty")
    models = {
        "induced_threshold_rule": ThresholdRuleLearner().fit(train),
        "nearest_neighbour": NearestNeighbour().fit(train),
        "majority": MajorityBaseline().fit(train),
    }
    return {"seed": seed, "hidden_threshold": world.threshold,
            "train_size": len(train), "test_size": len(test),
            "accuracy": {name: accuracy(model, test) for name, model in models.items()}}


def evaluate(seeds, train_size, test_size):
    if not seeds:
        raise ValueError("at least one seed required")
    rows = [episode(seed, train_size, test_size) for seed in seeds]
    names = rows[0]["accuracy"].keys()
    return {"n_seeds": len(seeds), "train_size": train_size, "requested_test_size": test_size,
            "mean_held_out_accuracy": {name: mean(row["accuracy"][name] for row in rows) for name in names},
            "rows": rows,
            "limitations": [
                "The hypothesis class (sum-threshold rules) is known to the rule learner.",
                "This tests generalization within a narrow synthetic family, not open-ended skill discovery.",
                "Thresholds and task generator are simple; broader task families are required.",
                "Held-out examples are disjoint from training examples but come from the same grid and rule.",
            ]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seeds", nargs="+", type=int, default=list(range(30)))
    parser.add_argument("--train-size", type=int, default=12)
    parser.add_argument("--test-size", type=int, default=24)
    parser.add_argument("--output", default="results/results.json")
    args = parser.parse_args()
    if args.train_size < 1 or not 1 <= args.test_size <= 64 - args.train_size:
        parser.error("require train-size >= 1 and test-size in [1, 64-train-size]")
    data = evaluate(args.seeds, args.train_size, args.test_size)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, indent=2) + "\\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in data.items() if k != "rows"}, indent=2))


if __name__ == "__main__":
    main()
