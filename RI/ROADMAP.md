# ROADMAP

## M0 — Research foundation
- Core questions, initial H1, evaluation principles and isolation rules.
- **Status:** documented.

## M1 — First experimental environment
- Minimal simulated world with hidden rule and noise.
- **Status:** reported executed in the initial cycle.

## M2 — First relationship-learning candidate
- Candidate and baselines evaluated on E1.
- **Status:** reported outcome unclear / not supportive. H1 was not confirmed.

## M3 — Capability development and transfer
- Reframe the target from accumulating rules to acquiring, validating, composing and revising reusable problem-solving operations.
- Added `M3_AUTONOMOUS_INTELLIGENCE.md`.
- Added an initial E2 capability-transfer prototype under `experiments/E2_capability_transfer/`.
- **Engineering status:** source and documentation committed.
- **Execution status:** not verified in a live Python runtime as part of this commit.
- **Scientific status:** no evidence of successful transfer yet. The initial report explicitly records a design flaw: the capability procedure does not yet causally control the transfer agent's choices.

### M3 acceptance gates
1. Make the capability's operational procedure causally relevant to agent behavior.
2. Add fair random, fixed-sequence, no-transfer, and capability-disabled baselines.
3. Ensure evaluator-only ground truth cannot reach the agent.
4. Use predeclared, held-out task families and multiple seeds.
5. Run tests and evaluation; preserve raw results.
6. Claim support only if transfer and capability ablations show a reproducible advantage. Otherwise revise or reject the hypothesis.

## M4 — Compositional problem solving (blocked)
Proceed only after M3 evaluation is valid. Test whether independently acquired capabilities can be combined to solve held-out tasks without task-specific hardcoding.

## M5 — Autonomous learning selection (planned)
Test whether the agent can select useful next experiments based on uncertainty, expected learning value, cross-task reuse and cost, compared with random and fixed curricula.

## M6 — Continual capability growth (planned)
Test retention, revision, regression and cumulative learning across sequential tasks.

## M7+ — Broader environments (planned)
Only after controlled toy experiments work: richer observations, text/video interfaces, external tools and open-ended tasks. No claims of general intelligence from toy benchmarks.
