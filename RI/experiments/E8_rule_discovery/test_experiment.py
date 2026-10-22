"""Regression tests for E8 rule-family selection."""
import unittest
from environment import RuleWorld
from agent import RuleDiscoveryAgent
from evaluate import evaluate


class RuleDiscoveryTests(unittest.TestCase):
    def test_world_is_reproducible(self):
        a = RuleWorld(17)
        b = RuleWorld(17)
        self.assertEqual(a.family, b.family)
        self.assertEqual(a.threshold, b.threshold)
        self.assertEqual(a.all_examples(), b.all_examples())

    def test_split_is_disjoint(self):
        train, test = RuleWorld(3).split(16, 24)
        train_points = {(e["x"], e["y"]) for e in train}
        test_points = {(e["x"], e["y"]) for e in test}
        self.assertEqual(len(train), 16)
        self.assertEqual(len(test), 24)
        self.assertTrue(train_points.isdisjoint(test_points))

    def test_full_grid_identifies_threshold_rule(self):
        world = RuleWorld(1, family="sum_threshold", threshold=7)
        agent = RuleDiscoveryAgent().fit(world.all_examples())
        self.assertEqual(agent.family, "sum_threshold")
        self.assertEqual(agent.threshold, 7)

    def test_full_grid_identifies_parity_rule(self):
        world = RuleWorld(2, family="parity")
        agent = RuleDiscoveryAgent().fit(world.all_examples())
        self.assertEqual(agent.family, "parity")

    def test_fit_rejects_empty_examples(self):
        with self.assertRaises(ValueError):
            RuleDiscoveryAgent().fit([])

    def test_predict_before_fit_rejected(self):
        with self.assertRaises(RuntimeError):
            RuleDiscoveryAgent().predict_one(1, 2)

    def test_evaluation_is_deterministic(self):
        self.assertEqual(evaluate([0, 1, 2]), evaluate([0, 1, 2]))

    def test_evaluation_rejects_empty_seed_list(self):
        with self.assertRaises(ValueError):
            evaluate([])


if __name__ == "__main__":
    unittest.main()
