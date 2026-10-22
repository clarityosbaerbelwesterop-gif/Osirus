"""Small, explicit hypothesis search; no claim of open-ended discovery."""


class RuleDiscoveryAgent:
    def __init__(self):
        self.family = None
        self.threshold = None

    @staticmethod
    def _predict(family, threshold, x, y):
        if family == "sum_threshold":
            return int(x + y >= threshold)
        if family == "parity":
            return int((x + y) % 2 == 0)
        raise ValueError("unknown family")

    def fit(self, examples):
        if not examples:
            raise ValueError("training examples must not be empty")
        candidates = []
        for threshold in range(0, 15):
            errors = sum(self._predict("sum_threshold", threshold, e["x"], e["y"]) != e["label"]
                         for e in examples)
            candidates.append((errors, "sum_threshold", threshold))
        errors = sum(self._predict("parity", None, e["x"], e["y"]) != e["label"]
                     for e in examples)
        candidates.append((errors, "parity", None))
        # Stable tie-break: sum-threshold candidates are considered first.
        _, self.family, self.threshold = min(candidates, key=lambda c: c[0])
        return self

    def predict_one(self, x, y):
        if self.family is None:
            raise RuntimeError("fit must be called before prediction")
        return self._predict(self.family, self.threshold, x, y)

    def predict(self, examples):
        return [self.predict_one(e["x"], e["y"]) for e in examples]
