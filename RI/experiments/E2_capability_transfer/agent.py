"""Transparent toy agent for M3 capability-transfer experiments.

This is a research instrument, not a general intelligence system.
"""
from dataclasses import dataclass, field
from typing import Dict, List, Tuple
import random


@dataclass
class Capability:
    name: str
    procedure: str
    evidence: List[Tuple[str, int]] = field(default_factory=list)
    verified: bool = False


@dataclass
class Agent:
    """Learns which feature controls a binary outcome using interventions."""
    rng: random.Random
    scores: Dict[str, float] = field(default_factory=lambda: {"u": 0.0, "v": 0.0})
    observations: int = 0
    capability: Capability = field(default_factory=lambda: Capability(
        name="controlled_comparison",
        procedure="vary one candidate feature while holding the other fixed",
    ))

    def choose_intervention(self, labels=("u", "v")) -> str:
        """Choose the less-tested feature; randomized tie-break avoids fixed bias."""
        candidates = list(labels)
        values = {label: self.scores.get(label, 0.0) for label in candidates}
        low = min(values.values())
        tied = [label for label in candidates if values[label] == low]
        return self.rng.choice(tied)

    def observe(self, feature: str, outcome: int) -> None:
        if feature not in self.scores:
            self.scores[feature] = 0.0
        # A positive outcome is evidence that this feature is the controlling one
        # only in this deliberately simplified diagnostic task.
        self.scores[feature] += 1.0 if outcome == 1 else -0.25
        self.observations += 1
        self.capability.evidence.append((feature, outcome))

    def predict_controlled_feature(self, labels=("u", "v")) -> str:
        values = {label: self.scores.get(label, 0.0) for label in labels}
        best = max(values.values())
        tied = [label for label in labels if values[label] == best]
        return self.rng.choice(tied)

    def export_capability(self) -> Capability:
        self.capability.verified = self.observations >= 4
        return Capability(
            name=self.capability.name,
            procedure=self.capability.procedure,
            evidence=list(self.capability.evidence),
            verified=self.capability.verified,
        )
