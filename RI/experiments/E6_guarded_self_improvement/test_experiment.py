import unittest
from agent import PolicyConfig, propose
from evaluate import run


class TestE6(unittest.TestCase):
    def test_bounds(self):
        with self.assertRaises(ValueError):
            PolicyConfig(2, 0.5).validate()

    def test_allowlisted_proposal(self):
        c = propose(PolicyConfig(), "retention")
        self.assertEqual(c.memory_weight, 0.6)
        self.assertEqual(c.exploration, 0.5)

    def test_deterministic_eval(self):
        self.assertEqual(run([1, 2]), run([1, 2]))

    def test_paired_rows_and_gate_are_reported(self):
        result = run([1, 2, 3])
        self.assertEqual(result["n_seeds"], 3)
        self.assertEqual(len(result["rows"]), 3)
        self.assertIn("mean_paired_gain", result["promotion_gate"])
        self.assertIn("minimum_gain", result["promotion_gate"])

    def test_empty_seed_set_rejected(self):
        with self.assertRaises(ValueError):
            run([])

    def test_high_threshold_prevents_promotion(self):
        result = run([1, 2, 3], minimum_gain=1.0)
        self.assertFalse(result["promotion_gate"]["promoted"])


if __name__ == "__main__":
    unittest.main()
