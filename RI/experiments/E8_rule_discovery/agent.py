"""Small, explicit hypothesis search and baselines; no claim of open-ended discovery."""
from collections import Counter
import random


def _validate_examples(examples, require_labels=True):
    if not examples:
        raise ValueError("examples must not be empty")
    for item in examples:
        if not isinstance(item, dict) or "x" not in item or "y" not in item:
            raise ValueError("each example must be a dict with 'x' and 'y'")
        x, y = item["x"], item["y"]
        if isinstance(x, bool) or isinstance(y, bool) or not isinstance(x, int) or not isinstance(y, int):
            raise ValueError("example coordinates must be integers")
        if not (0 <= x < 8 and 0 <= y < 8):
            raise ValueError("example coordinates must be in [0, 7]")
        if require_labels:
            if "label" not in item or item["label"] not in (0, 1) or isinstance(item["label"], bool):
                raise ValueError("example label must be 0 or 1")


class RuleDiscoveryAgent:
    """Bounded hypothesis search over sum_threshold (0..14) and even parity."""

    def __init__(self):
        self.family = None
        self.threshold = None
        self.train_error = None
        self.tied_candidates = []
        self.family_tie = False
        self.threshold_tie = False

    @staticmethod
    def _predict(family, threshold, x, y):
        if family == "sum_threshold":
            return int(x + y >= threshold)
        if family == "parity":
            return int((x + y) % 2 == 0)
        raise ValueError("unknown family")

    def fit(self, examples):
        _validate_examples(examples, require_labels=True)
        candidates = []
        for threshold in range(0, 15):
            errors = sum(
                self._predict("sum_threshold", threshold, e["x"], e["y"]) != e["label"]
                for e in examples
            )
            candidates.append((errors, "sum_threshold", threshold))
        errors = sum(
            self._predict("parity", None, e["x"], e["y"]) != e["label"]
            for e in examples
        )
        candidates.append((errors, "parity", None))

        min_error = min(c[0] for c in candidates)
        best = [(fam, thr) for err, fam, thr in candidates if err == min_error]
        tied_families = {fam for fam, _ in best}
        sum_ties = [thr for fam, thr in best if fam == "sum_threshold"]

        # Stable tie-break: sum-threshold candidates are considered first in ascending threshold order.
        self.train_error = min_error
        self.tied_candidates = best
        self.family_tie = len(tied_families) > 1
        self.threshold_tie = len(sum_ties) > 1
        self.family, self.threshold = best[0]
        return self

    def predict_one(self, x, y):
        if self.family is None:
            raise RuntimeError("fit must be called before prediction")
        if isinstance(x, bool) or isinstance(y, bool) or not isinstance(x, int) or not isinstance(y, int):
            raise ValueError("coordinates must be integers")
        return self._predict(self.family, self.threshold, x, y)

    def predict(self, examples):
        if self.family is None:
            raise RuntimeError("fit must be called before prediction")
        _validate_examples(examples, require_labels=False)
        return [self.predict_one(e["x"], e["y"]) for e in examples]


class MajorityBaseline:
    """Predicts the most frequent training label (deterministic tie-break to 0)."""

    def __init__(self):
        self.family = "majority_constant"
        self.threshold = None
        self.majority_label = None

    def fit(self, examples):
        _validate_examples(examples, require_labels=True)
        counts = Counter(e["label"] for e in examples)
        self.majority_label = min(counts, key=lambda label: (-counts[label], label))
        return self

    def predict_one(self, x, y):
        if self.majority_label is None:
            raise RuntimeError("fit must be called before prediction")
        return int(self.majority_label)

    def predict(self, examples):
        if self.majority_label is None:
            raise RuntimeError("fit must be called before prediction")
        _validate_examples(examples, require_labels=False)
        return [self.predict_one(e["x"], e["y"]) for e in examples]


class FixedThresholdBaseline:
    """Fixed hypothesis baseline that always uses sum_threshold with a fixed threshold."""

    def __init__(self, threshold=7):
        if isinstance(threshold, bool) or not isinstance(threshold, int) or not 0 <= threshold <= 14:
            raise ValueError("threshold must be an integer in [0, 14]")
        self.family = "sum_threshold"
        self.threshold = threshold
        self._fitted = False

    def fit(self, examples):
        _validate_examples(examples, require_labels=True)
        self._fitted = True
        return self

    def predict_one(self, x, y):
        if not self._fitted:
            raise RuntimeError("fit must be called before prediction")
        return int(x + y >= self.threshold)

    def predict(self, examples):
        if not self._fitted:
            raise RuntimeError("fit must be called before prediction")
        _validate_examples(examples, require_labels=False)
        return [self.predict_one(e["x"], e["y"]) for e in examples]


class RandomHypothesisBaseline:
    """Seeded random hypothesis baseline sampling uniformly over the two rule families."""

    def __init__(self, seed=0):
        if isinstance(seed, bool) or not isinstance(seed, int):
            raise ValueError("seed must be an integer")
        self.seed = seed
        self.family = None
        self.threshold = None

    def fit(self, examples):
        _validate_examples(examples, require_labels=True)
        rng = random.Random(self.seed)
        self.family = rng.choice(("sum_threshold", "parity"))
        self.threshold = rng.randint(4, 10) if self.family == "sum_threshold" else None
        return self

    def predict_one(self, x, y):
        if self.family is None:
            raise RuntimeError("fit must be called before prediction")
        return RuleDiscoveryAgent._predict(self.family, self.threshold, x, y)

    def predict(self, examples):
        if self.family is None:
            raise RuntimeError("fit must be called before prediction")
        _validate_examples(examples, require_labels=False)
        return [self.predict_one(e["x"], e["y"]) for e in examples]
