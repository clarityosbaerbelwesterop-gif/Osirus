"""Toy intervention environment with evaluator-only ground truth."""
from dataclasses import dataclass
import random


@dataclass
class InterventionWorld:
    controlling_feature: str
    noise: float
    rng: random.Random
    labels: tuple = ("u", "v")

    def __post_init__(self):
        if self.controlling_feature not in self.labels:
            raise ValueError("controlling_feature must be one of the public labels")
        if not 0.0 <= self.noise < 0.5:
            raise ValueError("noise must be in [0, 0.5)")

    def query(self, intervention: str) -> int:
        """Return feedback for an intervention; no rule metadata is exposed."""
        if intervention not in self.labels:
            raise ValueError("invalid intervention")
        outcome = 1 if intervention == self.controlling_feature else 0
        if self.rng.random() < self.noise:
            outcome = 1 - outcome
        return outcome
