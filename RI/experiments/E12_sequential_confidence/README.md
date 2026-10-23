# E12 — Adaptive Sequential Confidence Bounds (M19)

E12 compares the M18-style fixed validation threshold with Wald SPRT for simple Bernoulli hypotheses and a conservative time-uniform empirical-Bernstein procedure using alpha spending. It estimates an observed mismatch rate from consumed outcomes and evaluates target-versus-anchor drift monitoring.

From this directory:

\`\`\`bash
python -m unittest -v
python evaluate.py --seeds $(seq 0 29) --output results/results.json
\`\`\`

The evaluator writes raw task-level output to \`results/results.json\`, a compact summary to \`RI/results/m19_summary.json\`, and method results to \`RI/results/m19_ablation_results.json\`.

## Assumptions and limitations

- The observed mismatch rate is calculated only from responses consumed by the selected method and reported with a Wilson 95% interval. It cannot identify whether an error came from noisy labels, a wrong hypothesis, or a changing target.
- Wald SPRT's nominal error interpretation applies to independent Bernoulli observations under \`p0=0.85\` and \`p1=0.95\`. Values between these hypotheses are an indifference region.
- The empirical-Bernstein procedure uses time-indexed alpha-spending and assumes independent bounded observations. Unmodelled serial dependence or arbitrary drift invalidates its stated interpretation.
- Drift classification relies on stable calibration anchors. Without trustworthy reference observations, concept drift and increased observation noise may be observationally indistinguishable.
- Statistical acceptance is not a production promotion. The existing independent validation, adversarial, regression, quarantine, rollback, and promotion gates remain mandatory. E12 never mutates productive SkillMemory or automatically replaces M18's production gate.
- Results use synthetic data and do not establish general intelligence or real-world reliability.
