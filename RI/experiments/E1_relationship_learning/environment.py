"""
E1: Relationship Learning and Transfer - Simulated Environment

Small discrete world for testing relationship formation.
Objects have properties: color (0/1), size (0/1).
Action "interact" succeeds (produces "effect") only under hidden rule:
success if color == 1 and size == 0, with 10% noise.
Observations include irrelevant noise attributes.
"""

import random
from typing import Dict, List, Tuple, Any

class SimulatedWorld:
    def __init__(self, seed: int = 42, noise_prob: float = 0.1):
        self.rng = random.Random(seed)
        self.noise_prob = noise_prob
        self.properties = ["color", "size"]
        # Hidden rule: success iff color==1 and size==0
        self.true_rule = lambda color, size: color == 1 and size == 0

    def generate_observation(self, color: int, size: int) -> Dict[str, Any]:
        # Add irrelevant noise attribute
        noise_attr = self.rng.randint(0, 1)
        # Observation of action result
        true_success = self.true_rule(color, size)
        observed_success = true_success if self.rng.random() > self.noise_prob else not true_success
        return {
            "color": color,
            "size": size,
            "noise_attr": noise_attr,
            "success": observed_success,
            "true_success": true_success  # only for eval, not given to agent
        }

    def sample_case(self) -> Dict[str, Any]:
        color = self.rng.randint(0, 1)
        size = self.rng.randint(0, 1)
        return self.generate_observation(color, size)

    def get_all_combinations(self) -> List[Tuple[int, int]]:
        return [(c, s) for c in [0, 1] for s in [0, 1]]

# Development cases: some combinations seen, test: held-out
def split_cases(seed: int = 42) -> Tuple[List, List]:
    rng = random.Random(seed)
    all_combos = [(0,0), (0,1), (1,0), (1,1)]
    # Train on 3, test on 1 or mix for transfer
    train = all_combos[:3]
    test = all_combos[3:]
    return train, test
