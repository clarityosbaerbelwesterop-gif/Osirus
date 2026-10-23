# E12 — Adaptive Sequential Confidence Bounds (M19)

E12 compares the M18-style fixed validation threshold with Wald SPRT for simple Bernoulli hypotheses and a conservative time-uniform empirical-Bernstein procedure using alpha spending. It estimates observed mismatch rates from the outcomes consumed by a method, compares evidence costs, and evaluates target-versus-anchor drift monitoring.

Run from this directory:

`python -m unittest -v`

`python evaluate.py --seeds 0 1 2 ... 29 --output results/results.json`

The evaluator writes raw task-level output to `results/results.json`, a compact summary to `RI/results/m19_summary.json`, and method/ablation data to `RI/results/m19_ablation_results.json`.

## Assumptions and limitations

- The observed mismatch rate is calculated only from responses consumed by the selected method and reported with a Wilson 95% interval. It cannot distinguish label noise, a wrong hypothesis, and a changing target by itself.
- Wald SPRT's nominal error interpretation applies to independent Bernoulli observations under `p0=0.85` and `p1=0.95`. Values between these hypotheses are an indifference region.
- The empirical-Bernstein procedure uses time-indexed alpha-spending and assumes independent bounded observations. Unmodelled serial dependence or arbitrary drift invalidates its stated interpretation.
- Drift classification relies on stable calibration anchors. Without trustworthy reference observations, concept drift and increased observation noise may be observationally indistinguishable.
- Statistical acceptance is not a production promotion. Independent validation, adversarial checks, locked regression, quarantine, rollback, and the existing promotion transaction remain mandatory. E12 never mutates productive SkillMemory and does not replace M18's production gate.
- Results use synthetic streams and do not establish general intelligence or real-world reliability.