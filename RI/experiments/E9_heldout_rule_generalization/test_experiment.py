"""M16.5 (E9) — Automated Unit, Anti-Leakage, Size-Transfer, Abstention, and Baseline Tests."""
import json
import random
import tempfile
import unittest
from pathlib import Path

from agent import (
    BINARY_COMBINATORS,
    UNARY_COMBINATORS,
    GrammarHypothesis,
    MajorityPriorBaseline,
    RandomHypothesisBaseline,
    RelationalGrammarGenerator,
    RelationalSkillMemory,
    RIRelationalAgent,
    SupervisedFeatureReferenceBaseline,
)
from environment import (
    REGIMES,
    HeldOutRuleWorld,
    eval_combinator,
    eval_out_of_grammar_cyclic_triad,
    eval_primitive_node,
    strip_labels,
    validate_scene_objects,
)
from evaluate import MAIN_METHODS, evaluate, write_m16_artifacts


class TestM16HeldOutRuleGeneralization(unittest.TestCase):
    def test_primitive_and_combinator_semantics(self):
        scene = [
            {"color": 0, "size": 5, "charge": 1, "pos": 1},
            {"color": 0, "size": 5, "charge": 1, "pos": 2},
            {"color": 2, "size": 2, "charge": 0, "pos": 4},
        ]
        self.assertEqual(eval_primitive_node("exists_color_size_ge", {"color": 0, "min_size": 5}, scene), 1)
        self.assertEqual(eval_primitive_node("exists_color_size_ge", {"color": 1, "min_size": 3}, scene), 0)
        self.assertEqual(eval_primitive_node("all_size_ge", {"min_size": 2}, scene), 1)
        self.assertEqual(eval_primitive_node("all_size_ge", {"min_size": 3}, scene), 0)
        self.assertEqual(eval_primitive_node("charge_ratio_ge", {"num": 2, "den": 3}, scene), 1)
        self.assertEqual(eval_primitive_node("parity_sum_charge", {"parity": 0}, scene), 1)
        self.assertEqual(eval_primitive_node("argmax_size_has_charge", {"charge": 1}, scene), 1)
        self.assertEqual(eval_primitive_node("argmax_size_has_color", {"color": 0}, scene), 1)
        self.assertEqual(eval_primitive_node("exists_pair_same_color_close_size", {"max_diff": 0}, scene), 1)
        self.assertEqual(eval_primitive_node("exists_directed_dominance", {"src_color": 0, "dst_color": 2}, scene), 0)

        # Combinators: ID, NOT, AND, OR, XOR, AND_NOT, IMPLIES
        self.assertEqual(eval_combinator("ID", 1), 1)
        self.assertEqual(eval_combinator("NOT", 1), 0)
        self.assertEqual(eval_combinator("AND", 1, 1), 1)
        self.assertEqual(eval_combinator("AND", 1, 0), 0)
        self.assertEqual(eval_combinator("OR", 0, 1), 1)
        self.assertEqual(eval_combinator("XOR", 1, 1), 0)
        self.assertEqual(eval_combinator("XOR", 1, 0), 1)
        self.assertEqual(eval_combinator("AND_NOT", 1, 0), 1)
        self.assertEqual(eval_combinator("AND_NOT", 1, 1), 0)
        self.assertEqual(eval_combinator("IMPLIES", 1, 0), 0)
        self.assertEqual(eval_combinator("IMPLIES", 0, 0), 1)

    def test_generator_regimes_and_split_disjointness(self):
        world = HeldOutRuleWorld(7)
        for idx, regime in enumerate(REGIMES):
            task = world.generate_task(
                regime=regime,
                train_size=10,
                val_size=8,
                query_pool_size=10,
                test_size=24,
                seed_offset=idx,
            )
            self.assertEqual(task.regime, regime)
            self.assertEqual(len(task.train_examples), 10)
            self.assertEqual(len(task.val_examples), 8)
            self.assertEqual(len(task.query_pool), 10)
            self.assertEqual(len(task.test_examples), 24)
            self.assertTrue(task.verify_no_leakage())

    def test_reproducibility_for_identical_seeds(self):
        res_a = evaluate([0, 1], train_size=8, val_size=8, query_pool_size=10, test_size=18)
        res_b = evaluate([0, 1], train_size=8, val_size=8, query_pool_size=10, test_size=18)
        for m in res_a["methods"]:
            a_m = {k: v for k, v in res_a["methods"][m].items() if k != "mean_runtime_ms"}
            b_m = {k: v for k, v in res_b["methods"][m].items() if k != "mean_runtime_ms"}
            self.assertEqual(a_m, b_m)
        self.assertEqual(
            res_a["paired_comparisons_ri_full_minus_baseline"],
            res_b["paired_comparisons_ri_full_minus_baseline"],
        )
        for row_a, row_b in zip(res_a["rows"], res_b["rows"]):
            self.assertEqual(row_a["ground_truth_rule"], row_b["ground_truth_rule"])
            for m in row_a["methods"]:
                ra = {k: v for k, v in row_a["methods"][m].items() if k != "runtime_ms"}
                rb = {k: v for k, v in row_b["methods"][m].items() if k != "runtime_ms"}
                self.assertEqual(ra, rb)

    def test_predict_rejects_labeled_test_examples_and_prevents_leakage(self):
        task = HeldOutRuleWorld(3).generate_task("B_structural_size_transfer", train_size=8, val_size=8, test_size=12)
        agent = RIRelationalAgent(seed=3).fit(task.train_examples, task.val_examples, task.query_pool)
        sup = SupervisedFeatureReferenceBaseline().fit(task.train_examples, task.val_examples)
        rnd = RandomHypothesisBaseline(seed=3).fit(task.train_examples)

        # Passing raw test_examples containing "label" must raise ValueError.
        for model in (agent, sup, rnd):
            with self.assertRaises(ValueError):
                model.predict(task.test_examples)

        # Stripped test examples have only "objects" and succeed.
        unlabeled = strip_labels(task.test_examples)
        self.assertTrue(all("label" not in item for item in unlabeled))
        preds = agent.predict(unlabeled)
        self.assertEqual(len(preds), len(task.test_examples))

    def test_candidate_budget_and_depth_limits_and_deduplication(self):
        gen_d1 = RelationalGrammarGenerator(max_depth=1, max_candidates=30, deduplicate_semantics=True)
        cands_d1, _ = gen_d1.generate()
        self.assertLessEqual(len(cands_d1), 30)
        self.assertTrue(all(c.depth == 1 for c in cands_d1))

        gen_dedup = RelationalGrammarGenerator(max_depth=2, max_candidates=500, deduplicate_semantics=True)
        cands_unique, n_removed = gen_dedup.generate()
        self.assertGreater(n_removed, 50)
        self.assertLessEqual(len(cands_unique), 500)

    def test_unidentifiable_c2_rule_triggers_abstention_and_uncertainty(self):
        task_c2 = HeldOutRuleWorld(11).generate_task(
            "C2_heldout_unidentifiable",
            train_size=12,
            val_size=12,
            query_pool_size=12,
            test_size=24,
        )
        self.assertFalse(task_c2.identifiable_in_grammar)
        agent = RIRelationalAgent(
            max_depth=2,
            max_candidates=420,
            use_validation_guard=True,
            min_identifiable_accuracy=0.81,
            seed=11,
        ).fit(task_c2.train_examples, task_c2.val_examples, task_c2.query_pool)
        self.assertTrue(agent.abstained)
        self.assertEqual(agent.status, "unidentified_high_uncertainty")
        self.assertGreater(agent.uncertainty_score, 0.15)

    def test_structural_size_generalization_and_permutation_invariance(self):
        task_b = HeldOutRuleWorld(4).generate_task(
            "B_structural_size_transfer",
            train_size=10,
            val_size=10,
            query_pool_size=12,
            test_size=36,
        )
        agent = RIRelationalAgent(seed=4).fit(task_b.train_examples, task_b.val_examples, task_b.query_pool)
        # Verify predictions on large scenes (9..11 objects) are invariant to object order permutation.
        large_scenes = strip_labels(task_b.test_by_size_bucket["large_9_11"])
        preds_orig = agent.predict(large_scenes)
        rng = random.Random(99)
        permuted_scenes = []
        for item in large_scenes:
            shuffled = list(item["objects"])
            rng.shuffle(shuffled)
            permuted_scenes.append({"objects": shuffled})
        preds_perm = agent.predict(permuted_scenes)
        self.assertEqual(preds_orig, preds_perm)

    def test_all_six_baselines_run_and_produce_valid_predictions(self):
        data = evaluate([0, 1], train_size=8, val_size=8, query_pool_size=10, test_size=18)
        for m in MAIN_METHODS:
            self.assertIn(m, data["methods"])
            acc = data["methods"][m]["identifiable_held_out_accuracy"]["mean"]
            self.assertGreaterEqual(acc, 0.0)
            self.assertLessEqual(acc, 1.0)
        # RI full should outperform random and majority on identifiable tasks.
        self.assertGreater(
            data["methods"]["ri_full"]["identifiable_held_out_accuracy"]["mean"],
            data["methods"]["majority_prior"]["identifiable_held_out_accuracy"]["mean"],
        )
        self.assertGreater(
            data["methods"]["ri_full"]["identifiable_held_out_accuracy"]["mean"],
            data["methods"]["random_hypothesis"]["identifiable_held_out_accuracy"]["mean"],
        )

    def test_skill_memory_isolation_and_verification_gate(self):
        mem = RelationalSkillMemory()
        hyp = GrammarHypothesis(
            hypothesis_id="h_test",
            operator="ID",
            left_primitive=("all_size_ge", {"min_size": 3}),
            depth=1,
            complexity=1,
        )
        good_tests = [
            {"objects": [{"color": 0, "size": 4, "charge": 0, "pos": 0}, {"color": 1, "size": 3, "charge": 1, "pos": 1}], "label": 1}
        ]
        bad_tests = [
            {"objects": [{"color": 0, "size": 4, "charge": 0, "pos": 0}, {"color": 1, "size": 3, "charge": 1, "pos": 1}], "label": 0}
        ]
        # Rejects skill if unit tests fail or val_accuracy is below gate.
        self.assertIsNone(mem.register("s_bad_tests", hyp, bad_tests, val_accuracy=0.95))
        self.assertIsNone(mem.register("s_low_val", hyp, good_tests, val_accuracy=0.50))
        rec = mem.register("s_ok", hyp, good_tests, val_accuracy=0.95)
        self.assertIsNotNone(rec)
        self.assertEqual(len(mem.skills), 1)

    def test_invalid_inputs_and_empty_splits_rejected(self):
        with self.assertRaises(ValueError):
            HeldOutRuleWorld("not_an_int")
        with self.assertRaises(ValueError):
            validate_scene_objects([{"color": 0, "size": 3, "charge": 0, "pos": 1}])  # fewer than 2 objects
        with self.assertRaises(ValueError):
            RIRelationalAgent().fit([], [])
        with self.assertRaises(RuntimeError):
            RIRelationalAgent().predict([])

    def test_evaluate_and_artifact_generation_consistency(self):
        with tempfile.TemporaryDirectory() as tmp:
            out_p = Path(tmp) / "results.json"
            sum_p = Path(tmp) / "m16_summary.json"
            abl_p = Path(tmp) / "m16_ablation_results.json"
            data = evaluate([0, 1], train_size=8, val_size=8, query_pool_size=10, test_size=18)
            write_m16_artifacts(data, out_p, sum_p, abl_p)
            for p in (out_p, sum_p, abl_p):
                self.assertTrue(p.is_file())
                loaded = json.loads(p.read_text(encoding="utf-8"))
                self.assertEqual(loaded["experiment_version"], "M16.E9.v1")
                self.assertEqual(loaded["n_seeds"], 2)


if __name__ == "__main__":
    unittest.main()
