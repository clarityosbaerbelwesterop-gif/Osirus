"""Regression tests for E8 rule-family selection and baselines."""
from statistics import mean
import unittest
from environment import RuleWorld
from agent import (
    RuleDiscoveryAgent,
    MajorityBaseline,
    FixedThresholdBaseline,
    RandomHypothesisBaseline,
)
from evaluate import evaluate


class RuleDiscoveryTests(unittest.TestCase):
    def test_world_is_reproducible_and_idempotent(self):
        a = RuleWorld(17)
        b = RuleWorld(17)
        self.assertEqual(a.family, b.family)
        self.assertEqual(a.threshold, b.threshold)
        self.assertEqual(a.all_examples(), b.all_examples())
        # Repeated calls on the same instance must return identical splits.
        self.assertEqual(a.split(16, 24), a.split(16, 24))

    def test_split_is_disjoint(self):
        train, test = RuleWorld(3).split(16, 24)
        train_points = {(e["x"], e["y"]) for e in train}
        test_points = {(e["x"], e["y"]) for e in test}
        self.assertEqual(len(train), 16)
        self.assertEqual(len(test), 24)
        self.assertTrue(train_points.isdisjoint(test_points))

    def test_full_grid_identifies_threshold_rule(self):
        for threshold in range(0, 15):
            world = RuleWorld(1, family="sum_threshold", threshold=threshold)
            agent = RuleDiscoveryAgent().fit(world.all_examples())
            self.assertEqual(agent.family, "sum_threshold")
            self.assertEqual(agent.threshold, threshold)
            self.assertEqual(agent.train_error, 0)
            self.assertFalse(agent.family_tie)

    def test_full_grid_identifies_parity_rule(self):
        world = RuleWorld(2, family="parity")
        agent = RuleDiscoveryAgent().fit(world.all_examples())
        self.assertEqual(agent.family, "parity")
        self.assertIsNone(agent.threshold)
        self.assertEqual(agent.train_error, 0)
        self.assertFalse(agent.family_tie)

    def test_tie_breaking_and_insufficient_training_data_diagnostics(self):
        # Single positive example at (4, 4): sum=8 is even and >= thresholds 0..8.
        # Both sum_threshold (0..8) and parity achieve 0 error; tie-breaking must be
        # deterministic and expose tie diagnostics.
        sparse = [{"x": 4, "y": 4, "label": 1}]
        agent = RuleDiscoveryAgent().fit(sparse)
        self.assertEqual(agent.family, "sum_threshold")
        self.assertEqual(agent.threshold, 0)
        self.assertEqual(agent.train_error, 0)
        self.assertTrue(agent.family_tie)
        self.assertTrue(agent.threshold_tie)
        self.assertGreater(len(agent.tied_candidates), 1)

    def test_fit_rejects_empty_or_invalid_examples(self):
        for cls in (
            RuleDiscoveryAgent,
            MajorityBaseline,
            FixedThresholdBaseline,
            RandomHypothesisBaseline,
        ):
            with self.assertRaises(ValueError):
                cls().fit([])
            with self.assertRaises(ValueError):
                cls().fit([{"x": 1, "y": 2, "label": 2}])
            with self.assertRaises(ValueError):
                cls().fit([{"x": 8, "y": 0, "label": 1}])

    def test_predict_before_fit_rejected(self):
        for cls in (
            RuleDiscoveryAgent,
            MajorityBaseline,
            FixedThresholdBaseline,
            RandomHypothesisBaseline,
        ):
            with self.assertRaises(RuntimeError):
                cls().predict_one(1, 2)
            with self.assertRaises(RuntimeError):
                cls().predict([{"x": 1, "y": 2}])

    def test_invalid_world_and_split_parameters_rejected(self):
        with self.assertRaises(ValueError):
            RuleWorld(0, family="")
        with self.assertRaises(ValueError):
            RuleWorld(0, family="invalid")
        with self.assertRaises(ValueError):
            RuleWorld(0, threshold=15)
        with self.assertRaises(ValueError):
            RuleWorld(0, threshold=-1)
        with self.assertRaises(ValueError):
            RuleWorld(True)
        world = RuleWorld(0)
        for bad_train, bad_test in ((0, 10), (10, 0), (40, 25), (-1, 5), (True, 10)):
            with self.assertRaises(ValueError):
                world.split(bad_train, bad_test)
            with self.assertRaises(ValueError):
                evaluate([0], bad_train, bad_test)

    def test_baselines_are_deterministic_and_bounded(self):
        train, test = RuleWorld(5).split(16, 24)
        maj = MajorityBaseline().fit(train)
        fix = FixedThresholdBaseline(threshold=7).fit(train)
        rnd_a = RandomHypothesisBaseline(seed=42).fit(train)
        rnd_b = RandomHypothesisBaseline(seed=42).fit(train)
        self.assertEqual(rnd_a.predict(test), rnd_b.predict(test))
        for preds in (maj.predict(test), fix.predict(test), rnd_a.predict(test)):
            self.assertEqual(len(preds), len(test))
            self.assertTrue(all(p in (0, 1) for p in preds))

    def test_evaluation_is_deterministic_and_aggregates_match_rows(self):
        res_a = evaluate(list(range(30)), 16, 24)
        res_b = evaluate(list(range(30)), 16, 24)
        self.assertEqual(res_a, res_b)
        rows = res_a["rows"]
        self.assertEqual(len(rows), 30)
        self.assertAlmostEqual(
            res_a["rule_family_selection_rate"],
            mean(float(r["family_selected_correctly"]) for r in rows),
        )
        self.assertAlmostEqual(
            res_a["exact_rule_recovery_rate"],
            mean(float(r["exact_rule_recovered"]) for r in rows),
        )
        self.assertAlmostEqual(
            res_a["mean_held_out_accuracy"],
            mean(r["held_out_accuracy"] for r in rows),
        )
        for baseline_name in ("majority", "fixed_threshold", "random_hypothesis"):
            self.assertAlmostEqual(
                res_a["baselines"][baseline_name]["mean_held_out_accuracy"],
                mean(r["baseline_held_out_accuracy"][baseline_name] for r in rows),
            )
        # Candidate should outperform baselines on 30 seeds with 16 training examples.
        self.assertGreater(
            res_a["mean_held_out_accuracy"],
            res_a["baselines"]["majority"]["mean_held_out_accuracy"],
        )
        self.assertGreater(
            res_a["mean_held_out_accuracy"],
            res_a["baselines"]["random_hypothesis"]["mean_held_out_accuracy"],
        )

    def test_identical_seeds_produce_identical_rows(self):
        res = evaluate([9, 9, 9], 8, 16)
        self.assertEqual(res["rows"][0], res["rows"][1])
        self.assertEqual(res["rows"][1], res["rows"][2])

    def test_evaluation_rejects_empty_seed_list(self):
        with self.assertRaises(ValueError):
            evaluate([])


if __name__ == "__main__":
    unittest.main()
