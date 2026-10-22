"""Synthetic learning tasks with evaluator-side success probabilities."""
import random
class CurriculumWorld:
 def __init__(self,seed,noise=.1):
  if not 0<=noise<.5: raise ValueError("noise must be in [0,.5)")
  self.rng=random.Random(seed); self.noise=noise
  self._base={"causal":.65,"sequence":.55,"composition":.35,"spatial":.75}
 def attempt(self,family,experience):
  if family not in self._base: raise ValueError("unknown family")
  p=min(.95,self._base[family]+.025*experience)
  result=int(self.rng.random()<p)
  return 1-result if self.rng.random()<self.noise else result
