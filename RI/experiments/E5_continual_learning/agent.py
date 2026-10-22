"""Explicit, inspectable memory for sequential task families."""
from dataclasses import dataclass, field

@dataclass
class ContinualAgent:
    alpha: dict = field(default_factory=dict)
    beta: dict = field(default_factory=dict)
    def observe(self, family, outcome):
        if outcome not in (0, 1): raise ValueError("outcome must be 0 or 1")
        self.alpha[family] = self.alpha.get(family, 1) + outcome
        self.beta[family] = self.beta.get(family, 1) + (1-outcome)
    def predict(self, family):
        a=self.alpha.get(family,1); b=self.beta.get(family,1)
        return a/(a+b)
    def reset_current(self, family):
        self.alpha.pop(family,None); self.beta.pop(family,None)
