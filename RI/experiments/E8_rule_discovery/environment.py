"""Procedurally generated tasks for choosing between two rule families."""
import random


class RuleWorld:
    """Hidden rule is either a sum threshold or even/odd parity of x+y."""

    FAMILIES = ("sum_threshold", "parity")

    def __init__(self, seed, family=None, threshold=None):
        if isinstance(seed, bool) or not isinstance(seed, int):
            raise ValueError("seed must be an integer")
        self.seed = seed
        self.rng = random.Random(seed)
        self.family = self.rng.choice(self.FAMILIES) if family is None else family
        if self.family not in self.FAMILIES:
            raise ValueError("unknown rule family")
        if threshold is not None and (isinstance(threshold, bool) or not isinstance(threshold, int)):
            raise ValueError("threshold must be an integer in [0, 14]")
        self.threshold = threshold if threshold is not None else self.rng.randint(4, 10)
        if not 0 <= self.threshold <= 14:
            raise ValueError("threshold must be in [0, 14]")
        self._post_init_rng_state = self.rng.getstate()

    def label(self, x, y):
        if isinstance(x, bool) or isinstance(y, bool) or not isinstance(x, int) or not isinstance(y, int):
            raise ValueError("coordinates must be integers")
        if not (0 <= x < 8 and 0 <= y < 8):
            raise ValueError("coordinates must be in [0, 7]")
        if self.family == "sum_threshold":
            return int(x + y >= self.threshold)
        return int((x + y) % 2 == 0)

    def all_examples(self):
        rng = random.Random()
        rng.setstate(self._post_init_rng_state)
        points = [(x, y) for x in range(8) for y in range(8)]
        rng.shuffle(points)
        return [{"x": x, "y": y, "label": self.label(x, y)} for x, y in points]

    def split(self, train_size=16, test_size=24):
        if (
            isinstance(train_size, bool)
            or isinstance(test_size, bool)
            or not isinstance(train_size, int)
            or not isinstance(test_size, int)
        ):
            raise ValueError("split sizes must be integers")
        if train_size < 1 or test_size < 1 or train_size + test_size > 64:
            raise ValueError("split sizes must be positive and sum to at most 64")
        examples = self.all_examples()
        return examples[:train_size], examples[train_size:train_size + test_size]
