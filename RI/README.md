# RI — Reasoning Intelligence

Foundational research into whether an agent can develop, compose, select, and revise problem-solving capabilities through experience.

## Status
- Dedicated branch: `ri/isolated-foundation`.
- M0–M2: initial research and E1 were reported completed; E1 did not support H1 in its initial setup.
- M3/E2: operational capability selection and fairer baselines committed.
- M4/E3: sequential task tests whether a prerequisite operation can be composed with a second operation.
- M5/E4: synthetic autonomous-curriculum selection compares uncertainty/reuse, random, fixed, and error-only policies.
- **Validation caveat:** these new M3–M5 experiments have not been executed in a live Python runtime in this work session. Do not treat committed code as passing tests or scientific support.

## Experiment directories
- `experiments/E1_relationship_learning/`
- `experiments/E2_capability_transfer/`
- `experiments/E3_composition/`
- `experiments/E4_autonomous_curriculum/`

## Principles
CPU-first; isolated and reproducible experiments; fair baselines; evaluator-only ground truth; preserve negative results; separate observed facts from interpretation. Do not claim consciousness, general intelligence, or a novel intelligence principle without evidence.
