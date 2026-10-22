# E2 — Capability Transfer and Autonomous Selection

This experiment tests a narrow mechanism, not general intelligence.

## Question

Can an agent learn a reusable intervention strategy in one toy environment, retain it as an explicit capability, and independently apply it in a second environment with changed surface features?

## Environment design

Each environment contains a hidden binary outcome determined by one of two candidate features. The agent can query an observation or perform a controlled intervention. In environment A, feedback allows it to discover that changing one feature while holding the other fixed is informative. Environment B uses remapped feature labels and a different presentation order. Its rule is independently generated; the agent must infer which learned operation is useful and which feature matters.

The agent receives only observations and feedback. The evaluator retains ground truth privately. Development and transfer seeds are separate.

## Agent

The first implementation is transparent and deliberately small:
- uncertainty over candidate features;
- selection of interventions that distinguish candidates;
- explicit capability record for the intervention procedure;
- selection of the procedure in the transfer environment;
- update of beliefs after observed feedback;
- abstention when evidence is insufficient.

This is not a claim of a novel algorithm. The experiment tests whether an explicit reusable capability provides measurable value.

## Baselines

- random valid intervention;
- fixed predetermined intervention sequence;
- no-transfer agent that resets its strategy for environment B;
- capability-transfer agent;
- ablation that transfers a capability label but not its operational procedure.

Use identical environment access and evaluation budgets. Add a majority/prior baseline if the task has a meaningful outcome prior.

## Measures

- accuracy of identifying the controlling feature;
- number of queries to reach a confidence threshold;
- success in held-out transfer tasks;
- calibration or Brier score for probabilistic predictions;
- performance after contradictory evidence;
- runtime and number of environment interactions.

Report results by seed and task family. Avoid treating a single aggregate accuracy as proof of intelligence.

## Run

From this directory, if Python 3.10+ is available:

```bash
python evaluate.py --seeds 0 1 2 3 4 5 6 7 8 9
python -m unittest -v
```

If these files are committed before all execution tools are available, execution status must be recorded as pending until the commands are actually run.
