"""M17 (E10) — Anti-Self-Deception, Safety, Quarantine, Promotion, and Rollback Tests."""
import copy
import json
import tempfile
import unittest
from pathlib import Path

from agent import (
    CandidateRuleAST,
    GuardedSkillLibrary,
    M17GuardedSynthesizerAgent,
    MajorityReferenceBaseline,
    SubPrimitiveSynthesizer,
    check_large_size_support,
    check_permutation_invariance,
)
from environment import (
    SubPrimitiveSynthesisWorld,
    scene_canonical_key,
    strip_labels,
)
from evaluate import METHODS, clamped_ci95, evaluate, write_m17_artifacts


class TestM17GuardedSubPrimitiveSynthesis(unittest.TestCase):
    def test_01_rule_fitting_only_training_examples_is_rejected(self):
        """1. Regel passt nur auf die Trainingsbeispiele -> muss abgelehnt/quarantänisiert werden."""
        # Seed 2 generates Trap 2 (corrupted_training_overfit) where forall_color_charged(0, 1)
        # fits 100% of train_examples but fails on independent validation examples.
        bundle = SubPrimitiveSynthesisWorld(2).generate_bundle()
        trap_task = bundle.family_c_task
        self.assertEqual(trap_task["trap_type"], "corrupted_training_overfit")

        agent = M17GuardedSynthesizerAgent(seed=2)
        agent.lock_regression_suite(bundle.locked_m16_regression_tasks)
        skills_before = len(agent.library.active_skills)
        outcome = agent.solve_task(trap_task, regression_tasks=bundle.locked_m16_regression_tasks)

        self.assertFalse(outcome["promoted"])
        self.assertTrue(outcome["quarantined"])
        self.assertEqual(len(agent.library.active_skills), skills_before)
        rec = outcome["lifecycle_record"]
        self.assertIsNotNone(rec)
        self.assertGreaterEqual(rec.train_accuracy, 0.90)
        self.assertLess(rec.val_accuracy, 0.85)
        self.assertTrue(any("val_accuracy" in r for r in rec.quarantine_or_rejection_reasons))

    def test_02_ambiguous_alternative_rules_are_quarantined(self):
        """2. Alternative Regeln erklären dieselben Beobachtungen -> muss in Quarantäne bleiben."""
        # Seed 1 generates Trap 1 (confounded_ambiguous_twin) where forall_color_charged(1, 1)
        # and forall_color_charged(2, 1) both achieve 100% on train, val, and independent_size_val.
        bundle = SubPrimitiveSynthesisWorld(1).generate_bundle()
        trap_task = bundle.family_c_task
        self.assertEqual(trap_task["trap_type"], "confounded_ambiguous_twin")

        agent = M17GuardedSynthesizerAgent(seed=1)
        agent.lock_regression_suite(bundle.locked_m16_regression_tasks)
        outcome = agent.solve_task(trap_task, regression_tasks=bundle.locked_m16_regression_tasks)

        self.assertFalse(outcome["promoted"])
        self.assertTrue(outcome["quarantined"])
        rec = outcome["lifecycle_record"]
        self.assertGreater(rec.n_surviving_alternatives, 1)
        self.assertTrue(
            any("ambiguous_alternative_rules" in r for r in rec.quarantine_or_rejection_reasons)
        )

    def test_03_noisy_examples_false_primitive_is_rejected(self):
        """3. Verrauschte Beispiele erzeugen falsche primitive Regeln -> wird zurückgewiesen."""
        bundle = SubPrimitiveSynthesisWorld(0).generate_bundle()
        noisy_task = copy.deepcopy(bundle.family_a_task)
        # Corrupt 50% of training and validation labels so any fitted primitive is spurious noise.
        for idx, item in enumerate(noisy_task["train_examples"]):
            item["label"] = idx % 2
        for idx, item in enumerate(noisy_task["val_examples"]):
            item["label"] = (idx + 1) % 2

        agent = M17GuardedSynthesizerAgent(seed=0)
        agent.lock_regression_suite(bundle.locked_m16_regression_tasks)
        outcome = agent.solve_task(noisy_task, regression_tasks=bundle.locked_m16_regression_tasks)
        self.assertFalse(outcome["promoted"])
        self.assertTrue(outcome["quarantined"])
        self.assertEqual(len(agent.library.promoted_records), 0)

    def test_04_regression_on_previous_tasks_blocks_promotion(self):
        """4. Neue Regeln verschlechtern zuvor gelöste Aufgaben -> Promotion wird blockiert."""
        bundle = SubPrimitiveSynthesisWorld(0).generate_bundle()
        agent = M17GuardedSynthesizerAgent(seed=0)
        agent.lock_regression_suite(bundle.locked_m16_regression_tasks)

        # Simulate a regression by corrupting the locked regression task's test labels after locking baseline
        # AND injecting a candidate that wins on the regression task's train split.
        reg_task = copy.deepcopy(bundle.locked_m16_regression_tasks[0])
        cand_a = bundle.family_a_task["ground_truth_rule"].subprimitive
        # Force reg_task train_examples to match cand_a so cand_a is selected on reg_task,
        # while reg_task test_examples have opposite labels so cand_a causes a regression drop > 0.
        for item in reg_task["train_examples"]:
            item["label"] = cand_a.evaluate(item["objects"])
        for item in reg_task["test_examples"]:
            item["label"] = 1 - cand_a.evaluate(item["objects"])

        outcome = agent.solve_task(bundle.family_a_task, regression_tasks=[reg_task])
        self.assertFalse(outcome["promoted"])
        self.assertTrue(outcome["quarantined"])
        self.assertGreater(outcome["lifecycle_record"].regression_drop, 0.0)
        self.assertTrue(
            any("regression_drop_on_locked_tasks" in r for r in outcome["lifecycle_record"].quarantine_or_rejection_reasons)
        )

    def test_05_skill_memory_is_unmodified_before_promotion(self):
        """5. Skill-Memory wird vor der Promotion nicht verändert (Staging-Isolation)."""
        lib = GuardedSkillLibrary()
        base_ast = CandidateRuleAST(
            candidate_id="base_1",
            origin="m16_base",
            combinator="ID",
            left_kind="m16_base",
            left_name="all_size_ge",
            left_params={"min_size": 2},
        )
        unit_test = [{"objects": [{"color": 0, "size": 3, "charge": 1, "pos": 0}, {"color": 1, "size": 4, "charge": 0, "pos": 1}], "label": 1}]
        lib.register_base_skill("s_base", base_ast, unit_test)
        self.assertEqual(len(lib.active_skills), 1)
        self.assertEqual(lib.version, 1)

        cand_ast = CandidateRuleAST(
            candidate_id="cand_new",
            origin="synthesized_subprimitive",
            combinator="ID",
            left_kind="subprimitive",
            left_name="pair_proximal_dipole",
            left_params={"color": 0, "max_gap": 2},
        )
        # Stage 1: Stage candidate -> active_skills and version must remain untouched.
        rec = lib.stage_candidate(cand_ast, train_acc=1.0)
        self.assertFalse(rec.active)
        self.assertEqual(rec.stage, "candidate")
        self.assertEqual(len(lib.active_skills), 1)
        self.assertEqual(lib.version, 1)

        # Stage 4: Quarantine candidate -> active_skills and version must still remain untouched.
        lib.quarantine_candidate(rec, ["failed_validation"])
        self.assertFalse(rec.active)
        self.assertEqual(rec.stage, "quarantined")
        self.assertEqual(len(lib.active_skills), 1)
        self.assertEqual(lib.version, 1)

    def test_06_test_labels_cannot_influence_selection_or_promotion(self):
        """6. Testlabels beeinflussen weder Kandidatenauswahl noch Promotion."""
        bundle_orig = SubPrimitiveSynthesisWorld(3).generate_bundle()
        bundle_flipped = copy.deepcopy(bundle_orig)

        # Invert 100% of test labels in bundle_flipped across all task families.
        for t in (bundle_flipped.family_a_task, bundle_flipped.family_b_task, bundle_flipped.family_c_task):
            for item in t["test_examples"]:
                item["label"] = 1 - int(item["label"])
            for item in t["test_large_size_examples"]:
                item["label"] = 1 - int(item["label"])

        agent_orig = M17GuardedSynthesizerAgent(seed=3)
        agent_flip = M17GuardedSynthesizerAgent(seed=3)
        agent_orig.lock_regression_suite(bundle_orig.locked_m16_regression_tasks)
        agent_flip.lock_regression_suite(bundle_flipped.locked_m16_regression_tasks)

        out_orig = agent_orig.solve_task(bundle_orig.family_a_task, bundle_orig.locked_m16_regression_tasks)
        out_flip = agent_flip.solve_task(bundle_flipped.family_a_task, bundle_flipped.locked_m16_regression_tasks)

        self.assertEqual(out_orig["selected_candidate"], out_flip["selected_candidate"])
        self.assertEqual(out_orig["promoted"], out_flip["promoted"])
        self.assertEqual(out_orig["status"], out_flip["status"])

        # Moreover, predict_all() explicitly rejects test examples that still carry a 'label' key.
        with self.assertRaises(ValueError):
            out_orig["selected_candidate"].predict_all(bundle_orig.family_a_task["test_examples"])

    def test_07_rollback_restores_exact_prior_version_and_skills(self):
        """7. Rollback stellt exakt die vorherige aktive Version und Skill-Liste wieder her."""
        bundle = SubPrimitiveSynthesisWorld(0).generate_bundle()
        agent = M17GuardedSynthesizerAgent(seed=0)
        agent.lock_regression_suite(bundle.locked_m16_regression_tasks)
        agent.acquire_warmup_base_skills(bundle.base_warmup_tasks)

        initial_version = agent.library.version
        initial_skill_ids = [s.skill_id for s in agent.library.active_skills]

        outcome = agent.solve_task(bundle.family_a_task, bundle.locked_m16_regression_tasks)
        self.assertTrue(outcome["promoted"])
        self.assertEqual(agent.library.version, initial_version + 1)
        self.assertEqual(len(agent.library.active_skills), len(initial_skill_ids) + 1)

        # Execute rollback and verify exact restoration.
        restored_version = agent.library.rollback()
        self.assertEqual(restored_version, initial_version)
        self.assertEqual([s.skill_id for s in agent.library.active_skills], initial_skill_ids)
        self.assertEqual(len(agent.library.rolled_back_records), 1)
        self.assertEqual(agent.library.rolled_back_records[0].stage, "rolled_back")
        self.assertFalse(agent.library.rolled_back_records[0].active)

    def test_08_candidate_search_enforces_depth_and_count_limits(self):
        """8. Kandidatensuche überschreitet weder Tiefen- noch Anzahl-Grenzen."""
        synth = SubPrimitiveSynthesizer(max_base_candidates=25, max_dsl_candidates=12, deduplicate=True)
        base_cands, _ = synth.generate_m16_base_grammar(include_depth2=True)
        dsl_cands, _ = synth.synthesize_subprimitive_candidates()
        self.assertLessEqual(len(base_cands), 25)
        self.assertLessEqual(len(dsl_cands), 12)
        self.assertTrue(all(c.depth <= 2 for c in base_cands))
        self.assertTrue(all(c.depth == 1 for c in dsl_cands))

    def test_09_splits_are_disjoint_and_deterministic_per_seed(self):
        """9. Verschiedene Seeds verunreinigen keine Splits; derselbe Seed ist 100% reproduzierbar."""
        b1_first = SubPrimitiveSynthesisWorld(5).generate_bundle()
        b2 = SubPrimitiveSynthesisWorld(6).generate_bundle()
        b1_second = SubPrimitiveSynthesisWorld(5).generate_bundle()

        # Generating seed 6 in between must not alter seed 5's splits.
        self.assertEqual(b1_first.family_a_task["train_examples"], b1_second.family_a_task["train_examples"])
        self.assertEqual(b1_first.family_a_task["test_examples"], b1_second.family_a_task["test_examples"])
        self.assertNotEqual(b1_first.family_a_task["train_examples"], b2.family_a_task["train_examples"])

        # Verify strict disjointness between train, val, independent_size_val, and test within each task.
        for t in (b1_first.family_a_task, b1_first.family_b_task):
            tr_keys = {scene_canonical_key(e["objects"]) for e in t["train_examples"]}
            vl_keys = {scene_canonical_key(e["objects"]) for e in t["val_examples"]}
            sz_keys = {scene_canonical_key(e["objects"]) for e in t["independent_size_val_examples"]}
            te_keys = {scene_canonical_key(e["objects"]) for e in t["test_examples"]}
            self.assertTrue(tr_keys.isdisjoint(te_keys))
            self.assertTrue(vl_keys.isdisjoint(te_keys))
            self.assertTrue(sz_keys.isdisjoint(te_keys))
            self.assertTrue(tr_keys.isdisjoint(vl_keys))

    def test_10_failed_validation_or_adversarial_check_never_promotes(self):
        """10. Fehlgeschlagene Validierung oder fehlgeschlagener Adversarial-Check führt niemals zur Promotion."""
        # Seed 0 generates Trap 0 (spurious_positional_shortcut), which passes train & val at 100%
        # via spurious_slot0_charge, but fails the adversarial permutation invariance audit!
        bundle = SubPrimitiveSynthesisWorld(0).generate_bundle()
        trap_0 = bundle.family_c_task
        self.assertEqual(trap_0["trap_type"], "spurious_positional_shortcut")

        agent = M17GuardedSynthesizerAgent(seed=0)
        agent.lock_regression_suite(bundle.locked_m16_regression_tasks)
        outcome = agent.solve_task(trap_0, bundle.locked_m16_regression_tasks)
        self.assertFalse(outcome["promoted"])
        self.assertTrue(outcome["quarantined"])
        self.assertFalse(outcome["lifecycle_record"].permutation_invariant)
        self.assertTrue(
            any("failed_permutation_invariance_audit" in r for r in outcome["lifecycle_record"].quarantine_or_rejection_reasons)
        )

        # Also verify GuardedSkillLibrary.promote_candidate raises ValueError if called on a rejected record.
        with self.assertRaises(ValueError):
            agent.library.promote_candidate(outcome["lifecycle_record"], trap_0["train_examples"][:6])

    def test_11_end_to_end_synthesis_and_composition_and_ci_bounds(self):
        """Verify M17 synthesizes missing primitives (A), composes them (B), rejects traps (C), and clamps CIs to [0,1]."""
        data = evaluate([0, 1, 2])
        m17 = data["methods"]["m17_full_guarded_synthesis"]
        m16 = data["methods"]["m16_unchanged_grammar"]

        self.assertGreater(
            m17["valid_tasks_ab_held_out_accuracy"]["mean"],
            m16["valid_tasks_ab_held_out_accuracy"]["mean"],
        )
        self.assertEqual(m17["family_c_adversarial_traps"]["false_promotion_rate"]["mean"], 0.0)
        self.assertEqual(m17["family_c_adversarial_traps"]["false_candidate_rejection_rate"]["mean"], 1.0)

        # Verify CI clamping in [0.0, 1.0] even for near-1.0 accuracy lists.
        ci = clamped_ci95([1.0, 1.0, 0.98, 1.0], clamp_unit=True)
        self.assertGreaterEqual(ci["ci95_low"], 0.0)
        self.assertLessEqual(ci["ci95_high"], 1.0)


if __name__ == "__main__":
    unittest.main()
