# Simple unit checks for environment integrity
# Run with: python -m unittest discover -s RI/tests or python RI/tests/test_environment.py

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from experiments.E1_relationship_learning.environment import SimulatedWorld


def test_true_rule():
    w = SimulatedWorld(seed=0, noise_prob=0.0)
    assert w.true_rule(1, 0) is True
    assert w.true_rule(1, 1) is False
    assert w.true_rule(0, 0) is False


def test_reproducible():
    w1 = SimulatedWorld(seed=42)
    w2 = SimulatedWorld(seed=42)
    o1 = w1.sample_case()
    o2 = w2.sample_case()
    assert o1["color"] == o2["color"]
    assert o1["size"] == o2["size"]


class TestE1Environment(unittest.TestCase):
    def test_true_rule_outcomes(self):
        test_true_rule()

    def test_reproducible_sampling(self):
        test_reproducible()


if __name__ == "__main__":
    unittest.main()
