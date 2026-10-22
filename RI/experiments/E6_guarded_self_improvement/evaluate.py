"""Evaluate bounded config proposals on paired, held-out synthetic seeds.

This is a harness-mechanics test, not evidence of general intelligence.
"""
import argparse
import json
import random
from pathlib import Path
from statistics import mean
from agent import PolicyConfig, propose


def score(config, seed, n=100):
    rng = random.Random(seed)
    coverage = 0
    retained = 0
    for _ in range(n):
        seen = rng.random() < min(0.99, 0.45 + 0.35 * config.exploration)
        remembered = seen and rng.random() < min(0.99, 0.45 + 0.4 * config.memory_weight)
        coverage += seen
        retained += remembered
    return {"coverage": coverage / n, "retention": retained / n, "seed": seed}


def run(seeds, minimum_gain=0.01):
    if not seeds:
        raise ValueError("at least one seed required")
    # Each seed is evaluated under both configs to reduce noise; seeds are never
    # used to select the proposed parameter. This remains a synthetic objective.
    baseline = PolicyConfig().validate()
    candidate = propose(baseline, "retention").validate()
    base_rows = [score(baseline, seed) for seed in seeds]
    cand_rows = [score(candidate, seed) for seed in seeds]
    paired = [c["retention"] - b["retention"] for b, c in zip(base_rows, cand_rows)]
    b = mean(x["retention"] for x in base_rows)
    c = mean(x["retention"] for x in cand_rows)
    gain = c - b
    promoted = gain >= minimum_gain and candidate.exploration <= 1 and candidate.memory_weight <= 1
    return {
        "baseline_config": baseline.__dict__,
        "candidate_config": candidate.__dict__,
        "n_seeds": len(seeds),
        "baseline_mean": {k: mean(x[k] for x in base_rows) for k in ("coverage", "retention")},
        "candidate_mean": {k: mean(x[k] for x in cand_rows) for k in ("coverage", "retention")},
        "promotion_gate": {
            "primary_metric": "retention",
            "minimum_gain": minimum_gain,
            "baseline": b,
            "candidate": c,
            "mean_paired_gain": mean(paired),
            "promoted": promoted,
            "reason": "gain threshold and bounds passed" if promoted else "insufficient gain or bounds violation",
        },
        "rows": [{"baseline": x, "candidate": y, "paired_retention_gain": d}
                 for x, y, d in zip(base_rows, cand_rows, paired)],
        "limitations": [
            "Synthetic scoring function and proposed change are hand-authored.",
            "Paired seeds reduce variance but do not remove objective-design bias.",
            "Only allow-listed parameters change; arbitrary code is never rewritten or executed.",
            "Promotion is a simulation gate, not evidence of general intelligence.",
        ],
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--seeds", nargs="+", type=int, default=list(range(30)))
    p.add_argument("--minimum-gain", type=float, default=0.01)
    p.add_argument("--output", default="results/results.json")
    a = p.parse_args()
    if not a.seeds:
        p.error("at least one seed required")
    if not 0 <= a.minimum_gain <= 1:
        p.error("--minimum-gain must be in [0,1]")
    d = run(a.seeds, a.minimum_gain)
    o = Path(a.output)
    o.parent.mkdir(parents=True, exist_ok=True)
    o.write_text(json.dumps(d, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in d.items() if k != "rows"}, indent=2))


if __name__ == "__main__":
    main()
