"""Compare curriculum policies on fixed seeds."""
import argparse,json
from pathlib import Path
from statistics import mean
from agent import CurriculumAgent
from environment import CurriculumWorld
def episode(seed,policy,steps=80,noise=.1):
 a=CurriculumAgent(policy); a.rng.seed(seed+5000); w=CurriculumWorld(seed+1000,noise); rewards=[]
 for step in range(steps):
  f=a.choose_task(step); result=w.attempt(f,a.total.get(f,0)); a.update(f,result); rewards.append(result)
 return {"seed":seed,"policy":policy,"mean_success":mean(rewards),"coverage":len(a.total),"counts":a.total}
def evaluate(seeds,steps,noise):
 policies=("uncertainty_reuse","random","fixed","error_only")
 rows=[episode(s,p,steps,noise) for s in seeds for p in policies]
 return {"n_seeds":len(seeds),"steps":steps,"noise":noise,
  "policies":{p:{"mean_success":mean(r["mean_success"] for r in rows if r["policy"]==p),
  "mean_coverage":mean(r["coverage"] for r in rows if r["policy"]==p)} for p in policies},
  "rows":rows,"limitations":["Synthetic probabilities are hand-chosen.","Priority rule is hand-designed, not autonomously discovered."]}
def main():
 p=argparse.ArgumentParser(); p.add_argument("--seeds",nargs="+",type=int,default=list(range(100)))
 p.add_argument("--steps",type=int,default=80); p.add_argument("--noise",type=float,default=.1); p.add_argument("--output",default="results/results.json"); x=p.parse_args()
 if x.steps<1:p.error("--steps must be >=1")
 if not 0<=x.noise<.5:p.error("--noise must be in [0,.5)")
 d=evaluate(x.seeds,x.steps,x.noise); out=Path(x.output); out.parent.mkdir(parents=True,exist_ok=True)
 out.write_text(json.dumps(d,indent=2)+"\n",encoding="utf-8"); print(json.dumps({k:v for k,v in d.items() if k!="rows"},indent=2))
if __name__=="__main__":main()
