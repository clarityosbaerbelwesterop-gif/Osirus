# ROADMAP

## M0–M2 — Foundations
Initial research foundation and first relationship-learning experiment recorded. H1 was not confirmed by the initial E1 setup.

## M3 — Operational capability use (E2)
Implemented explicit reusable intervention strategy and random/fixed baselines. Execution and results await CI.

## M4 — Compositional problem solving (E3)
Implemented two-stage prerequisite environment, probe/verify composition, equal-query-budget controls and tests. Execution and results await CI.

## M5 — Autonomous learning selection (E4)
Implemented synthetic curriculum heuristic and random/fixed/error-only baselines. The heuristic and rewards are researcher-designed, not intrinsically discovered. Execution awaits CI.

## M6 — Continual memory and retention (E5)
Implemented explicit Bayesian-style count memory, task-switch sequence, reset ablation, held-out scoring and tests. This is a small interpretable memory experiment, not general memory or general intelligence. Execution awaits CI.

## M7 — Guarded improvement loop (E6)
Implemented allow-listed configuration proposals, bounded validation, deterministic synthetic evaluation and a promotion gate. The loop cannot rewrite arbitrary code. Its scoring is hand-authored and only tests the harness mechanics. Execution awaits CI.

## M8 — Acquired rule generalization (E7)
Implemented a small concept-learning task: infer a threshold rule from labeled examples and score on disjoint held-out points, against nearest-neighbour and majority baselines. The learner is given the correct hypothesis family, so this is not open-ended skill discovery. Executed and verified locally and in CI (30 seeds: induced rule 0.9653 vs nearest-neighbour 0.8778 and majority 0.6389).

## M9 — Bounded rule-family selection (E8)
Implemented and validated bounded hypothesis search over two rule families (`sum_threshold` with \(t \in [0, 14]\) and `parity` on an 8×8 grid), with disjoint train/test splits (`16` train / `24` test), explicit tie and underdetermination diagnostics, and three baselines (`MajorityBaseline`, `FixedThresholdBaseline`, `RandomHypothesisBaseline`). Executed across 30 seeds (`rule_family_selection_rate = 1.0`, `exact_rule_recovery_rate = 0.8667`, `mean_held_out_accuracy = 0.9833` vs majority `0.5611`, fixed threshold `0.6667`, random hypothesis `0.7250`). Bounded to two hand-coded rule families; not open-ended rule discovery.\n\n## Prototype definition
The current prototype is a CPU-first research harness with multiple toy environments, explicit agent state, reproducible seeds, baselines, tests, results artifacts and constrained policy proposals. It is **not** a complete autonomous general intelligence system. Important missing work: execute CI, inspect real results, replace synthetic shortcuts with meaningful held-out tasks, broader held-out rule families and ablations, autonomous acquisition/composition of skills, memory consolidation, long-horizon planning, causal world-model tests, and external independent review.

## Validation gate
Do not claim any hypothesis supported until workflow runs complete and raw results are inspected. A passing test suite establishes software behavior, not scientific validity. Keep all work under RI on the dedicated branch.
