"""Constrained proposal generator: configuration only, no code generation/execution."""
from dataclasses import dataclass
@dataclass(frozen=True)
class PolicyConfig:
    exploration: float = 0.5
    memory_weight: float = 0.5
    def validate(self):
        if not 0.0 <= self.exploration <= 1.0: raise ValueError("exploration outside allow-list bounds")
        if not 0.0 <= self.memory_weight <= 1.0: raise ValueError("memory_weight outside allow-list bounds")
        return self
def propose(config, weakest_metric):
    config.validate()
    if weakest_metric=="coverage":
        return PolicyConfig(min(1.0,config.exploration+0.1),config.memory_weight).validate()
    if weakest_metric=="retention":
        return PolicyConfig(config.exploration,min(1.0,config.memory_weight+0.1)).validate()
    return config
