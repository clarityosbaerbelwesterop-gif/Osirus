# E2 Report — operational capability ablation

## Status
- Revised experiment source: committed in this revision.
- Execution status: **pending external execution** unless a CI or local run is attached.
- Scientific status: no conclusion yet.

## Design change
The prior prototype recorded a generic capability but did not let it affect the transfer agent's choices. This revision makes the stored procedure operational: it selects unseen candidates first, then balances tests across the least-tested candidates. The ablation uses random sampling instead. Both policies receive the same task interface and query budget; the target is held only by the evaluator/environment.

## What this does and does not test
It tests whether a reusable experimental procedure can improve performance over a random policy in a small noisy binary task. It does **not** yet show autonomous acquisition of the procedure, transfer between semantically different domains, composition of capabilities, or general intelligence. The procedure is still hand-specified. A result must not be described as a new intelligence principle.

## Reproducibility
Run:
```bash
python -m unittest -v
python evaluate.py --seeds 0 1 2 3 4 5 6 7 8 9 --budget 4 --noise 0.15
```
Raw rows are written to `results/results.json`. The evaluator target appears in output for audit after evaluation, but is never passed to the agent. Never inspect results and then change thresholds while reporting the same run as confirmatory.

## Next research gate
1. Actually execute tests and evaluation.
2. Add a fixed-sequence baseline and report paired outcomes across enough seeds.
3. Add at least a second task family with different surface encoding.
4. Only then test whether the procedure is acquired from experience rather than hand-installed.
5. If the capability ablation is not reliably better, report non-support and redesign or reject the mechanism.
