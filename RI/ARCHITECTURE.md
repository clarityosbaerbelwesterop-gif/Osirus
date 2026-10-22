# ARCHITECTURE — RI Prototype (M10–M12)

## 1. System Overview

The RI prototype is implemented as a modular Python package under `RI/prototype/` with a single CLI entry point at `RI/run_prototype.py` and central test/experiment orchestration in `RI/run_experiments.py`. It requires only the Python 3.12 standard library and runs entirely on CPU without external APIs or paid services.

## 2. End-to-End 10-Step Data Flow

```text
[1. TaskInput (TaskSpec)]
       │  (validates bounds, labels, secret-free text, disjoint train/test split)
       ▼
[2. TaskAnalyzer (TaskAnalysis)]
       │  (extracts positive rate, underdetermination flag, sum/diff/parity signals, subgoals)
       ▼
[5. SkillMemory.find_reusable_candidates] ──► [3. CandidateGenerator]
       │  (retrieves active verified skills &      (enumerates allow-listed primitives)
       │   I/O-compatible skill compositions)
       ▼
[4. CandidateSelector (SelectionDecision)]
       │  (scores on train_examples, applies complexity penalty & reuse bonus, records ties & uncertainty)
       ▼
[6. SandboxExecutor (ExecutionResult)]
       │  (enforces allowed_actions, max_steps, and timeout_ms)
       ▼
[7. TaskEvaluator (EvaluationResult)]
       │  (verifies disjointness, scores held-out split, compares vs Majority, Fixed, Random baselines)
       ▼
[9. BoundedLearningLoop (RefinementTrace)]
       │  (if development counterexamples exist, expands candidate space to mod_sum/coord_box/composed_and)
       ▼
[8. SkillMemory.register_skill / record_outcome]
       │  (persists verified skill with unit tests & version, or quarantines repeatedly failing skills)
       ▼
[10. TaskRunReport (JSON & CLI Report)]
```

## 3. Module Responsibilities and Interfaces

- `RI/prototype/task.py`:
  - `TaskConstraints`: defines `allowed_actions`, `max_steps`, `timeout_ms`, and `input_bounds`.
  - `SuccessCriteria`: defines `min_train_accuracy`, `min_held_out_accuracy`, `require_disjoint_split`, and `max_runtime_ms`.
  - `TaskSpec`: holds `task_id`, `family`, `description`, `train_examples`, `test_examples`, `constraints`, `success_criteria`, and `metadata`. `validate()` enforces disjoint train/test coordinates and rejects secret-like strings.
  - `generate_grid_task()`: deterministic task generator for `sum_threshold`, `parity`, `diff_threshold`, `mod_sum`, `coord_box`, and `composed_and`.
- `RI/prototype/analyzer.py`:
  - `TaskAnalyzer.analyze(task) -> TaskAnalysis`: inspects only `train_examples` to compute structural signals (`sum_monotonic_signal`, `diff_monotonic_signal`, `parity_alternation_signal`), flags underdetermined splits, and produces explicit subgoals.
- `RI/prototype/candidates.py`:
  - `CandidateHypothesis`: immutable hypothesis descriptor with `candidate_id`, `family`, `action_name`, `parameters`, `complexity`, `source`, and `component_skills`.
  - `CandidateGenerator.generate()`: produces bounded candidate hypotheses restricted to `allowed_actions`.
  - Baselines: `MajorityBaselineModel`, `FixedRuleBaselineModel`, `RandomBaselineModel`.
- `RI/prototype/selector.py`:
  - `CandidateSelector.select() -> SelectionDecision`: ranks candidates by development error, skill-reuse bonus, complexity penalty, structural family rank, and deterministic tie-breaking (`-threshold`), reporting `n_tied_at_best_error` and `uncertainty_score`.
- `RI/prototype/executor.py`:
  - `SandboxExecutor.execute() -> ExecutionResult`: executes only allow-listed `action_name` values, counting steps against `max_steps` and elapsed time against `timeout_ms`. Never invokes `eval`, `exec`, or `subprocess`.
- `RI/prototype/evaluator.py`:
  - `TaskEvaluator.evaluate() -> EvaluationResult`: evaluates candidate predictions on `train_examples` and disjoint `test_examples`, computes baseline accuracies and gains, and records misclassified development counterexamples.
- `RI/prototype/memory.py` (M11):
  - `IOContract`: explicit input schema (`{"x": "int[0,7]", "y": "int[0,7]"}`), preconditions, and output schema (`"int{0,1}"`) with `is_compatible_with()` verification.
  - `SkillRecord`: versioned skill object (`skill_id`, `version`, `parent_version`, `status`, `unit_tests`, `validation_metrics`, `usage_count`, `success_count`, `failure_count`).
  - `SkillMemory`: JSON-backed store supporting `register_skill()` (gated by unit tests and `min_held_out_accuracy`), `find_reusable_candidates()`, `compose_skills()`, `record_outcome()` (automatic quarantine when `failure_count >= quarantine_failure_threshold`), and `rollback_skill()`.
- `RI/prototype/learning_loop.py`:
  - `BoundedLearningLoop.refine_if_needed() -> (SelectionDecision, RefinementTrace)`: bounded 2-round counterexample refinement expanding search from basic primitives (`sum_threshold`, `parity`, `diff_threshold`) to `mod_sum`/`coord_box` (Round 1) and `composed_and` (Round 2).
- `RI/prototype/transfer.py` (M11):
  - `evaluate_skill_transfer_and_continual_learning(seeds)`: multi-seed evaluation of direct skill reuse, compositional transfer to held-out `composed_and` tasks, and 4-family continual learning retention vs a reset-memory ablation.
- `RI/prototype/self_improvement.py` (M12):
  - `PrototypeConfig`: versioned, allow-listed orchestrator configuration (`enable_learning_loop`, `complexity_weight`, `reuse_bonus`, `max_refinement_rounds`).
  - `GuardedSelfImprover.evaluate_candidate()`: locks baseline `v1`, validates candidate `v2`, runs the 3-task regression gate (`regression_drop <= 0.0`), evaluates paired gain on disjoint held-out tasks across all 6 families, and either promotes `v2` or rolls back to `v1`.
- `RI/prototype/active_query.py` (M13):
  - `ActiveBoundaryQuerier`: computes the tied version space \(V\) at minimum development error and scores unlabeled pool coordinates by binary Shannon entropy of candidate predictions (`disagreement_score`). Compares `active_disagreement`, `random_query`, and `passive_no_query` without touching held-out test examples.
- `RI/prototype/compositional_language.py` (M14):
  - `CompositionalSkillSynthesizer`: composes active, `IOContract`-compatible skills across 4 Boolean combinators (`AND`, `OR`, `XOR`, `AND_NOT`) and benchmarks `memory_guided_composition` against `unconstrained_depth2_enumeration` and `single_primitive_only`.
- `RI/prototype/drift_and_noise.py` (M15):
  - `DriftAndNoiseController`: manages continual skill lineages across clean, noisy (`15%`), drifted, shock (`40%` noise), and recurring regimes using `noise_tolerance`, `max_adapt_batch_error`, and `SkillMemory.reactivate_version()`.

## 4. Safety, Isolation, and Reversibility Boundaries

1. **Bounded Action Space:** Only the 6 allow-listed grid prediction primitives in `ALLOWED_ACTIONS` can be executed. Arbitrary Python or shell execution is impossible through task or candidate specifications.
2. **Secret Hygiene:** `ensure_no_secrets()` scans task inputs, skill memory files, and JSON reports for credential patterns (`api_key`, `secret_key`, `access_token`, `private_key`, `ghp_`, `sk-`).
3. **Versioned & Reversible Memory:** Every skill update increments `version`, preserves `parent_version`, requires passing unit tests before activation, quarantines failing skills, and supports deterministic rollback via `SkillMemory.rollback_skill()`.
4. **Guarded Self-Improvement:** `GuardedSelfImprover` modifies only bounded `PrototypeConfig` numbers/booleans and automatically rolls back to the baseline version if either the regression suite or the held-out minimum gain gate fails.
