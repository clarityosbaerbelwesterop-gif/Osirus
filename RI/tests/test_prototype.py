"""Unit, integration, negative, continual-learning, and self-improvement tests for the RI Prototype (M10–M12)."""
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from prototype.analyzer import TaskAnalyzer
from prototype.candidates import CandidateGenerator, CandidateHypothesis
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


if __name__ == "__main__":
    unittest.main()
