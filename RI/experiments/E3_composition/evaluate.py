"""M4 paired-budget evaluation of composed, reset, and random policies."""
import argparse,json,random
from pathlib import Path
from statistics import mean
from agent import ComposedAgent
from environment import TwoStageWorld

def episode(seed,policy="composed",noise=0.0):
    rng=random.Random(seed); labels=("a","b")
    t1=rng.choice(labels); t2=rng.choice(labels)
    world=TwoStageWorld(t1,t2,seed+7000,noise,labels); agent=ComposedAgent()
    # Every policy receives the same four queries. The distinction is how evidence is used.
    obs={label:world.query(1,label) for label in labels}
    queries=2
    if policy=="random": chosen=rng.choice(labels)
    elif policy=="reset": chosen=rng.choice(labels)  # deliberately discards evidence
    else: chosen=agent.solve_stage(obs)
    first_ok=bool(chosen==t1 and obs[chosen]==1)
    world.commit_stage_one(chosen)
    obs2={label:world.query(2,label) for label in labels}; queries+=2
    if policy=="random": chosen2=rng.choice(labels)
    elif policy=="reset": chosen2=rng.choice(labels)
    else: chosen2=agent.solve_stage(obs2)
    second_ok=bool(chosen2==t2 and obs2[chosen2]==1)
    return {"seed":seed,"policy":policy,"success":first_ok and second_ok,
            "stage1_success":first_ok,"stage2_success":second_ok,"queries":queries,"noise":noise}
def evaluate(seeds,noise):
    policies=("composed","reset","random")
    rows=[episode(s,p,noise) for s in seeds for p in policies]
    summary={p:{"n":len([x for x in rows if x["policy"]==p]),
      "success_rate":mean(x["success"] for x in rows if x["policy"]==p),
      "mean_queries":mean(x["queries"] for x in rows if x["policy"]==p)} for p in policies}
    return {"n_seeds":len(seeds),"noise":noise,"policies":summary,"rows":rows,
      "limitations":["Equal query budgets; controls differ in evidence use.","Operations are hand-coded, not acquired autonomously.","Toy task is not a general-intelligence benchmark."]}
def main():
    p=argparse.ArgumentParser(); p.add_argument("--seeds",nargs="+",type=int,default=list(range(100)))
    p.add_argument("--noise",type=float,default=0.0); p.add_argument("--output",default="results/results.json"); a=p.parse_args()
    if not 0<=a.noise<.5:p.error("--noise must be in [0,.5)")
    data=evaluate(a.seeds,a.noise); out=Path(a.output); out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(data,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({k:v for k,v in data.items() if k!="rows"},indent=2))
if __name__=="__main__":main()
