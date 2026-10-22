"""M10 End-to-End Orchestrator connecting Steps 1 through 10."""
import time
from typing import List, Optional
from .analyzer import TaskAnalyzer
from .candidates import CandidateGenerator
from .evaluator import TaskEvaluator
from .executor import SandboxExecutor
from .learning_loop import BoundedLearningLoop
from .memory import SkillMemory
from .reporter import TaskRunReport
from .selector import CandidateSelector
from .task import TaskSpec

DEFAULT_LIMITATIONS = [
    "This prototype operates over bounded, explicit discrete grid rule families; it is not a general intelligence system.",
    "Candidate generation searches a finite allow-listed space of primitives and pairwise conjunctions.",
    "Learning loop refines hypothesis selection using development counterexamples without rewriting program source code.",
]


class RIPrototypeOrchestrator:
    """Coordinate the 10-step RI prototype pipeline from TaskInput to Report."""

    def __init__(
        self,
        memory: Optional[SkillMemory] = None,
        complexity_weight: float = 0.01,
        reuse_bonus: float = 0.005,
        enable_learning_loop: bool = True,
    ) -> None:
        self.memory = memory if memory is not None else SkillMemory()
        self.analyzer = TaskAnalyzer()
        self.generator = CandidateGenerator()
        self.selector = CandidateSelector(
            complexity_weight=complexity_weight,
            reuse_bonus=reuse_bonus,
        )
        self.executor = SandboxExecutor()
        self.evaluator = TaskEvaluator(self.executor)
        self.learning_loop = BoundedLearningLoop(self.generator, self.selector)
        self.enable_learning_loop = enable_learning_loop

    def run_task(self, task: TaskSpec, seed: int = 0, persist_skill: bool = True) -> TaskRunReport:
        start = time.perf_counter()

        # Step 1 & 2: Validate task input and analyze structure/subgoals.
        task.validate()
        analysis = self.analyzer.analyze(task)

        # Step 3 & 5: Check versioned skill memory for reusable/composable skills and generate initial candidates.
        memory_candidates = self.memory.find_reusable_candidates(
            allowed_actions=task.constraints.allowed_actions,
            include_compositions=True,
        )
        initial_enumerated = self.generator.generate(
            allowed_actions=task.constraints.allowed_actions,
            include_composed=False,
            extra_families=["sum_threshold", "parity", "diff_threshold"],
        )
        all_candidates = memory_candidates + initial_enumerated
        if not all_candidates:
            all_candidates = self.generator.generate(
                allowed_actions=task.constraints.allowed_actions,
                include_composed=True,
                extra_families=["sum_threshold", "parity", "diff_threshold", "mod_sum", "coord_box"],
            )

        # Step 4: Reason and select initial best candidate.
        decision = self.selector.select(all_candidates, task.train_examples, analysis)

        # Step 6 & 7: Execute and evaluate on development & held-out splits.
        eval_result = self.evaluator.evaluate(decision.selected, task, seed=seed)

        # Step 9: Bounded learning loop if development accuracy falls below criterion.
        if self.enable_learning_loop:
            refined_decision, refinement_trace = self.learning_loop.refine_if_needed(
                task=task,
                analysis=analysis,
                initial_decision=decision,
                misclassified_train=eval_result.misclassified_train,
            )
            if refined_decision.selected.candidate_id != decision.selected.candidate_id:
                decision = refined_decision
                eval_result = self.evaluator.evaluate(decision.selected, task, seed=seed)
        else:
            from .learning_loop import RefinementTrace
            refinement_trace = RefinementTrace(
                triggered=False,
                rounds_run=0,
                counterexamples_analyzed=len(eval_result.misclassified_train),
                initial_candidate_id=decision.selected.candidate_id,
                initial_train_accuracy=decision.train_accuracy,
                refined_candidate_id=decision.selected.candidate_id,
                refined_train_accuracy=decision.train_accuracy,
                improved=False,
                notes=["Learning loop disabled by configuration."],
            )

        exec_result = self.executor.execute(decision.selected, task.test_examples, task.constraints)

        # Step 8: Update skill memory usage history and register new verified skills.
        reused_skill = decision.selected.source in ("memory_reuse", "memory_composition")
        composed_skill = decision.selected.source == "memory_composition" or decision.selected.family == "composed_and"
        if reused_skill:
            self.memory.record_outcome(decision.selected, eval_result.passed)

        stored_skill_id: Optional[str] = None
        if persist_skill and eval_result.passed and exec_result.ok and decision.train_errors == 0:
            param_tag = "_".join(f"{k}{v}" for k, v in sorted(decision.selected.parameters.items()))
            skill_id = f"skill_{decision.selected.family}_{param_tag}"
            rec = self.memory.register_skill(
                skill_id=skill_id,
                name=f"{decision.selected.family}({param_tag})",
                purpose=f"Verified rule for {decision.selected.family} with parameters {decision.selected.parameters}",
                candidate=decision.selected,
                unit_tests=task.train_examples[:8],
                validation_metrics={
                    "train_accuracy": eval_result.train_accuracy,
                    "held_out_accuracy": eval_result.held_out_accuracy,
                },
                min_held_out_accuracy=task.success_criteria.min_held_out_accuracy,
            )
            stored_skill_id = f"{rec.skill_id}@v{rec.version}"

        total_ms = (time.perf_counter() - start) * 1000.0
        return TaskRunReport(
            task_id=task.task_id,
            family=task.family,
            analysis=analysis,
            selection=decision,
            execution=exec_result,
            evaluation=eval_result,
            refinement=refinement_trace,
            reused_skill=reused_skill,
            composed_skill=composed_skill,
            stored_skill_id=stored_skill_id,
            total_runtime_ms=total_ms,
            limitations=list(DEFAULT_LIMITATIONS),
        )
