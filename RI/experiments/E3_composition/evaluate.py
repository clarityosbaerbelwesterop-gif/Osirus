"""Seeded evaluation of operation composition and controls."""
import argparse,json,random
from pathlib import Path
from statistics import mean
from agent import ComposedAgent
from environment import TwoStageWorld

def episode(seed, policy="composed", noise=0.0):
    rng=random.Random(seed); labels=("a","b")
    t1=rng.choice(labels); t2=rng.choice(labels)
    world=TwoStageWorld(t1,t2,seed+7000,noise,labels); agent=ComposedAgent()
    success=[]; queries=0
    for stage,target in ((1,t1),(2,t2)):
        if policy=="random":
            chosen=rng.choice(labels); outcome=world.query(stage,chosen); queries+=1
        else:
            obs={label:world.query(stage,label) for label in labels}; queries+=len(labels)
            chosen=agent.solve_stage(obs); outcome=obs[chosen]
        success.append(chosen==target and outcome==1)
    return {"seed":seed,"policy":policy,"success":all(success),"queries":queries}
def evaluate(seeds,noise):
    policies=("composed","reset","random")
    rows=[episode(s,p,noise) for s in seeds for p in policies]
    summary={p:{"n":len([r for r in rows if r["policy"]==p]),
      "success_rate":mean(r["success"] for r in rows if r["policy"]==p),
      "mean_queries":mean(r["queries"] for r in rows if r["policy"]==p)} for p in policies}
    return {"n_seeds":len(seeds),"noise":noise,"policies":summary,"rows":rows,
      "limitations":["Hand-coded operations; no autonomous acquisition.","Toy tasks do not establish general intelligence."]}
def main():
    p=argparse.ArgumentParser(); p.add_argument("--seeds",nargs="+",type=int,default=list(range(100)))
    p.add_argument("--noise",type=float,default=0.0); p.add_argument("--output",default="results/results.json"); a=p.parse_args()
    if not 0<=a.noise<.5:p.error("--noise must be in [0,.5)")
    data=evaluate(a.seeds,a.noise); out=Path(a.output); out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(data,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({k:v for k,v in data.items() if k!="rows"},indent=2))
if __name__=="__main__": main()
