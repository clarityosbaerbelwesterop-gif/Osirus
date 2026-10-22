"""Candidate skill learners: rule induction, nearest-neighbour, and majority."""
from collections import Counter


class ThresholdRuleLearner:
    def fit(self, examples):
        if not examples:
            raise ValueError("training examples must not be empty")
        candidates = range(1, 15)
        scored = []
        for threshold in candidates:
            errors = sum(int((e["x"] + e["y"] >= threshold) != bool(e["label"]))
                         for e in examples)
            scored.append((errors, threshold))
        self.threshold = min(scored)[1]
        return self

    def predict(self, point):
        if not hasattr(self, "threshold"):
            raise RuntimeError("fit must be called before predict")
        return int(point["x"] + point["y"] >= self.threshold)


class NearestNeighbour:
    def fit(self, examples):
        if not examples:
            raise ValueError("training examples must not be empty")
        self.examples = list(examples)
        return self

    def predict(self, point):
        nearest = min(self.examples, key=lambda e: (e["x"]-point["x"])**2 + (e["y"]-point["y"])**2)
        return int(nearest["label"])


class MajorityBaseline:
    def fit(self, examples):
        if not examples:
            raise ValueError("training examples must not be empty")
        labels = Counter(e["label"] for e in examples)
        self.label = min(labels, key=lambda y: (-labels[y], y))
        return self

    def predict(self, point):
        return int(self.label)
