"""Procedurally generated concept-learning tasks with train/test separation."""
import random


class ThresholdWorld:
    def __init__(self, seed, threshold=None):
        self.rng = random.Random(seed)
        self.threshold = threshold if threshold is not None else self.rng.randint(4, 10)

    def sample(self, count):
        # Exclude exact duplicates within a split by drawing from a finite grid.
        points = [(x, y) for x in range(0, 8) for y in range(0, 8)]
        self.rng.shuffle(points)
        return [{"x": x, "y": y, "label": int(x + y >= self.threshold)}
                for x, y in points[:count]]
