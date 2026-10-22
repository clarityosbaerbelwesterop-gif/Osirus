# ROADMAP

## M0 — Research foundation
Questions, hypotheses, isolation, and evaluation principles documented.

## M1 — First experimental environment
Minimal simulated hidden-rule world. Initial cycle reported executed.

## M2 — Relationship-learning candidate
E1 reported outcome unclear / not supportive. H1 was not confirmed.

## M3 — Operational capability use (E2)
- Capability procedure now directly affects action selection.
- Added random-ablation and fixed balanced baseline, paired seeds, input validation, regression tests.
- **Code status:** committed.
- **Execution status:** not verified in this environment; local GitHub clone failed because outbound network/DNS was unavailable. Do not imply tests passed.
- **Scientific status:** pending actual test and evaluation execution. The procedure remains hand-specified, so E2 tests intervention strategy utility, not autonomous capability acquisition.

## M4 — Compositional problem solving (E3)
- Added two-stage environment in which stage 2 is informative only after stage 1 is correctly solved.
- Added a probe/verify operation and composed, reset, and random policies.
- Added tests for prerequisite gating and reproducibility.
- **Code status:** committed.
- **Execution/scientific status:** pending. The operations are hand-coded. Composition is not yet evidence of general intelligence.

## M5 — Autonomous learning selection (E4)
- Added curriculum policy that chooses among synthetic task families using uncertainty, observed success, and a declared reuse heuristic.
- Added random, fixed, and error-only controls and seeded evaluation.
- **Code status:** committed.
- **Execution/scientific status:** pending. Task difficulty and the selection heuristic are designed by researchers; this is not intrinsic motivation or self-discovered curriculum.

## Required validation gates
1. Run all tests and evaluators in Python 3.10+.
2. Preserve raw results and record exact command, environment, and commit.
3. Check for seed sensitivity and compare paired results, not only means.
4. Add multiple task families and stronger baselines before claims about transfer or composition.
5. Distinguish a working software milestone from evidence supporting a hypothesis.
6. Keep M6 blocked until M3–M5 have been executed and reviewed.

## M6 — Continual capability growth (blocked)
Only after the prior experiments pass implementation and validity review: test retention, revision, regression, and cumulative learning across sequential tasks.
