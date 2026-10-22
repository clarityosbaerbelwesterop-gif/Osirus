"""Sequential hidden-control world: stage 2 is informative only after stage 1 is solved."""
import random
class TwoStageWorld:
    def __init__(self, first_correct, second_correct, seed, noise=0.0, labels=("a","b")):
        if first_correct not in labels or second_correct not in labels: raise ValueError("invalid hidden target")
        if not 0 <= noise < .5: raise ValueError("noise must be in [0, .5)")
        self.__targets={1:first_correct,2:second_correct}
        self.__rng=random.Random(seed); self.noise=noise; self.labels=labels
        self.__stage_one_solved=False
    def query(self, stage, action):
        if stage not in (1,2): raise ValueError("stage must be 1 or 2")
        if action not in self.labels: raise ValueError("invalid action")
        if stage==1:
            result=int(action==self.__targets[1])
            if self.__rng.random()<self.noise: result=1-result
            if result==1: self.__stage_one_solved=True
            return result
        # The second relation can only be observed after stage 1 is correctly solved.
        if not self.__stage_one_solved: return 0
        result=int(action==self.__targets[2])
        return 1-result if self.__rng.random()<self.noise else result
