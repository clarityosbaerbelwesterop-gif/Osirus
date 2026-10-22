"""Procedurally generated tasks for choosing between two rule families."""
import random


class RuleWorld:
    """Hidden rule is either a sum threshold or even/odd parity of x+y."""

    FAMILIES = ("sum_threshold", "parity")

    def __init__(self, seed, family=None, threshold=None):
        self.seed = seed
        self.rng = random.Random(seed)
        self.family = family or self.rng.choice(self.FAMILIES)
        if self.family not in self.FAMILIES:
            raise ValueError("unknown rule family")
        self.threshold = threshold if threshold is not None else self.rng.randint(4, 10)
        if not 0 <= self.threshold <= 14:
            raise ValueError("threshold must be in [0, 14]")

    def label(self, x, y):
        if self.family == "sum_threshold":
            return int(x + y >= self.threshold)
        return int((x + y) % 2 == 0)

    def all_examples(self):
        points = [(x, y) for x in range(8) for y in range(8)]
        self.rng.shuffle(points)
        return [{"x": x, "y": y, "label": self.label(x, y)} for x, y in points]

    def split(self, train_size=16, test_size=24):
        if train_size < 1 or test_size < 1 or train_size + test_size > 64:
            raise ValueError("split sizes must be positive and sum to at most 64")
        examples = self.all_examples()
        return examples[:train_size], examples[train_size:train_size + test_size]
