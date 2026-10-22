# HYPOTHESES

## H1 — Adaptive formation and revision of relationships (provisional)

**Statement:** A system may acquire more capable behavior by detecting environmental changes, deriving testable relationships, examining consequences, comparing predictions with outcomes, and revising internal representations.

**E1 operationalization:** conditional feature/outcome relationships, prediction, and updates from observations.

**Status after E1:** not supported in the reported setup / outcome unclear. The candidate did not reliably outperform the reported baselines on held-out cases. See the E1 results and postmortem when available. Do not reinterpret this as proof that all relationship-based learning is impossible.

## H2 — Reusable capability acquisition and transfer (new, provisional)

**Statement:** An agent that acquires an explicit, operationally defined problem-solving procedure in one environment and selects/applies it in a structurally different environment will show improved sample efficiency or task performance compared with fair agents that do not transfer that procedure.

**Key distinction:** A capability is not a label or a record that an event occurred. It must change the agent's decisions in a measurable way.

**Independent variable:** availability and use of a validated reusable operation, compared with capability-disabled, reset/no-transfer, random, and fixed-sequence controls.

**Dependent variables:** held-out task success, interactions needed to reach a predeclared criterion, calibration, post-contradiction revision, and regression on previously learned tasks.

**Predictions:** If H2 is supported, the capability-enabled agent should show a reproducible advantage on held-out task families and that advantage should decrease when the operational procedure is disabled.

**Alternative explanations:** (1) the second environment is easy enough for a generic baseline; (2) transfer results from shared labels or leaked state rather than the capability; (3) the agent relearns from new feedback and does not use the stored procedure; (4) gains are seed noise.

**Falsification / non-support:** H2 is not supported if the advantage disappears across held-out seeds, if the capability-disabled ablation performs similarly, if evaluator information leaks to the agent, or if complexity adds no measurable value over simpler baselines.

**Status:** not yet tested validly. The initial E2 prototype explicitly has a known limitation: the exported procedure is not yet causally responsible for transfer-agent action selection. It must be fixed before interpreting results.

## Broader research thesis — capability development

RI investigates whether experience can change not only the system's knowledge, but its repertoire of reusable operations, its ability to compose those operations, and its strategy for selecting what to learn next. This is a research program, not a claim of novelty or a proof of general intelligence.

Related areas to review include meta-learning, program induction, hierarchical reinforcement learning, active learning, causal discovery, compositional generalization, developmental robotics, and continual learning. Any novelty claim must be comparative and evidence-based.
