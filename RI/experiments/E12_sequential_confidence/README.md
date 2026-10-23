# E12 — Adaptive Sequential Confidence Bounds (M19)

E12 compares the M18-style fixed 14-example threshold with Wald SPRT for simple Bernoulli hypotheses and a conservative time-uniform empirical-Bernstein procedure using alpha spending. It also evaluates a target-versus-anchor drift monitor.

Commands from this directory: run \`python -m unittest -v\`; then run \`python evaluate.py --seeds 0 1 2 --output results/results.json\` or use seeds 0 through 29 for the full benchmark.

The evaluator writes raw task-level output to results/results.json, a compact summary to RI/results/m19_summary.json, and method/ablation data to RI/results/m19_ablation_results.json.

## Assumptions and limitations

- Wald SPRT's nominal error interpretation applies to independent Bernoulli observations under p0=0.85 and p1=0.95. The interval between these values is an indifference region, not covered by the simple-hypothesis guarantee.
- The empirical-Bernstein procedure uses time-indexed alpha-spending, so a fixed-time alpha is not repeatedly reused. It assumes independent bounded observations; unmodelled serial dependence or arbitrary drift invalidates the stated interpretation.
- Drift classification relies on stable calibration anchors. Without a trustworthy reference stream, concept drift and increased observation noise may be observationally indistinguishable.
- Statistical acceptance is only evidence for the existing independent validation, adversarial, regression, quarantine and rollback gates. E12 does not mutate productive SkillMemory and does not switch the production M18 gate.
- Synthetic results do not establish general intelligence or real-world reliability.
