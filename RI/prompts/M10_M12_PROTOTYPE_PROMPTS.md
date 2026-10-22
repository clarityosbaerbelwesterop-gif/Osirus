# Prompts for Testing, Reviewing, and Extending the RI Prototype (M10–M12)

## Prompt 1 — End-to-End Prototype Verification

> From the repository root on branch `ri/isolated-foundation`, run `python3 RI/run_prototype.py --mode all` and `python3 RI/run_experiments.py`. Confirm both exit with code 0. Inspect `RI/results/prototype_demo_report.json`, `RI/results/prototype_skill_memory.json`, `RI/results/prototype_benchmark.json`, and `RI/results/experiment_suite_summary.json`. Verify that all 5 demo tasks pass, that skill reuse (`demo_3`), skill composition (`demo_4`), and counterexample learning loop refinement (`demo_5`) occur as reported, and that no secret patterns appear in any JSON artifact.

## Prompt 2 — Audit M11 Skill Memory and Quarantine Safety

> Review `RI/prototype/memory.py` and `RI/prototype/transfer.py`. Verify that:
> 1. No skill is activated without passing its unit tests and meeting `min_held_out_accuracy`.
> 2. `compose_skills()` checks `IOContract.is_compatible_with()` and rejects non-active skills.
> 3. Repeated failures on a reused skill transition its status to `"quarantined"` and prevent `find_reusable_candidates()` from returning it.
> 4. `rollback_skill()` restores the prior active version and marks the rolled-back version `"rolled_back"`.

## Prompt 3 — Audit M12 Guarded Self-Improvement Gate

> Review `RI/prototype/self_improvement.py`. Confirm that `GuardedSelfImprover` locks the baseline `PrototypeConfig`, validates candidate parameter bounds, runs the regression suite (`regression_drop <= 0.0`), and evaluates paired held-out gain on disjoint tasks. Verify that a candidate failing either the regression check or `minimum_gain` is automatically rolled back (`status == "rolled_back_to_baseline"`, `active_version == 1`).

## Prompt 4 — Next Milestone (M13 Active Boundary Querying)

> When `CandidateSelector.select()` in `RI/prototype/selector.py` detects `tie_detected == True` (multiple candidates tied at minimum development error), design an active query module that identifies the maximally informative grid coordinate \((x, y)\) where the tied candidates disagree (for example, along \(x + y = t - 1\)), requests its label within a bounded query budget, and resolves the tie before held-out evaluation.
