"""M4 evaluation: composition must preserve and use a verified prerequisite."""
import argparse,json,random
from pathlib import Path
from statistics import mean
from agent import ComposedAgent
from environment import TwoStageWorld

def episode(seed,policy="composed",noise=0.0):
    rng=random.Random(seed); labels=("a","b")
    t1=rng.choice(labels); t2=rng.choice(labels)
    world=TwoStageWorld(t1,t2,seed+7000,noise,labels); agent=ComposedAgent()
    queries=0
    # Stage one: all policies receive identical evidence.
    obs={label:world.query(1,label) for label in labels}; queries+=2
    chosen=agent.solve_stage(obs)
    if policy=="reset":
        # Ablation: discard the verified prerequisite and guess it again.
        chosen=rng.choice(labels)
    first_ok=(chosen==t1 and obs[chosen]==1)
    # Stage two only yields informative feedback if prerequisite was solved.
    obs2={label:world.query(2,label) for label in labels}; queries+=2
    chosen2=agent.solve_stage(obs2)
    second_ok=(chosen2==t2 and obs2[chosen2]==1)
    return {"seed":seed,"policy":policy,"success":bool(first_ok and second_ok),
            "stage1_success":bool(first_ok),"stage2_success":bool(second_ok),
            "queries":queries,"noise":noise}
def evaluate(seeds,noise):
    policies=("composed","reset","random")
    rows=[]
    for s in seeds:
        for p in policies:
            if p=="random":
                # Fair budget control: one random choice at each stage; stage 2 may remain uninformative.
                rng=random.Random(s); labels=("a","b"); t1=rng.choice(labels); t2=rng.choice(labels)
                world=TwoStageWorld(t1,t2,s+7000,noise,labels)
                c1=rng.choice(labels); o1=world.query(1,c1)
                c2=rng.choice(labels); o2=world.query(2,c2)
                rows.append({"seed":s,"policy":p,"success":bool(c1==t1 and o1==1 and c2==t2 and o2==1),"stage1_success":bool(c1==t1 and o1==1),"stage2_success":bool(c2==t2 and o2==1),"queries":2,"noise":noise})
            else: rows.append(episode(s,p,noise))
    summary={p:{"n":len([x for x in rows if x["policy"]==p]),
      "success_rate":mean(x["success"] for x in rows if x["policy"]==p),
      "mean_queries":mean(x["queries"] for x in rows if x["policy"]==p)} for p in policies}
    return {"n_seeds":len(seeds),"noise":noise,"policies":summary,"rows":rows,
      "limitations":["The operation composition is hand-coded, not acquired autonomously.",
      "The sequential toy task is a mechanism test, not a general-intelligence benchmark."]}
def main():
    p=argparse.ArgumentParser(); p.add_argument("--seeds",nargs="+",type=int,default=list(range(100)))
    p.add_argument("--noise",type=float,default=0.0); p.add_argument("--output",default="results/results.json"); a=p.parse_args()
    if not 0<=a.noise<.5:p.error("--noise must be in [0,.5)")
    data=evaluate(a.seeds,a.noise); out=Path(a.output); out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(data,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({k:v for k,v in data.items() if k!="rows"},indent=2))
if __name__=="__main__":main()
