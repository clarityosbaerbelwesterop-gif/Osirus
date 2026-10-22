"""
Baselines for E1: Relationship Learning
"""

from typing import Dict, List, Any
import random

class RandomBaseline:
    def __init__(self, seed: int = 42):
        self.rng = random.Random(seed)

    def predict(self, obs: Dict) -> float:
        return 0.5

    def update(self, obs: Dict, success: bool):
        pass

class MemorizeBaseline:
    """Memorizes exact seen (color, size) -> success rate"""
    def __init__(self):
        self.memory: Dict[Tuple[int, int], List[bool]] = {}

    def predict(self, obs: Dict) -> float:
        key = (obs["color"], obs["size"])
        if key in self.memory and self.memory[key]:
            return sum(self.memory[key]) / len(self.memory[key])
        return 0.5

    def update(self, obs: Dict, success: bool):
        key = (obs["color"], obs["size"])
        if key not in self.memory:
            self.memory[key] = []
        self.memory[key].append(success)

class MeanBaseline:
    def __init__(self):
        self.successes = 0
        self.total = 0

    def predict(self, obs: Dict) -> float:
        if self.total == 0:
            return 0.5
        return self.successes / self.total

    def update(self, obs: Dict, success: bool):
        self.total += 1
        if success:
            self.successes += 1
