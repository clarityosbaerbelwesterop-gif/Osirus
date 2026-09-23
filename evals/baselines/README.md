# Arena baselines

One JSON file per model id (`<model>.json`, non-alphanumeric characters
replaced by `_`), holding the `current` metrics object from a trusted run's
`arena-results/gate.json`. With a baseline present, the Live evals job fails
when false completions rise, coding verification collapses or research
citations stop verifying (see `src/lib/arena/gate.ts`). Without one the gate
reports only.

No baseline is committed yet: the only measured run so far (2026-09-23,
`deepseek-v4-pro-0813:free`) failed on provider rate limits and upstream
errors, which is not a baseline worth defending.
