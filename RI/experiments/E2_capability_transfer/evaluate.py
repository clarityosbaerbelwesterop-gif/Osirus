"""Reproducible first-pass evaluation for M3 capability transfer.

Interpret results narrowly: this is a diagnostic toy world, not a general intelligence benchmark.
"""
import argparse
import json
import random
from pathlib import Path
from statistics import mean, pstdev

from agent import Agent
from environment import InterventionWorld


def run_seed(seed: int, trials: int = 20, noise: float = 0.05):
    rng = random.Random(seed)
    target_a = rng.choice(("u", "v"))
    target_b = rng.choice(("u", "v"))
    while target_b == target_a:
        target_b = rng.choice(("u", "v"))

    world_a = InterventionWorld(target_a, noise, random.Random(seed + 1000))
    learner = Agent(random.Random(seed + 2000))
    for _ in range(8):
        action = learner.choose_intervention()
        learner.observe(action, world_a.query(action))
    capability = learner.export_capability()

    # Transfer test uses remapped labels. The capability is the procedure, not the
    # learned answer; the agent must gather new evidence in the new environment.
    remap = {"u": "v", "v": "u"}
    mapped_target = remap[target_b]
    world_b = InterventionWorld(mapped_target, noise, random.Random(seed + 3000))
    transfer_agent = Agent(random.Random(seed + 4000))
    transfer_agent.capability = capability
    for _ in range(trials):
        action = transfer_agent.choose_intervention()
        transfer_agent.observe(action, world_b.query(action))
    prediction = transfer_agent.predict_controlled_feature()
    return {
        "seed": seed,
        "source_target": target_a,
        "transfer_target_evaluator_only": mapped_target,
        "prediction": prediction,
        "correct": prediction == mapped_target,
        "queries": trials,
        "capability_verified": capability.verified,
        "noise": noise,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seeds", nargs="+", type=int, default=list(range(10)))
    parser.add_argument("--trials", type=int, default=20)
    parser.add_argument("--noise", type=float, default=0.05)
    parser.add_argument("--output", default="results/results.json")
    args = parser.parse_args()
    rows = [run_seed(s, args.trials, args.noise) for s in args.seeds]
    summary = {
        "n": len(rows),
        "accuracy": mean(row["correct"] for row in rows),
        "accuracy_population_sd": pstdev(row["correct"] for row in rows) if len(rows) > 1 else 0.0,
        "trials_per_seed": args.trials,
        "noise": args.noise,
        "rows": rows,
        "limitations": [
            "This first implementation does not yet establish genuine capability transfer.",
            "The current agent reinitializes feature scores in the transfer environment.",
            "Baselines and a valid blinded held-out protocol must be added before inferential claims.",
        ],
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k != "rows"}, indent=2))


if __name__ == "__main__":
    main()
