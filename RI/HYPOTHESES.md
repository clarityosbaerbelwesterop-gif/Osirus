# HYPOTHESES

## H1 — Adaptive relationship formation and revision
A system may improve by deriving testable relationships, comparing predictions with outcomes, and revising internal representations.

**E1 status:** not supported / unclear in the initial setup. This does not rule out all relationship-based approaches.

## H2 — Operational capability utility
An agent using an explicit, reusable intervention procedure may outperform random action selection or fixed baselines on noisy diagnostic tasks.

**E2 status:** code committed; execution and evaluation pending. The procedure is hand-specified, so even positive results would not establish autonomous acquisition or cross-domain transfer.

## H3 — Compositional problem solving
A system that composes reusable probe/verify operations and preserves verified prerequisites may solve sequential hidden-rule tasks more reliably than reset or random controls.

**E3 status:** code committed; execution pending. Operations are hand-coded. Support requires reproducible gains across seeds and task variants, with equal information and action budgets.

## H4 — Autonomous curriculum selection
A task-selection policy using uncertainty, measured error, estimated reuse and cost may improve learning efficiency relative to random, fixed and error-only curricula.

**E4 status:** code committed; execution pending. Current task rewards and heuristic are synthetic and hand-designed. Positive results would only validate this specific heuristic in the simulation.

## Shared standards
- Predeclare the hypothesis, baselines, measures and decision rule.
- Keep ground truth inaccessible to the agent.
- Report uncertainty and per-seed outcomes.
- Include ablations and regression tests.
- If a simple baseline matches the candidate, record non-support and revise the hypothesis.
- Never infer general intelligence from toy-world success.
