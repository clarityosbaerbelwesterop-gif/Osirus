# E3 — Composition of reusable operations (M4)

Question: can a system compose probe and verification operations to solve held-out two-stage diagnostic tasks?

The hidden task has two independent binary controls. The agent must identify the successful control at each stage from queries and outcomes. Labels are permuted by seed. The evaluator's target is never passed to the agent.

Policies: composed probe/verify, reset policy, random. Metrics: exact success, query cost, paired seed results. Run `python -m unittest -v` and `python evaluate.py --seeds 0 1 2 3 4 5 6 7 8 9`.

Limit: operations are hand-coded. This tests an explicit composition mechanism, not autonomous acquisition or general intelligence.