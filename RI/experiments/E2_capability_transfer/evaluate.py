"""Paired-seed evaluation for operational capability use vs fair baselines."""
import argparse, json, random
from pathlib import Path
from statistics import mean
from agent import Agent
from environment import InterventionWorld


def episode(seed, budget=4, noise=0.15, policy="capability"):
    rng = random.Random(seed)
    target = rng.choice(("u", "v"))
    world = InterventionWorld(target, noise, random.Random(seed + 100_003))
    if policy == "fixed":
        # Same balanced schedule, deterministic order, no capability object.
        actions = ("u", "v")
        counts, positives, negatives = {}, {}, {}
        for i in range(budget):
            action = actions[i % 2]
            outcome = world.query(action)
            counts[action] = counts.get(action, 0) + 1
            if outcome: positives[action] = positives.get(action, 0) + 1
            else: negatives[action] = negatives.get(action, 0) + 1
        estimates = {x: (positives.get(x, 0)+1)/(counts.get(x, 0)+2) for x in actions}
        prediction = max(actions, key=lambda x: (estimates[x], x))
    else:
        agent = Agent(random.Random(seed + 200_003), use_capability=(policy == "capability"))
        for _ in range(budget):
            action = agent.choose_intervention()
            agent.observe(action, world.query(action))
        prediction = agent.predict_controlled_feature()
    return {"seed":seed,"policy":policy,"correct":prediction == target,
            "queries":budget,"prediction":prediction,"target":target,"noise":noise}


def evaluate(seeds, budget, noise):
    policies = ("capability", "random_ablation", "fixed")
    rows = [episode(s,budget,noise,p) for s in seeds for p in policies]
    summaries={}
    for policy in policies:
        subset=[x for x in rows if x["policy"]==policy]
        summaries[policy]={"n":len(subset),"accuracy":mean(x["correct"] for x in subset),
                           "mean_queries":mean(x["queries"] for x in subset)}
    paired={}
    for other in policies[1:]:
        paired[other]=mean(int(next(x for x in rows if x["seed"]==s and x["policy"]=="capability")["correct"]) -
                           int(next(x for x in rows if x["seed"]==s and x["policy"]==other)["correct"]) for s in seeds)
    return {"design":"paired seeds; ground truth is never passed to agent","budget_per_episode":budget,
            "noise":noise,"n_seeds":len(seeds),"policies":summaries,
            "paired_accuracy_difference":paired,"rows":rows,
            "limitations":["Toy binary task only; no evidence of general intelligence.",
              "The procedure is hand-specified, not yet acquired autonomously.",
              "This experiment tests active intervention selection, not cross-domain transfer."]}


def main():
    p=argparse.ArgumentParser(); p.add_argument("--seeds",nargs="+",type=int,default=list(range(100)))
    p.add_argument("--budget",type=int,default=4); p.add_argument("--noise",type=float,default=.15)
    p.add_argument("--output",default="results/results.json"); a=p.parse_args()
    if a.budget<1: p.error("--budget must be >= 1")
    if not 0<=a.noise<.5: p.error("--noise must be in [0, 0.5)")
    result=evaluate(a.seeds,a.budget,a.noise); out=Path(a.output); out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({k:v for k,v in result.items() if k!="rows"},indent=2))
if __name__=="__main__": main()
