# E6 — Guarded self-improvement loop (M7)

The prototype closes a narrow loop: evaluate a registered policy on a fixed benchmark, identify the weakest measured metric, propose a bounded configuration change, and evaluate the candidate on held-out seeds. The loop cannot write or execute arbitrary generated code; only allow-listed policy parameters can change.

Promotion gate: candidate must improve the predeclared primary metric on held-out seeds without exceeding the query budget or regressing the safety/invariant checks. Every proposal, baseline, score and rejection is logged.

Run: `python -m unittest -v`, `python evaluate.py --seeds 0 1 2 3 4 5`.

Limit: this is a controlled optimisation harness, not recursive self-rewriting or proof of intelligence. A human must review any change beyond the allow-list.
