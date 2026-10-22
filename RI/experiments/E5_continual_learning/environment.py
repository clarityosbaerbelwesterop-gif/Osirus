"""Seeded task outcomes; ground-truth probabilities remain inside the world."""
import random
class ContinualWorld:
    def __init__(self, seed):
        self.rng=random.Random(seed)
        self.__prob={"causal":.75,"sequence":.60,"composition":.40,"spatial":.80}
    def attempt(self, family):
        if family not in self.__prob: raise ValueError("unknown family")
        return int(self.rng.random()<self.__prob[family])
