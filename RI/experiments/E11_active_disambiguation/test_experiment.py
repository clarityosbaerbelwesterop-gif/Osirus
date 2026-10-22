"""M18 (E11) — Unit, Safety, Anti-Leakage, and End-to-End Lifecycle Tests."""
import copy
import unittest

from agent import (
    ActiveDisambiguator,
    CandidateRuleAST,
    GuardedSkillLibrary,
    M18ActiveDisambiguationAgent,
    SemanticEquivalenceChecker,
    SubPrimitiveSynthesizer,
)
from environment import (
    ActiveDisambiguationWorld,
    ExperimentalInterventionOracle,
    InterventionSceneGenerator,
    SubPrimitiveSpec,
    scene_canonical_key,
    strip_labels,
)
from evaluate import METHODS, clamped_ci95, evaluate


class TestM18ActiveDisambiguation(unittest.TestCase):
    def test_01_two_competing_hypotheses_resolved_by_distinguishing_scene(self):
        """1. Zwei konkurrierende Hypothesen mit einer eindeutigen unterscheidenden Szene."""
        # Hypothesis A: two charged objects share the same color (color=1)
        # Hypothesis B: two charged objects share the same size (size=3)
        hyp_same_color = CandidateRuleAST(
            candidate_id="hyp_same_color_1",
            origin="synthesized_subprimitive",
            combinator="ID",
            left_kind="subprimitive",
            left_name="pair_same_color_charged",
            left_params={"color": 1},
            complexity=2,
        )
        hyp_same_size = CandidateRuleAST(
            candidate_id="hyp_same_size_3",
            origin="synthesized_subprimitive",
            combinator="ID",
            left_kind="subprimitive",
            left_name="pair_same_size_charged",
            left_params={"size": 3},
            complexity=2,
        )

        # Scene 1 (non-distinguishing): two objects with SAME color=1 AND SAME size=3 -> both predict 1
        # Scene 2 (distinguishing): two objects with SAME color=1 but DIFFERENT sizes (2 and 5) -> A=1, B=0
        candidate_scenes = [
            {
                "scene_id": "confounded_both_1",
                "objects": [
                    {"color": 1, "size": 3, "charge": 1, "pos": 0},
                    {"color": 1, "size": 3, "charge": 1, "pos": 2},
                ],
            },
            {
                "scene_id": "distinguish_same_color_diff_size",
                "objects": [
                    {"color": 1, "size": 2, "charge": 1, "pos": 1},
                    {"color": 1, "size": 5, "charge": 1, "pos": 4},
                ],
            },
        ]

        oracle = ExperimentalInterventionOracle(
            eval_fn=hyp_same_color.predict_scene_unchecked,
            budget=2,
            initial_observed_keys=set(),
            seed=0,
        )
        disambiguator = ActiveDisambiguator(selection_policy="information_gain", seed=0)
        res = disambiguator.disambiguate([hyp_same_color, hyp_same_size], candidate_scenes, oracle)

        self.assertTrue(res.resolved_unique_semantic_class)
        self.assertEqual(res.interventions_used, 1)
        self.assertEqual(res.steps[0].scene_id, "distinguish_same_color_diff_size")
        self.assertAlmostEqual(res.steps[0].expected_information_gain_bits, 1.0, places=6)
        self.assertEqual(res.selected_hypothesis, hyp_same_color)

    def test_02_deterministic_tie_breaking_on_equal_information_gain(self):
        """2. Deterministische Auswahl bei gleichen Informationswerten."""
        hyp_c1 = CandidateRuleAST(
            candidate_id="hyp_c1",
            origin="synthesized_subprimitive",
            combinator="ID",
            left_kind="subprimitive",
            left_name="forall_color_charged",
            left_params={"color": 1, "charge": 1},
            complexity=2,
        )
        hyp_c2 = CandidateRuleAST(
            candidate_id="hyp_c2",
            origin="synthesized_subprimitive",
            combinator="ID",
            left_kind="subprimitive",
            left_name="forall_color_charged",
            left_params={"color": 2, "charge": 1},
            complexity=2,
        )

        # Two scenes with identical IG = 1.0 bit, identical object count (2), identical attribute diversity (2),
        # differing only in canonical positions (pos=1 vs pos=3).
        scene_a = {
            "scene_id": "tie_scene_a",
            "objects": [
                {"color": 1, "size": 2, "charge": 1, "pos": 1},
                {"color": 2, "size": 4, "charge": 0, "pos": 5},
            ],
        }
        scene_b = {
            "scene_id": "tie_scene_b",
            "objects": [
                {"color": 1, "size": 2, "charge": 1, "pos": 3},
                {"color": 2, "size": 4, "charge": 0, "pos": 5},
            ],
        }

        disambiguator = ActiveDisambiguator(selection_policy="information_gain", seed=42)
        oracle_1 = ExperimentalInterventionOracle(
            eval_fn=hyp_c1.predict_scene_unchecked, budget=1, initial_observed_keys=set(), seed=1
        )
        oracle_2 = ExperimentalInterventionOracle(
            eval_fn=hyp_c1.predict_scene_unchecked, budget=1, initial_observed_keys=set(), seed=99
        )

        # Regardless of input list order ([scene_a, scene_b] vs [scene_b, scene_a]), tie-breaking picks scene_a
        res_forward = disambiguator.disambiguate([hyp_c1, hyp_c2], [scene_a, scene_b], oracle_1)
        res_reverse = disambiguator.disambiguate([hyp_c1, hyp_c2], [scene_b, scene_a], oracle_2)

        self.assertEqual(res_forward.steps[0].scene_id, "tie_scene_a")
        self.assertEqual(res_reverse.steps[0].scene_id, "tie_scene_a")

    def test_03_hypothesis_space_update_after_observation(self):
        """3. Korrektes Hypothesenupdate nach einer Beobachtung."""
        bundle = ActiveDisambiguationWorld(0).generate_bundle()
        task_a = bundle.tasks_by_family["A_identifiable_competing_rules"]
        agent = M18ActiveDisambiguationAgent(seed=0)
        agent.lock_regression_suites(
            bundle.locked_m16_regression_tasks, bundle.locked_m17_regression_tasks
        )
        outcome = agent.solve_task(
            task_a,
            m16_regression_tasks=bundle.locked_m16_regression_tasks,
            m17_regression_tasks=bundle.locked_m17_regression_tasks,
        )
        disambig = outcome["disambiguation"]

        # Initial 4 competing semantic classes must shrink 4 -> 2 -> 1 across 2 steps
        self.assertEqual(disambig.initial_semantic_classes, 4)
        self.assertEqual(len(disambig.steps), 2)
        self.assertEqual(disambig.steps[0].semantic_classes_before, 4)
        self.assertEqual(disambig.steps[0].semantic_classes_after, 2)
        self.assertEqual(disambig.steps[1].semantic_classes_before, 2)
        self.assertEqual(disambig.steps[1].semantic_classes_after, 1)
        self.assertEqual(disambig.final_semantic_classes, 1)
        self.assertAlmostEqual(disambig.cumulative_entropy_reduction_bits, 2.0, places=5)

    def test_04_empty_or_invalid_candidate_sets_and_scenes_handled_safely(self):
        """4. Leere oder ungültige Kandidatenmengen und Szenen werfen saubere Fehler."""
        disambiguator = ActiveDisambiguator()
        oracle = ExperimentalInterventionOracle(
            eval_fn=lambda objs: 1, budget=1, initial_observed_keys=set(), seed=0
        )

        # Empty hypothesis set -> ValueError
        with self.assertRaises(ValueError):
            disambiguator.disambiguate([], [], oracle)

        # Invalid scene object attributes (pos=99 outside allowed intervention positions) -> ValueError
        valid_hyp = SubPrimitiveSynthesizer().synthesize_subprimitive_candidates()[0]
        invalid_scene = [
            {
                "scene_id": "bad_pos",
                "objects": [
                    {"color": 0, "size": 2, "charge": 1, "pos": 99},
                    {"color": 1, "size": 3, "charge": 0, "pos": 1},
                ],
            }
        ]
        with self.assertRaises(ValueError):
            disambiguator.disambiguate([valid_hyp], invalid_scene, oracle)

        # Duplicate scene observation or exceeding oracle budget -> ValueError / RuntimeError
        good_objs = [
            {"color": 0, "size": 2, "charge": 1, "pos": 0},
            {"color": 1, "size": 3, "charge": 0, "pos": 1},
        ]
        oracle_dup = ExperimentalInterventionOracle(
            eval_fn=lambda objs: 1,
            budget=2,
            initial_observed_keys={scene_canonical_key(good_objs)},
            seed=0,
        )
        with self.assertRaises(ValueError):
            oracle_dup.observe(good_objs)

        oracle_zero = ExperimentalInterventionOracle(
            eval_fn=lambda objs: 1, budget=0, initial_observed_keys=set(), seed=0
        )
        with self.assertRaises(RuntimeError):
            oracle_zero.observe(good_objs)

    def test_05_semantic_equivalence_detected_without_unnecessary_interventions(self):
        """5. Semantische Äquivalenz wird erkannt, spart Interventionen und täuscht keine Einzel-Syntax vor."""
        # Part A: Direct 2-hypothesis equivalence check (0 interventions used)
        canon_ast = CandidateRuleAST(
            candidate_id="canon_c1",
            origin="synthesized_subprimitive",
            combinator="ID",
            left_kind="subprimitive",
            left_name="forall_color_charged",
            left_params={"color": 1, "charge": 1},
            complexity=2,
        )
        twin_ast = CandidateRuleAST(
            candidate_id="twin_c1",
            origin="syntactic_equivalent_twin",
            combinator="ID",
            left_kind="subprimitive",
            left_name="no_color_opposite_charge",
            left_params={"color": 1, "charge": 1},
            complexity=3,
        )
        oracle_direct = ExperimentalInterventionOracle(
            eval_fn=canon_ast.predict_scene_unchecked, budget=3, initial_observed_keys=set(), seed=0
        )
        direct_res = ActiveDisambiguator(use_equivalence_check=True, seed=0).disambiguate(
            [canon_ast, twin_ast], [], oracle_direct
        )
        self.assertTrue(direct_res.equivalence_detected)
        self.assertEqual(direct_res.interventions_used, 0)
        self.assertEqual(direct_res.selected_hypothesis, canon_ast)

        # Part B: Full Family C task (1 intervention eliminates non-equivalent competitor, 0 wasted on equivalent twin)
        bundle = ActiveDisambiguationWorld(0).generate_bundle()
        task_c = bundle.tasks_by_family["C_semantically_equivalent"]

        agent_full = M18ActiveDisambiguationAgent(
            selection_policy="information_gain", use_equivalence_check=True, seed=0
        )
        agent_no_eq = M18ActiveDisambiguationAgent(
            selection_policy="information_gain", use_equivalence_check=False, seed=0
        )
        out_full = agent_full.solve_task(task_c, m16_regression_tasks=bundle.locked_m16_regression_tasks)
        out_no_eq = agent_no_eq.solve_task(task_c, m16_regression_tasks=bundle.locked_m16_regression_tasks)

        self.assertTrue(out_full["equivalence_detected"])
        self.assertFalse(out_full["uniquely_identified_single_syntax"])
        self.assertEqual(
            out_full["disambiguation"].interventions_used,
            out_full["disambiguation"].n_distinguishing_interventions,
        )
        self.assertLess(
            out_full["disambiguation"].interventions_used,
            task_c["intervention_budget"],
        )
        self.assertGreaterEqual(len(out_full["disambiguation"].equivalent_expressions), 2)
        self.assertTrue(out_full["promoted"])
        self.assertFalse(out_full["abstained"])

        # Without equivalence check, the two equivalent syntax forms appear as unresolved alternatives
        self.assertFalse(out_no_eq["equivalence_detected"])
        self.assertTrue(out_no_eq["abstained"])
        self.assertFalse(out_no_eq["promoted"])

    def test_06_unidentifiable_hypotheses_abstain_without_exhausting_budget(self):
        """6. Nicht identifizierbare Hypothesen verbrauchen kein Budget, abstainieren und promovieren nicht."""
        bundle = ActiveDisambiguationWorld(0).generate_bundle()
        task_d = bundle.tasks_by_family["D_unidentifiable_ambiguity"]

        agent = M18ActiveDisambiguationAgent(seed=0)
        agent.lock_regression_suites(bundle.locked_m16_regression_tasks, bundle.locked_m17_regression_tasks)
        skills_before = len(agent.library.active_skills)

        outcome = agent.solve_task(
            task_d,
            m16_regression_tasks=bundle.locked_m16_regression_tasks,
            m17_regression_tasks=bundle.locked_m17_regression_tasks,
        )
        disambig = outcome["disambiguation"]

        self.assertEqual(disambig.interventions_used, 0)
        self.assertEqual(disambig.stopped_reason, "no_distinguishing_intervention_in_search_space")
        self.assertGreater(disambig.final_semantic_classes, 1)
        self.assertGreaterEqual(len(disambig.surviving_Expressions), 2)
        self.assertTrue(outcome["abstained"])
        self.assertFalse(outcome["promoted"])
        self.assertTrue(outcome["quarantined"])
        self.assertEqual(len(agent.library.active_skills), skills_before)

    def test_07_noisy_observations_require_corroboration_never_promote_on_single_contradiction(self):
        """7. Verrauschte Beobachtungen: keine Übernahme nach einzelner widersprüchlicher Beobachtung."""
        # Case A (even seed 0 -> B1_recoverable_single_flip): First observation is flipped by noise,
        # subsequent observations corroborate the true hypothesis (margin >= 2).
        bundle_rec = ActiveDisambiguationWorld(0).generate_bundle()
        task_b1 = bundle_rec.tasks_by_family["B_noisy_observations"]
        agent_rec = M18ActiveDisambiguationAgent(seed=0)
        out_b1 = agent_rec.solve_task(task_b1, m16_regression_tasks=bundle_rec.locked_m16_regression_tasks)

        self.assertFalse(out_b1["abstained"])
        self.assertTrue(out_b1["promoted"])
        self.assertGreaterEqual(out_b1["disambiguation"].corroboration_margin, 2)
        self.assertGreaterEqual(out_b1["disambiguation"].interventions_used, 4)

        # Case B (odd seed 1 -> B2_unresolvable_contradictory_noise): Contradictory noisy observations
        # and budget=2 cannot reach corroboration_margin >= 2 -> must abstain and block promotion!
        bundle_unres = ActiveDisambiguationWorld(1).generate_bundle()
        task_b2 = bundle_unres.tasks_by_family["B_noisy_observations"]
        agent_unres = M18ActiveDisambiguationAgent(seed=1)
        out_b2 = agent_unres.solve_task(task_b2, m16_regression_tasks=bundle_unres.locked_m16_regression_tasks)

        self.assertTrue(out_b2["abstained"])
        self.assertFalse(out_b2["promoted"])
        self.assertTrue(out_b2["quarantined"])
        self.assertEqual(len(agent_unres.library.promoted_records), 0)

    def test_08_exhausted_intervention_budget_abstains_and_blocks_promotion(self):
        """8. Erschöpftes Interventionsbudget bei verbleibender Mehrdeutigkeit führt zu Abstention."""
        bundle = ActiveDisambiguationWorld(0).generate_bundle()
        task_a_budget1 = copy.deepcopy(bundle.tasks_by_family["A_identifiable_competing_rules"])
        # With 4 competing semantic classes, budget=1 can at best split 4 -> 2, leaving 2 unresolved!
        task_a_budget1["intervention_budget"] = 1

        agent = M18ActiveDisambiguationAgent(seed=0)
        outcome = agent.solve_task(task_a_budget1, m16_regression_tasks=bundle.locked_m16_regression_tasks)

        self.assertEqual(outcome["disambiguation"].interventions_used, 1)
        self.assertEqual(outcome["disambiguation"].final_semantic_classes, 2)
        self.assertFalse(outcome["disambiguation"].resolved_unique_semantic_class)
        self.assertTrue(outcome["abstained"])
        self.assertFalse(outcome["promoted"])
        self.assertTrue(outcome["quarantined"])
        self.assertEqual(len(agent.library.active_skills), 0)

    def test_09_no_test_label_access_in_selection_or_disambiguation_path(self):
        """9. Fehlende Testlabel-Zugriffe im Auswahlpfad."""
        bundle_orig = ActiveDisambiguationWorld(2).generate_bundle()
        bundle_flipped = copy.deepcopy(bundle_orig)

        for fam, task in bundle_flipped.tasks_by_family.items():
            for item in task["test_examples"]:
                item["label"] = 1 - int(item["label"])
            for item in task["test_large_size_examples"]:
                item["label"] = 1 - int(item["label"])

        agent_orig = M18ActiveDisambiguationAgent(seed=2)
        agent_flip = M18ActiveDisambiguationAgent(seed=2)

        for fam in bundle_orig.tasks_by_family:
            out_o = agent_orig.solve_task(bundle_orig.tasks_by_family[fam])
            out_f = agent_flip.solve_task(bundle_flipped.tasks_by_family[fam])
            self.assertEqual(out_o["selected_candidate"], out_f["selected_candidate"])
            self.assertEqual(out_o["promoted"], out_f["promoted"])
            self.assertEqual(out_o["abstained"], out_f["abstained"])
            self.assertEqual(
                [s.scene_id for s in out_o["disambiguation"].steps],
                [s.scene_id for s in out_f["disambiguation"].steps],
            )

        # Passing labeled test examples to predict_all() or disambiguate() must raise ValueError
        sel = agent_orig.solve_task(bundle_orig.tasks_by_family["A_identifiable_competing_rules"])[
            "selected_candidate"
        ]
        with self.assertRaises(ValueError):
            sel.predict_all(bundle_orig.tasks_by_family["A_identifiable_competing_rules"]["test_examples"])

    def test_10_no_promotion_before_successful_m17_validation(self):
        """10. Keine Promotion vor erfolgreicher unabhängiger Validierung."""
        bundle = ActiveDisambiguationWorld(0).generate_bundle()
        task_corrupt_val = copy.deepcopy(bundle.tasks_by_family["A_identifiable_competing_rules"])
        # Corrupt 100% of independent validation labels so disambiguation succeeds (1 class),
        # but M17 Stage 2 independent validation fails!
        for item in task_corrupt_val["val_examples"]:
            item["label"] = 1 - int(item["label"])

        agent = M18ActiveDisambiguationAgent(seed=0)
        outcome = agent.solve_task(task_corrupt_val, m16_regression_tasks=bundle.locked_m16_regression_tasks)

        self.assertTrue(outcome["disambiguation"].resolved_unique_semantic_class)
        self.assertFalse(outcome["promoted"])
        self.assertTrue(outcome["quarantined"])
        self.assertTrue(outcome["abstained"])
        self.assertTrue(
            any("val_accuracy" in r for r in outcome["lifecycle_record"].quarantine_or_rejection_reasons)
        )

        # Direct call to promote_candidate on an unvalidated "candidate" record must raise ValueError
        lib = GuardedSkillLibrary()
        rec = lib.stage_candidate(outcome["selected_candidate"], train_acc=1.0)
        with self.assertRaises(ValueError):
            lib.promote_candidate(rec, task_corrupt_val["train_examples"][:6])

    def test_11_no_promotion_before_passing_adversarial_checks(self):
        """11. Keine Promotion vor bestandenen adversarialen Prüfungen (Permutationsinvarianz)."""
        bundle = ActiveDisambiguationWorld(0).generate_bundle()
        spurious_cand = CandidateRuleAST(
            candidate_id="spurious_slot0",
            origin="synthesized_subprimitive",
            combinator="ID",
            left_kind="subprimitive",
            left_name="spurious_slot0_charge",
            left_params={"charge": 1},
            complexity=1,
        )
        # Construct a task where spurious_slot0_charge matches train, val, and ind_size_val at 100%,
        # but fails the M17 Stage 3 permutation invariance audit.
        task_spurious = copy.deepcopy(bundle.tasks_by_family["A_identifiable_competing_rules"])
        for split_key in ("train_examples", "val_examples", "independent_size_val_examples"):
            for idx, item in enumerate(task_spurious[split_key]):
                lbl = idx % 2
                item["objects"][0] = {"color": 0, "size": 3, "charge": lbl, "pos": 0}
                item["objects"][1] = {"color": 0, "size": 3, "charge": 1 - lbl, "pos": 1}
                for k, o in enumerate(item["objects"][2:]):
                    o["color"] = 1 if (k % 2 == 0) else 2
                    o["charge"] = k % 2
                    o["size"] = 5
                item["label"] = lbl

        agent = M18ActiveDisambiguationAgent(seed=0)
        outcome = agent.solve_task(task_spurious, m16_regression_tasks=bundle.locked_m16_regression_tasks)

        self.assertFalse(outcome["promoted"])
        self.assertTrue(outcome["quarantined"])
        self.assertEqual(len(agent.library.promoted_records), 0)

    def test_12_no_m17_guard_ablation_never_mutates_productive_memory(self):
        """12. Keine Mutation der aktiven produktiven Memory durch die No-Guard-Ablation."""
        bundle = ActiveDisambiguationWorld(0).generate_bundle()
        productive_lib = GuardedSkillLibrary(read_only_guard=False)

        # Register 2 warmup skills into productive_lib and then lock it with read_only_guard
        warmup_agent = M18ActiveDisambiguationAgent(productive_library=productive_lib, seed=0)
        warmup_agent.acquire_warmup_base_skills(bundle.base_warmup_tasks)
        ver_before = productive_lib.version
        skills_before = [s.skill_id for s in productive_lib.active_skills]
        productive_lib.read_only_guard = True

        # Run no_m17_guard ablation across all 5 task families passing productive_lib
        no_guard_agent = M18ActiveDisambiguationAgent(
            selection_policy="information_gain",
            use_equivalence_check=True,
            use_m17_guard=False,
            productive_library=productive_lib,
            seed=0,
        )
        for fam, task in bundle.tasks_by_family.items():
            no_guard_agent.solve_task(task)

        # Productive library must be 100% untouched
        self.assertEqual(productive_lib.version, ver_before)
        self.assertEqual([s.skill_id for s in productive_lib.active_skills], skills_before)
        self.assertEqual(len(productive_lib.promoted_records), 0)
        self.assertEqual(len(no_guard_agent.isolated_sandbox_promotions), len(bundle.tasks_by_family))

        # Direct mutation attempt on read-only productive library must raise PermissionError
        with self.assertRaises(PermissionError):
            productive_lib.rollback()

    def test_13_successful_rollback_restores_exact_prior_memory_state(self):
        """13. Erfolgreicher Rollback stellt exakt den Zustand vor der Änderung wieder her."""
        bundle = ActiveDisambiguationWorld(0).generate_bundle()
        agent = M18ActiveDisambiguationAgent(seed=0)
        agent.lock_regression_suites(bundle.locked_m16_regression_tasks, bundle.locked_m17_regression_tasks)
        agent.acquire_warmup_base_skills(bundle.base_warmup_tasks)

        version_before = agent.library.version
        skill_ids_before = [s.skill_id for s in agent.library.active_skills]

        outcome = agent.solve_task(
            bundle.tasks_by_family["A_identifiable_competing_rules"],
            m16_regression_tasks=bundle.locked_m16_regression_tasks,
            m17_regression_tasks=bundle.locked_m17_regression_tasks,
        )
        self.assertTrue(outcome["promoted"])
        self.assertEqual(agent.library.version, version_before + 1)
        self.assertEqual(len(agent.library.active_skills), len(skill_ids_before) + 1)

        restored_ver = agent.library.rollback()
        self.assertEqual(restored_ver, version_before)
        self.assertEqual([s.skill_id for s in agent.library.active_skills], skill_ids_before)
        self.assertEqual(agent.library.successful_rollbacks_count, 1)
        self.assertEqual(agent.library.failed_rollbacks_count, 0)
        self.assertEqual(agent.library.rolled_back_records[-1].stage, "rolled_back")

    def test_14_zero_regression_on_locked_m16_and_m17_tasks(self):
        """14. Regression auf M16 und M17 ist 0.0; erzwungene Regression blockiert Promotion."""
        bundle = ActiveDisambiguationWorld(0).generate_bundle()
        agent = M18ActiveDisambiguationAgent(seed=0)
        agent.lock_regression_suites(bundle.locked_m16_regression_tasks, bundle.locked_m17_regression_tasks)

        for fam in ("A_identifiable_competing_rules", "C_semantically_equivalent", "E_adversarial_heuristic_trap"):
            out = agent.solve_task(
                bundle.tasks_by_family[fam],
                m16_regression_tasks=bundle.locked_m16_regression_tasks,
                m17_regression_tasks=bundle.locked_m17_regression_tasks,
            )
            self.assertEqual(out["m16_regression_drop"], 0.0)
            self.assertEqual(out["m17_regression_drop"], 0.0)

        # Simulate a regression on a locked M17 task and verify promotion is blocked
        corrupted_m17_reg = copy.deepcopy(bundle.locked_m17_regression_tasks[0])
        target_subprim = bundle.tasks_by_family["A_identifiable_competing_rules"]["ground_truth_rule"].subprimitive
        for item in corrupted_m17_reg["train_examples"]:
            item["label"] = target_subprim.evaluate(item["objects"])
        for item in corrupted_m17_reg["test_examples"]:
            item["label"] = 1 - target_subprim.evaluate(item["objects"])

        agent_reg = M18ActiveDisambiguationAgent(seed=0)
        agent_reg.lock_regression_suites(bundle.locked_m16_regression_tasks, bundle.locked_m17_regression_tasks)
        out_reg = agent_reg.solve_task(
            bundle.tasks_by_family["A_identifiable_competing_rules"],
            m16_regression_tasks=bundle.locked_m16_regression_tasks,
            m17_regression_tasks=[corrupted_m17_reg],
        )
        self.assertFalse(out_reg["promoted"])
        self.assertTrue(out_reg["quarantined"])
        self.assertGreater(out_reg["m17_regression_drop"], 0.0)

    def test_15_seed_determinism_and_end_to_end_lifecycle_to_promotion_and_abstention(self):
        """15. Identische Resultate bei identischen Seeds und vollständiger End-to-End-Benchmarklauf."""
        run1 = evaluate([0, 1])
        run2 = evaluate([0, 1])

        for m in METHODS:
            m1 = {k: v for k, v in run1["methods"][m].items() if k != "runtime_and_candidate_stats"}
            m2 = {k: v for k, v in run2["methods"][m].items() if k != "runtime_and_candidate_stats"}
            self.assertEqual(m1, m2)
            self.assertEqual(
                run1["methods"][m]["runtime_and_candidate_stats"]["mean_candidate_scenes_evaluated_per_task"],
                run2["methods"][m]["runtime_and_candidate_stats"]["mean_candidate_scenes_evaluated_per_task"],
            )
        self.assertEqual(run1["examples"], run2["examples"])

        ri_full = run1["methods"]["ri_full"]
        no_eq = run1["methods"]["no_equivalence_check"]
        no_guard = run1["methods"]["no_m17_guard"]
        fixed_h = run1["methods"]["fixed_heuristic"]

        self.assertEqual(ri_full["identifiable_exact_rule_identification_rate"]["mean"], 1.0)
        self.assertEqual(ri_full["unidentifiable_abstention_rate"]["mean"], 1.0)
        self.assertEqual(ri_full["semantic_equivalence_handling_rate"]["mean"], 1.0)
        self.assertEqual(ri_full["false_promotions"]["overall_false_promotion_rate"]["mean"], 0.0)
        self.assertGreater(
            ri_full["identifiable_exact_rule_identification_rate"]["mean"],
            fixed_h["identifiable_exact_rule_identification_rate"]["mean"],
        )
        self.assertEqual(no_eq["semantic_equivalence_handling_rate"]["mean"], 0.0)
        self.assertGreater(no_guard["false_promotions"]["overall_false_promotion_rate"]["mean"], 0.0)
        self.assertFalse(
            no_guard["rollback_and_regression_stats"]["productive_memory_mutated_by_no_guard_ablation"]
        )

        ci = clamped_ci95([1.0, 1.0, 0.96, 1.0], clamp_unit=True)
        self.assertGreaterEqual(ci["ci95_low"], 0.0)
        self.assertLessEqual(ci["ci95_high"], 1.0)


if __name__ == "__main__":
    unittest.main()
