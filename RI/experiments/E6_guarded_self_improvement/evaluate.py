import argparse,json,random
from pathlib import Path
from agent import PolicyConfig,propose
def score(config,seed,n=100):
    rng=random.Random(seed); coverage=0; retained=0
    for _ in range(n):
        seen=rng.random()<min(.99,.45+.35*config.exploration)
        remembered=seen and rng.random()<min(.99,.45+.4*config.memory_weight)
        coverage+=seen;retained+=remembered
    return {"coverage":coverage/n,"retention":retained/n,"seed":seed}
def run(seeds):
    baseline=PolicyConfig(); base=[score(baseline,s) for s in seeds]
    primary="retention"; weakest="retention"
    candidate=propose(baseline,weakest)
    cand=[score(candidate,s) for s in seeds]
    b=sum(x[primary] for x in base)/len(base); c=sum(x[primary] for x in cand)/len(cand)
    promoted=c>b and candidate.exploration<=1 and candidate.memory_weight<=1
    return {"baseline_config":baseline.__dict__,"candidate_config":candidate.__dict__,
      "baseline_mean":{k:sum(x[k] for x in base)/len(base) for k in ("coverage","retention")},
      "candidate_mean":{k:sum(x[k] for x in cand)/len(cand) for k in ("coverage","retention")},
      "promotion_gate":{"primary_metric":primary,"baseline":b,"candidate":c,"promoted":promoted},
      "rows":[{"baseline":x,"candidate":y} for x,y in zip(base,cand)],
      "limitations":["Synthetic scoring function is hand-authored.","Not recursive self-modification; only allow-listed parameters change.","Promotion on synthetic metrics is not evidence of general intelligence."]}
def main():
    p=argparse.ArgumentParser();p.add_argument("--seeds",nargs="+",type=int,default=list(range(30)));p.add_argument("--output",default="results/results.json");a=p.parse_args()
    if not a.seeds:p.error("at least one seed required")
    d=run(a.seeds);o=Path(a.output);o.parent.mkdir(parents=True,exist_ok=True);o.write_text(json.dumps(d,indent=2)+"\n");print(json.dumps({k:v for k,v in d.items() if k!="rows"},indent=2))
if __name__=="__main__":main()
