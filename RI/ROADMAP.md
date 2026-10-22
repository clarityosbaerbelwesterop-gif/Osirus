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

## Prototype definition
The current prototype is a CPU-first research harness with multiple toy environments, explicit agent state, reproducible seeds, baselines, tests, results artifacts and constrained policy proposals. It is **not** a complete autonomous general intelligence system. Important missing work: execute CI, inspect real results, replace synthetic shortcuts with meaningful held-out tasks, autonomous acquisition/composition of skills, memory consolidation, long-horizon planning, causal world-model tests, and external independent review.

## Validation gate
Do not claim any hypothesis supported until workflow runs complete and raw results are inspected. A passing test suite establishes software behavior, not scientific validity. Keep all work under RI on the dedicated branch.
