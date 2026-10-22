"""
Evaluation for E1: Relationship Learning and Transfer
"""

import json
import time
import random
from typing import Dict, List, Any
from environment import SimulatedWorld
from baselines import RandomBaseline, MemorizeBaseline, MeanBaseline
from candidate import H1Candidate

def run_experiment(seed: int = 42, n_train: int = 100, n_test: int = 50) -> Dict[str, Any]:
    world = SimulatedWorld(seed=seed)
    agents = {
        "random": RandomBaseline(seed),
        "memorize": MemorizeBaseline(),
        "mean": MeanBaseline(),
        "h1": H1Candidate()
    }

    # Held-out combination for transfer test
    all_combos = world.get_all_combinations()
    rng = random.Random(seed)
    held_out = rng.choice(all_combos)
    train_combos = [c for c in all_combos if c != held_out]

    # Train phase: only from train_combos
    train_results = {name: [] for name in agents}
    start = time.time()

    for i in range(n_train):
        color, size = rng.choice(train_combos)
        obs = world.generate_observation(color, size)
        for name, agent in agents.items():
            pred = agent.predict(obs)
            train_results[name].append({
                "pred": pred,
                "true": obs["true_success"],
                "obs": {k: obs[k] for k in ["color", "size"]}
            })
            agent.update(obs, obs["success"])

    # Test phase: held-out combo and some train for comparison
    test_results = {name: [] for name in agents}
    # Focus on held-out for transfer
    for _ in range(n_test):
        color, size = held_out
        obs = world.generate_observation(color, size)
        for name, agent in agents.items():
            pred = agent.predict(obs)
            test_results[name].append({
                "pred": pred,
                "true": obs["true_success"],
                "combo": held_out,
                "held_out": True
            })

    runtime = time.time() - start

    # Metrics
    def compute_metrics(results: List) -> Dict:
        if not results:
            return {"acc": 0, "mse": 1}
        correct = sum(1 for r in results if (r["pred"] > 0.5) == r["true"])
        mse = sum((r["pred"] - (1 if r["true"] else 0))**2 for r in results) / len(results)
        return {"acc": correct / len(results), "mse": mse, "n": len(results)}

    summary = {
        "seed": seed,
        "n_train": n_train,
        "held_out_combo": held_out,
        "runtime_sec": runtime,
        "train": {name: compute_metrics(res) for name, res in train_results.items()},
        "test_heldout": {name: compute_metrics(res) for name, res in test_results.items()},
        "status": "executed"
    }
    return summary

def run_multiple_seeds(seeds: List[int] = [42, 123, 456]) -> Dict:
    all_results = []
    for s in seeds:
        res = run_experiment(seed=s)
        all_results.append(res)
    
    agg = {"seeds": seeds, "results": all_results}
    h1_accs = [r["test_heldout"]["h1"]["acc"] for r in all_results]
    mem_accs = [r["test_heldout"]["memorize"]["acc"] for r in all_results]
    mean_accs = [r["test_heldout"]["mean"]["acc"] for r in all_results]
    agg["summary"] = {
        "h1_mean_heldout_acc": sum(h1_accs)/len(h1_accs),
        "memorize_mean_heldout_acc": sum(mem_accs)/len(mem_accs),
        "mean_baseline_mean_heldout_acc": sum(mean_accs)/len(mean_accs),
        "h1_better_than_memorize": sum(h1_accs)/len(h1_accs) > sum(mem_accs)/len(mem_accs),
        "h1_better_than_mean": sum(h1_accs)/len(h1_accs) > sum(mean_accs)/len(mean_accs)
    }
    return agg

if __name__ == "__main__":
    results = run_multiple_seeds()
    print(json.dumps(results, indent=2))
    with open("results/e1_results.json", "w") as f:
        json.dump(results, f, indent=2)
    print("Results saved to results/e1_results.json")
