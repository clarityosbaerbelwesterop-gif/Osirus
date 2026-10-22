# ROADMAP — RI (Reasoning Intelligence)

## Milestone Overview, Dependencies, and Acceptance Gates

| Milestone | Scope | Dependencies | Status | Verification & Acceptance Gate |
| --- | --- | --- | --- | --- |
| **M0–M2** | Research foundations & initial relationship-learning experiment (`E1`) | None | Executed (Negative/Unclear) | H1 was not supported in the initial `E1` setup (`0.33` held-out accuracy vs `1.0` base-rate/memorize). Documented honestly as a negative result. |
| **M3 (`E2`)** | Operational capability use vs random and fixed schedules | M0–M2 | Executed & Tested | 4 unit tests pass; 30-seed paired evaluation (`accuracy = 0.9000` across capability, random_ablation, and fixed under budget=4, noise=0.15). |
| **M4 (`E3`)** | Two-stage prerequisite composition (`composed` vs `reset` and `random`) | M3 | Executed & Tested | 4 unit tests pass; 30-seed equal-budget evaluation (`composed = 1.0000` vs `reset = 0.2333`, `random = 0.2333`). |
| **M5 (`E4`)** | Autonomous curriculum heuristic vs random, fixed, and error-only | M3 | Executed & Tested | 3 unit tests pass; 30-seed evaluation (`uncertainty_reuse = 0.7304`, `random = 0.7258`, `fixed = 0.7321`, `error_only = 0.7346`). Heuristic does not outperform `error_only`. |
| **M6 (`E5`)** | Continual memory retention (`persistent` vs `reset` ablation) | M3 | Executed & Tested | 4 unit tests pass; 30-seed Brier score evaluation (`persistent = 0.2085` vs `reset = 0.2531`, lower is better). |
| **M7 (`E6`)** | Guarded self-improvement harness (allow-listed config proposal & gate) | M6 | Executed & Tested | 6 unit tests pass; 30-seed paired gate evaluation (`baseline = 0.4263`, `candidate = 0.4527`, `mean_paired_gain = +0.0263 >= 0.01`, promoted). |
| **M8 (`E7`)** | Held-out concept acquisition (`ThresholdRuleLearner` vs `NearestNeighbour` & `MajorityBaseline`) | M3 | Executed & Tested | 5 unit tests pass; 30-seed evaluation (`induced_threshold_rule = 0.9653` vs `nearest_neighbour = 0.8778`, `majority = 0.6389`). |
| **M9 (`E8`)** | Bounded rule-family discovery (`sum_threshold` vs `parity` + 3 baselines + tie diagnostics) | M8 | Executed & Tested | 12 unit tests pass; 30-seed evaluation (`rule_family_selection_rate = 1.0000`, `exact_rule_recovery_rate = 0.8667`, `mean_held_out_accuracy = 0.9833` vs `majority = 0.5611`, `fixed_threshold = 0.6667`, `random_hypothesis = 0.7250`). |
| **M10** | Integrated 10-step End-to-End Prototype (`RI/prototype/` & `RI/run_prototype.py`) | M8, M9 | Executed & Tested | End-to-end flow from `TaskSpec` input through analysis, candidate generation, selection, sandbox execution, disjoint held-out evaluation, skill memory, counterexample learning loop, and JSON reporting. 30-seed benchmark: `task_pass_rate = 1.0000`, `mean_held_out_accuracy = 0.9944`. |
| **M11** | Versioned Skill-Memory, I/O Contract Composition, Held-Out Transfer & Continual Retention | M4, M6, M10 | Executed & Tested | Versioned `SkillRecord` with `IOContract`, unit-test activation gate, quarantine isolation of failing skills, rollback, and compositional transfer (`0.9806` vs `0.7653` single-primitive without memory; continual retention `0.9688` vs `0.6698` reset ablation). |
| **M12** | Guarded Prototype Self-Improvement with Regression Suite, Held-Out Gate & Rollback | M7, M10, M11 | Executed & Tested | Allow-listed `PrototypeConfig` promotion gate: 0.0000 regression drop on 3-task regression suite and `+0.0847` mean paired held-out accuracy gain across 30 seeds (`0.8792` -> `0.9639`), plus verified rollback when candidate underperforms. |

## Prototype Definition and Boundaries

The current RI prototype (`RI/prototype/` and `RI/run_prototype.py`) is a modular, CPU-first, deterministically testable research prototype implementing a 10-step loop over bounded discrete grid tasks. It is **not** a general intelligence system, does not execute arbitrary untrusted code, and does not perform open-ended program synthesis.

## Next Research Gates (M13+)

1. **Richer Structural Hypothesis Languages (M13):** Move beyond fixed 2D coordinate primitives (`sum_threshold`, `parity`, `diff_threshold`, `mod_sum`, `coord_box`, `composed_and`) to compositional relational grammars over variable-size object graphs while preserving bounded execution budgets.
2. **Active Interventional Experiment Design (M14):** Combine `E2` interventional querying with `E8`/`M10` hypothesis disambiguation so the agent actively queries boundary points (`x + y == t - 1`) whenever `CandidateSelector` detects `tie_detected == True`.
3. **Noisy and Non-Stationary Continual Drift (M15):** Stress-test `SkillMemory` quarantine and version rollback under controlled label noise and distribution shift where previously valid skills degrade gradually.
