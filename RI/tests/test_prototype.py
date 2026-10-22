"""Unit, integration, negative, continual-learning, and self-improvement tests for the RI Prototype (M10–M12)."""
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from prototype.active_query import (
    ActiveBoundaryQuerier,
    evaluate_active_boundary_querying,
)
from prototype.analyzer import TaskAnalyzer
from prototype.candidates import CandidateGenerator, CandidateHypothesis
from prototype.compositional_language import (
    CompositionalSkillSynthesizer,
    compose_skill_records,
    evaluate_compositional_language,
)
from prototype.drift_and_noise import (
    DriftAndNoiseController,
    corrupt_training_labels,
    evaluate_drift_and_noise_robustness,
)
from prototype.executor import SandboxExecutor
from prototype.memory import IOContract, SkillMemory
from prototype.orchestrator import RIPrototypeOrchestrator
from prototype.self_improvement import (
    GuardedSelfImprover,
    PrototypeConfig,
    propose_configuration_improvement,
)
from prototype.task import (
    SuccessCriteria,
    TaskConstraints,
    TaskSpec,
    generate_grid_task,
)
from prototype.transfer import evaluate_skill_transfer_and_continual_learning
import run_prototype


class TestM10PrototypeEndToEnd(unittest.TestCase):
    def test_task_validation_rejects_overlapping_splits_and_secrets(self):
        ex = [{"x": 1, "y": 2, "label": 1}]
        with self.assertRaises(ValueError):
            TaskSpec(
                task_id="overlap",
                family="sum_threshold",
                description="overlapping split",
                train_examples=ex,
                test_examples=ex,
            ).validate()

        with self.assertRaises(ValueError):
            TaskSpec(
                task_id="secret_leak",
                family="sum_threshold",
                description="api_key=sk-123456789012345678901234",
                train_examples=[{"x": 0, "y": 0, "label": 0}],
                test_examples=[{"x": 1, "y": 1, "label": 1}],
            ).validate()

    def test_executor_enforces_allowed_actions_and_step_limits(self):
        executor = SandboxExecutor()
        cand = CandidateHypothesis(
            candidate_id="c1",
            family="sum_threshold",
            action_name="predict_sum_threshold",
            parameters={"threshold": 5},
        )
        examples = [{"x": 0, "y": 0}, {"x": 1, "y": 1}, {"x": 2, "y": 2}]

        # Disallowed action check.
        restricted = TaskConstraints(allowed_actions=("predict_parity",), max_steps=10)
        res_disallowed = executor.execute(cand, examples, restricted)
        self.assertFalse(res_disallowed.ok)
        self.assertEqual(res_disallowed.status, "error_disallowed_action")

        # Step budget check.
        step_limited = TaskConstraints(max_steps=2)
        res_steps = executor.execute(cand, examples, step_limited)
        self.assertFalse(res_steps.ok)
        self.assertEqual(res_steps.status, "error_step_limit")
        self.assertEqual(res_steps.steps_used, 2)

    def test_end_to_end_pipeline_and_learning_loop_refinement(self):
        orch = RIPrototypeOrchestrator(memory=SkillMemory(), enable_learning_loop=True)
        # mod_sum requires learning loop refinement because initial pass only enumerates sum/parity/diff.
        task_mod = generate_grid_task(
            seed=11,
            family="mod_sum",
            train_size=24,
            test_size=24,
            parameter_override={"modulus": 3, "remainder": 1},
        )
        report = orch.run_task(task_mod, seed=11)
        self.assertTrue(report.evaluation.passed)
        self.assertTrue(report.refinement.triggered)
        self.assertTrue(report.refinement.improved)
        self.assertEqual(report.evaluation.held_out_accuracy, 1.0)
        self.assertIsNotNone(report.stored_skill_id)


class TestM11SkillMemoryAndTransfer(unittest.TestCase):
    def test_skill_memory_persistence_reuse_composition_and_rollback(self):
        with tempfile.TemporaryDirectory() as tmp:
            mem_path = Path(tmp) / "skills.json"
            mem = SkillMemory(storage_path=mem_path, quarantine_failure_threshold=2)

            cand_sum_v1 = CandidateHypothesis(
                candidate_id="sum_v1",
                family="sum_threshold",
                action_name="predict_sum_threshold",
                parameters={"threshold": 6},
            )
            tests_v1 = [
                {"x": 3, "y": 3, "label": 1},
                {"x": 2, "y": 2, "label": 0},
            ]
            rec_v1 = mem.register_skill(
                skill_id="skill_sum",
                name="sum_ge_6",
                purpose="threshold 6",
                candidate=cand_sum_v1,
                unit_tests=tests_v1,
                validation_metrics={"held_out_accuracy": 1.0},
            )
            self.assertEqual(rec_v1.version, 1)

            # Register v2 on the same skill lineage and then roll back to v1.
            cand_sum_v2 = CandidateHypothesis(
                candidate_id="sum_v2",
                family="sum_threshold",
                action_name="predict_sum_threshold",
                parameters={"threshold": 7},
            )
            tests_v2 = [
                {"x": 4, "y": 3, "label": 1},
                {"x": 3, "y": 3, "label": 0},
            ]
            rec_v2 = mem.register_skill(
                skill_id="skill_sum",
                name="sum_ge_7",
                purpose="threshold 7",
                candidate=cand_sum_v2,
                unit_tests=tests_v2,
                validation_metrics={"held_out_accuracy": 0.95},
            )
            self.assertEqual(rec_v2.version, 2)
            self.assertEqual(mem.get_skill("skill_sum").version, 2)

            rolled = mem.rollback_skill("skill_sum")
            self.assertEqual(rolled.version, 1)
            self.assertEqual(mem.get_skill("skill_sum").version, 1)

            # Reload from disk and verify state is preserved.
            reloaded = SkillMemory(storage_path=mem_path)
            self.assertEqual(reloaded.get_skill("skill_sum").version, 1)
            self.assertEqual(reloaded.summary()["rolled_back_skills"], 1)

    def test_failed_skill_is_quarantined_and_not_reused(self):
        mem = SkillMemory(quarantine_failure_threshold=2)
        cand = CandidateHypothesis(
            candidate_id="sum_6",
            family="sum_threshold",
            action_name="predict_sum_threshold",
            parameters={"threshold": 6},
        )
        rec = mem.register_skill(
            skill_id="skill_fragile",
            name="sum_6",
            purpose="test quarantine",
            candidate=cand,
            unit_tests=[{"x": 3, "y": 3, "label": 1}],
            validation_metrics={"held_out_accuracy": 0.95},
        )
        reusable_cand = rec.to_candidate()
        self.assertEqual(len(mem.find_reusable_candidates(("predict_sum_threshold",))), 1)

        mem.record_outcome(reusable_cand, passed=False)
        self.assertEqual(rec.status, "active")
        mem.record_outcome(reusable_cand, passed=False)
        self.assertEqual(rec.status, "quarantined")
        self.assertEqual(len(mem.find_reusable_candidates(("predict_sum_threshold",))), 0)

    def test_transfer_and_continual_learning_outperform_baselines(self):
        summary = evaluate_skill_transfer_and_continual_learning([0, 1, 2, 3, 4])
        self.assertGreaterEqual(summary["direct_reuse_rate"], 0.8)
        self.assertGreaterEqual(summary["compositional_transfer_rate"], 0.8)
        self.assertGreater(
            summary["compositional_transfer_accuracy"]["skill_memory_composition"],
            summary["compositional_transfer_accuracy"]["no_memory_single_primitive"],
        )
        self.assertGreater(
            summary["continual_learning"]["persistent_memory_retention_accuracy"],
            summary["continual_learning"]["reset_memory_ablation_accuracy"],
        )
        self.assertLessEqual(summary["continual_learning"]["mean_forgetting_rate"], 0.05)


class TestM12GuardedSelfImprovement(unittest.TestCase):
    def test_valid_proposal_passes_gate_and_promotes(self):
        baseline = PrototypeConfig(version=1, enable_learning_loop=False, complexity_weight=0.02)
        candidate = propose_configuration_improvement(baseline, "composed_and_modular_tasks")
        improver = GuardedSelfImprover(minimum_gain=0.05, max_regression_drop=0.0)
        result = improver.evaluate_candidate(baseline, candidate, held_out_seeds=list(range(12)))
        self.assertTrue(result["promoted"])
        self.assertEqual(result["status"], "promoted")
        self.assertEqual(result["active_version"], 2)
        self.assertTrue(result["regression_gate"]["passed"])
        self.assertTrue(result["held_out_gate"]["passed"])

    def test_non_improving_candidate_is_rejected_and_rolled_back(self):
        baseline = PrototypeConfig(version=1, enable_learning_loop=True, complexity_weight=0.01, max_refinement_rounds=2)
        weaker_candidate = PrototypeConfig(version=2, enable_learning_loop=False, complexity_weight=0.05, max_refinement_rounds=1)
        improver = GuardedSelfImprover(minimum_gain=0.02, max_regression_drop=0.0)
        result = improver.evaluate_candidate(baseline, weaker_candidate, held_out_seeds=list(range(6)))
        self.assertFalse(result["promoted"])
        self.assertEqual(result["status"], "rolled_back_to_baseline")
        self.assertEqual(result["active_version"], 1)

    def test_config_rejects_out_of_bounds_parameters(self):
        with self.assertRaises(ValueError):
            PrototypeConfig(complexity_weight=0.9).validate()
        with self.assertRaises(ValueError):
            PrototypeConfig(max_refinement_rounds=10).validate()

    def test_cli_demo_runs_cleanly(self):
        with tempfile.TemporaryDirectory() as tmp:
            demo_out = Path(tmp) / "demo.json"
            mem_out = Path(tmp) / "mem.json"
            rc = run_prototype.main(
                ["--mode", "demo", "--demo-output", str(demo_out), "--memory-output", str(mem_out)]
            )
            self.assertEqual(rc, 0)
            self.assertTrue(demo_out.is_file())
            self.assertTrue(mem_out.is_file())


class TestM13ActiveBoundaryQuerying(unittest.TestCase):
    def test_active_querier_resolves_threshold_tie_with_boundary_point(self):
        # Construct examples where sum=4 is 0 and sum=8 is 1, leaving thresholds 5, 6, 7, 8 tied.
        train = [{"x": 2, "y": 2, "label": 0}, {"x": 4, "y": 4, "label": 1}]
        # Pool contains boundary points for sums 5, 6, 7 (true threshold = 7).
        pool = [
            {"x": 2, "y": 3, "label": 0},  # sum=5
            {"x": 3, "y": 3, "label": 0},  # sum=6
            {"x": 3, "y": 4, "label": 1},  # sum=7
            {"x": 0, "y": 0, "label": 0},  # non-informative point
        ]
        cands = CandidateGenerator().generate(
            allowed_actions=("predict_sum_threshold",),
            include_composed=False,
            extra_families=["sum_threshold"],
        )
        querier = ActiveBoundaryQuerier(policy="active_disagreement", budget=2, seed=0)
        aug, trace = querier.query_and_augment(cands, train, pool)
        self.assertEqual(trace.initial_version_space_size, 4)
        self.assertEqual(trace.final_version_space_size, 1)
        self.assertTrue(trace.tie_resolved)
        self.assertLessEqual(trace.queries_used, 2)
        final_vs = ActiveBoundaryQuerier.version_space(cands, aug)
        self.assertEqual(final_vs[0].parameters["threshold"], 7)

    def test_active_query_evaluation_beats_passive_and_random(self):
        res = evaluate_active_boundary_querying(list(range(12)), initial_train_size=10, query_budget=3)
        self.assertGreaterEqual(
            res["policies"]["active_disagreement"]["mean_held_out_accuracy"],
            res["policies"]["passive_no_query"]["mean_held_out_accuracy"],
        )
        self.assertGreaterEqual(
            res["policies"]["active_disagreement"]["exact_rule_recovery_rate"],
            res["policies"]["random_query"]["exact_rule_recovery_rate"],
        )


class TestM14CompositionalSkillLanguage(unittest.TestCase):
    def test_multi_operator_composition_evaluates_and_or_xor_and_not(self):
        mem = SkillMemory()
        s_sum = mem.register_skill(
            skill_id="s_sum",
            name="sum_6",
            purpose="sum>=6",
            candidate=CandidateHypothesis(
                candidate_id="c_sum",
                family="sum_threshold",
                action_name="predict_sum_threshold",
                parameters={"threshold": 6},
            ),
            unit_tests=[{"x": 3, "y": 3, "label": 1}, {"x": 1, "y": 1, "label": 0}],
            validation_metrics={"held_out_accuracy": 1.0},
        )
        s_par = mem.register_skill(
            skill_id="s_par",
            name="parity_0",
            purpose="even sum",
            candidate=CandidateHypothesis(
                candidate_id="c_par",
                family="parity",
                action_name="predict_parity",
                parameters={"parity": 0},
            ),
            unit_tests=[{"x": 2, "y": 2, "label": 1}, {"x": 1, "y": 2, "label": 0}],
            validation_metrics={"held_out_accuracy": 1.0},
        )
        # At (3, 3): sum=6 (>=6 -> 1, even -> 1). At (3, 4): sum=7 (>=6 -> 1, even -> 0).
        c_and = compose_skill_records(s_sum, s_par, "AND")
        c_or = compose_skill_records(s_sum, s_par, "OR")
        c_xor = compose_skill_records(s_sum, s_par, "XOR")
        c_and_not = compose_skill_records(s_sum, s_par, "AND_NOT")

        self.assertEqual(c_and.predict_one(3, 3), 1)
        self.assertEqual(c_and.predict_one(3, 4), 0)
        self.assertEqual(c_or.predict_one(1, 1), 1)  # sum=2 (<6 -> 0, even -> 1)
        self.assertEqual(c_xor.predict_one(3, 3), 0)
        self.assertEqual(c_xor.predict_one(3, 4), 1)
        self.assertEqual(c_and_not.predict_one(3, 4), 1)
        self.assertEqual(c_and_not.predict_one(3, 3), 0)

    def test_memory_guided_composition_compresses_search_space_and_generalizes(self):
        res = evaluate_compositional_language(list(range(8)), train_size=14, test_size=24)
        self.assertGreater(res["search_compression_ratio"], 20.0)
        self.assertGreater(
            res["policies"]["memory_guided_composition"]["mean_held_out_accuracy"],
            res["policies"]["single_primitive_only"]["mean_held_out_accuracy"],
        )


class TestM15DriftAndNoiseRobustness(unittest.TestCase):
    def test_label_corruption_respects_bounds(self):
        clean = [{"x": x, "y": 0, "label": 1} for x in range(8)]
        self.assertEqual(corrupt_training_labels(clean, 0.0, seed=1), clean)
        with self.assertRaises(ValueError):
            corrupt_training_labels(clean, 0.5, seed=1)

    def test_guarded_drift_controller_outperforms_naive_and_frozen(self):
        res = evaluate_drift_and_noise_robustness(list(range(10)))
        g_acc = res["stream_policies"]["guarded_drift_controller"]["mean_stream_held_out_accuracy"]
        n_acc = res["stream_policies"]["naive_overwrite"]["mean_stream_held_out_accuracy"]
        s_acc = res["stream_policies"]["static_frozen"]["mean_stream_held_out_accuracy"]
        self.assertGreater(g_acc, n_acc)
        self.assertGreater(g_acc, s_acc)


if __name__ == "__main__":
    unittest.main()
