"""Transparent composition of generic probe-and-verify operations."""
from dataclasses import dataclass, field

@dataclass
class Operation:
    name: str
    procedure: str
    uses: int = 0

@dataclass
class ComposedAgent:
    operations: dict = field(default_factory=lambda: {
        "probe": Operation("probe", "query both candidate actions"),
        "verify": Operation("verify", "compare observed outcomes and select the strongest evidence"),
    })
    trace: list = field(default_factory=list)

    def solve_stage(self, observations):
        if not observations:
            raise ValueError("observations must not be empty")
        best = max(observations.values())
        choice = sorted(k for k, v in observations.items() if v == best)[0]
        self.operations["probe"].uses += 1
        self.operations["verify"].uses += 1
        self.trace.append({"operation": ["probe", "verify"], "observations": dict(observations), "choice": choice})
        return choice
