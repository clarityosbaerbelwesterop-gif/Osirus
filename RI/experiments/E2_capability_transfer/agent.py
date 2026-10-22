"""M3 E2: transparent agent that can reuse an acquired experimental procedure."""
from dataclasses import dataclass, field
import random
from typing import List, Tuple


@dataclass
class Capability:
    name: str
    procedure: str
    version: int = 1
    evidence: List[Tuple[str, int]] = field(default_factory=list)
    verified: bool = False

    def choose(self, labels, counts, rng):
        """Operational procedure: sample every candidate at least once, then balance."""
        unseen = [label for label in labels if counts.get(label, 0) == 0]
        if unseen:
            return rng.choice(unseen)
        minimum = min(counts.get(label, 0) for label in labels)
        tied = [label for label in labels if counts.get(label, 0) == minimum]
        return rng.choice(tied)


@dataclass
class Agent:
    rng: random.Random
    use_capability: bool = True
    labels: tuple = ("u", "v")
    counts: dict = field(default_factory=dict)
    positive: dict = field(default_factory=dict)
    negative: dict = field(default_factory=dict)
    capability: Capability = field(default_factory=lambda: Capability(
        name="balanced_controlled_intervention",
        procedure="test each candidate at least once; then allocate further tests to least-tested candidates",
    ))

    def choose_intervention(self):
        if self.use_capability:
            return self.capability.choose(self.labels, self.counts, self.rng)
        # Ablation: a naive default policy repeatedly samples without balancing.
        return self.rng.choice(self.labels)

    def observe(self, feature, outcome):
        self.counts[feature] = self.counts.get(feature, 0) + 1
        if outcome == 1:
            self.positive[feature] = self.positive.get(feature, 0) + 1
        else:
            self.negative[feature] = self.negative.get(feature, 0) + 1
        self.capability.evidence.append((feature, outcome))

    def predict_controlled_feature(self):
        # Estimate success probability with Laplace smoothing.
        estimates = {
            label: (self.positive.get(label, 0) + 1) /
                   (self.counts.get(label, 0) + 2)
            for label in self.labels
        }
        best = max(estimates.values())
        tied = [label for label in self.labels if estimates[label] == best]
        return self.rng.choice(tied)

    def export_capability(self):
        return Capability(
            name=self.capability.name,
            procedure=self.capability.procedure,
            version=self.capability.version,
            evidence=list(self.capability.evidence),
            verified=len(self.capability.evidence) >= len(self.labels),
        )
