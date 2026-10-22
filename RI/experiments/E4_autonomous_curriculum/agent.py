"""Auditable heuristic for selecting the next learning task."""
from dataclasses import dataclass,field
import random
@dataclass
class CurriculumAgent:
 policy:str="uncertainty_reuse"
 rng:random.Random=field(default_factory=random.Random)
 families:tuple=("causal","sequence","composition","spatial")
 positive:dict=field(default_factory=dict)
 total:dict=field(default_factory=dict)
 def priority(self,f):
  n=self.total.get(f,0); pos=self.positive.get(f,0)
  uncertainty=1/(n+1); estimated_error=1-(pos+1)/(n+2)
  reuse={"causal":1.0,"sequence":.8,"composition":1.4,"spatial":.7}.get(f,1.0)
  if self.policy=="error_only": return estimated_error
  return uncertainty+estimated_error+reuse/(n+1)
 def choose_task(self,step=0):
  if self.policy=="random": return self.rng.choice(self.families)
  if self.policy=="fixed": return self.families[step%len(self.families)]
  scores={f:self.priority(f) for f in self.families}; best=max(scores.values())
  return self.rng.choice(sorted(f for f,v in scores.items() if v==best))
 def update(self,f,success):
  self.total[f]=self.total.get(f,0)+1
  self.positive[f]=self.positive.get(f,0)+int(bool(success))
