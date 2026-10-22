"""Paired-seed evaluation of operational capability use versus ablations."""
import argparse
import json
import random
from pathlib import Path
from statistics import mean
from agent import Agent
from environment import InterventionWorld


def episode(seed, budget=4, noise=0.15, policy="capability"):
    rng = random.Random(seed)
    target = rng.choice(("u", "v"))
    world = InterventionWorld(target, noise, random.Random(seed + 100_003))
    agent = Agent(random.Random(seed + 200_003),
                  use_capability=(policy == "capability"))
    for _ in range(budget):
        action = agent.choose_intervention()
        agent.observe(action, world.query(action))
    prediction = agent.predict_controlled_feature()
    return {"seed": seed, "policy": policy, "correct": prediction == target,
            "queries": budget, "prediction": prediction,
            "target": target, "noise": noise}


def evaluate(seeds, budget, noise):
    policies = ("capability", "random_ablation")
    rows = [episode(s, budget, noise, p) for s in seeds for p in policies]
    by_policy = {}
    for policy in policies:
        subset = [row for row in rows if row["policy"] == policy]
        by_policy[policy] = {
            "n": len(subset),
            "accuracy": mean(row["correct"] for row in subset),
            "mean_queries": mean(row["queries"] for row in subset),
        }
    paired = []
    for seed in seeds:
        pair = {row["policy"]: row for row in rows if row["seed"] == seed}
        paired.append(int(pair["capability"]["correct"]) -
                      int(pair["random_ablation"]["correct"]))
    return {
        "design": "paired seeds; evaluator target not passed into agent",
        "budget_per_episode": budget, "noise": noise, "n_seeds": len(seeds),
        "policies": by_policy, "paired_accuracy_difference": mean(paired),
        "rows": rows,
        "limitations": [
            "Toy binary intervention task only; no evidence of general intelligence.",
            "The capability is a hand-specified experimental procedure, not yet acquired autonomously.",
            "A positive result would support only the utility of balanced interventions in this task.",
            "Multiple task families and stronger baselines are required before a transfer claim."
        ]
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seeds", nargs="+", type=int, default=list(range(100)))
    parser.add_argument("--budget", type=int, default=4)
    parser.add_argument("--noise", type=float, default=0.15)
    parser.add_argument("--output", default="results/results.json")
    args = parser.parse_args()
    if args.budget < 1:
        parser.error("--budget must be >= 1")
    result = evaluate(args.seeds, args.budget, args.noise)
    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k != "rows"}, indent=2))


if __name__ == "__main__":
    main()
