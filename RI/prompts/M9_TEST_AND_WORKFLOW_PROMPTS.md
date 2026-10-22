# M9 verification prompts and workflow checklist

Status: drafted for the M9 E8 rule-discovery experiment. Do not mark M9 as validated until the repository's CI run is green and the saved results artifact has been inspected.

## Prompt A — run the full RI suite

> On branch `ri/isolated-foundation`, inspect the current commit and run `python RI/run_experiments.py` from the repository root using the project's supported Python version. Do not modify code before recording the baseline. Capture the exit code, Python version, commit SHA, and complete output. If a test or evaluation fails, identify the first root cause, make the smallest targeted fix, add a regression test, rerun the affected suite, and then rerun the full suite. Do not report success unless the commands actually exit with code 0.

## Prompt B — validate M9 independently

> From `RI/experiments/E8_rule_discovery`, run `python -m unittest -v`, then run `python evaluate.py --seeds 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 --train-size 16 --test-size 24 --output results/results.json`. Verify that the output contains 30 rows, every row has 16 training and 24 held-out examples, all splits are disjoint, and aggregate metrics can be reproduced from the per-seed rows. Check both rule families separately using exhaustive 64-point examples. Record results; do not infer general intelligence from this synthetic benchmark.

## Prompt C — inspect CI and artifacts

> Inspect the GitHub Actions run triggered by the latest commit on `ri/isolated-foundation`. Confirm the workflow actually executed, inspect every job and test step, and download/read the JSON results artifacts for E7 and E8. If run metadata or artifacts are unavailable, state that validation is unverified rather than assuming a green run. Confirm that a failed experiment causes a non-zero workflow result and that artifacts are uploaded on both success and failure where practical.

## Prompt D — independent code review

> Review M9 for deterministic seeds, data leakage, valid train/test disjointness, edge cases, honest baselines, and metric correctness. In particular, check that rule-family selection is scored separately from held-out prediction accuracy and that ties have a documented deterministic policy. Identify limitations and propose the next experiment only after reviewing the actual results. Do not label the experiment autonomous skill discovery: the hypothesis family is explicitly bounded to two hand-coded rule families.

## Workflow acceptance gate

- [ ] Full runner exits 0 on a clean environment.
- [ ] All E8 unit tests pass.
- [ ] E8 results JSON is uploaded and contains 30 per-seed rows.
- [ ] Repeated runs with the same seeds produce identical metrics.
- [ ] E7 and E8 results artifacts are inspectable from the Actions run.
- [ ] Any promotion or integration decision is based on measured held-out performance and an explicit baseline, not a narrative claim.

## M10 first-prototype entry criteria

M10 should begin only after the M9 gate is met. The first prototype should be a small, inspectable loop: task input → explicit candidate-rule/skill selection → held-out evaluation → bounded memory of successful skills → report. Any self-modification must be isolated, reversible, and gated by tests and a baseline comparison. No unrestricted code execution, silent deployment, or automatic production changes.
