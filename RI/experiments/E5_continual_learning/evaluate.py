import argparse,json
from pathlib import Path
from statistics import mean
from agent import ContinualAgent
from environment import ContinualWorld
FAMILIES=("causal","sequence","composition","spatial")
def episode(seed,policy="persistent",steps=120):
    world=ContinualWorld(seed); agent=ContinualAgent(); outcomes=[]
    for i in range(steps):
        family=FAMILIES[(i*3 + seed)%len(FAMILIES)]
        outcome=world.attempt(family); outcomes.append(outcome)
        if policy=="reset": agent.reset_current(family)
        agent.observe(family,outcome)
    brier=[]
    # Score predictions on a separate, seeded held-out sample per family.
    test=ContinualWorld(seed+100000)
    for family in FAMILIES:
        scores=[]
        for _ in range(30):
            y=test.attempt(family); scores.append((agent.predict(family)-y)**2)
        brier.append(mean(scores))
    return {"seed":seed,"policy":policy,"brier":mean(brier),"counts":dict(agent.alpha)}
def evaluate(seeds,steps):
    rows=[episode(s,p,steps) for s in seeds for p in ("persistent","reset")]
    summary={p:{"mean_brier":mean(r["brier"] for r in rows if r["policy"]==p)} for p in ("persistent","reset")}
    return {"n_seeds":len(seeds),"steps":steps,"policies":summary,"rows":rows,
            "limitations":["Toy stationary task probabilities.","Reset baseline is intentionally memory-poor.","No evidence of general intelligence."]}
def main():
    p=argparse.ArgumentParser();p.add_argument("--seeds",nargs="+",type=int,default=list(range(30)));p.add_argument("--steps",type=int,default=120);p.add_argument("--output",default="results/results.json");a=p.parse_args()
    if a.steps<1:p.error("--steps must be >=1")
    d=evaluate(a.seeds,a.steps);o=Path(a.output);o.parent.mkdir(parents=True,exist_ok=True);o.write_text(json.dumps(d,indent=2)+"\n");print(json.dumps({k:v for k,v in d.items() if k!="rows"},indent=2))
if __name__=="__main__":main()
