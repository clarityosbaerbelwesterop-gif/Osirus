# E5 — Continual learning and retention (M6)

Test whether an agent can accumulate task-family evidence over a sequence without silently losing prior capabilities. This first prototype uses explicit Beta-Bernoulli counts, not neural weights.

Policies: persistent memory, reset-at-task-switch ablation. Each family has a fixed hidden success probability in the environment. Metrics: final predictive Brier score, per-family sample counts, and retention after task switches. Same observations and budgets are used when possible.

Run: `python -m unittest -v`, `python evaluate.py --seeds 0 1 2 3 4 5`.

Limit: structured statistics in a toy world are not human-like memory, general intelligence, or autonomous skill acquisition. The test isolates one small retention mechanism.
