import unittest
from agent import ThresholdRuleLearner, NearestNeighbour, MajorityBaseline
from environment import ThresholdWorld
from evaluate import evaluate


class TestE7(unittest.TestCase):
    def test_generator_reproducible(self):
        a = ThresholdWorld(12)
        b = ThresholdWorld(12)
        self.assertEqual(a.threshold, b.threshold)
        self.assertEqual(a.sample(8), b.sample(8))

    def test_rule_learner_recovers_clean_rule(self):
        examples = [{"x": x, "y": y, "label": int(x + y >= 7)}
                    for x in range(8) for y in range(8)]
        model = ThresholdRuleLearner().fit(examples)
        self.assertEqual(model.threshold, 7)
        self.assertEqual(model.predict({"x": 2, "y": 5}), 1)
        self.assertEqual(model.predict({"x": 1, "y": 1}), 0)

    def test_models_require_training(self):
        for cls in (ThresholdRuleLearner, NearestNeighbour, MajorityBaseline):
            with self.assertRaises(ValueError):
                cls().fit([])

    def test_heldout_results_reproducible(self):
        self.assertEqual(evaluate([1, 2, 3], 12, 24), evaluate([1, 2, 3], 12, 24))

    def test_invalid_seed_set_rejected(self):
        with self.assertRaises(ValueError):
            evaluate([], 12, 24)


if __name__ == "__main__":
    unittest.main()
