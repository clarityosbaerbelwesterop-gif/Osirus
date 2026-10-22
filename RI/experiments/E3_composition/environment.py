"""Two-stage hidden-control environment."""
import random
class TwoStageWorld:
    def __init__(self, first_correct, second_correct, seed, noise=0.0, labels=("a","b")):
        if first_correct not in labels or second_correct not in labels: raise ValueError("invalid hidden target")
        if not 0 <= noise < .5: raise ValueError("noise must be in [0, .5)")
        self._targets={1:first_correct,2:second_correct}; self._rng=random.Random(seed)
        self.noise=noise; self.labels=labels
    def query(self, stage, action):
        if stage not in self._targets: raise ValueError("stage must be 1 or 2")
        if action not in self.labels: raise ValueError("invalid action")
        result=int(action==self._targets[stage])
        return 1-result if self._rng.random()<self.noise else result
