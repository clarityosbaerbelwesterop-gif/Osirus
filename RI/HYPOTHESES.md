# HYPOTHESES

## H1 — Adaptive Formation and Revision of Relationships (provisional)

**Statement:** A simple structure can acquire increasingly capable cognitive abilities if it detects changes in its environment, derives testable relationships from them, examines consequences, compares outcomes to expectations, and revises its internal relationships based on new experiences.

**Operationalization in E1:**
- Perceive states (properties + noisy outcome)
- Form conditional relationships (P(success|feature))
- Predict consequences
- Update counts upon observation
- Prefer more specific / higher-evidence relations for prediction

**Status after E1:** Unclear. In a minimal binary causal world with one held-out combination, the candidate did not reliably outperform memorize or mean baselines on held-out accuracy. In some seeds it failed to generalize the correct interaction rule. See results/e1_results.json.

**Alternative explanations considered:**
- Simple frequency counting of conjunctions (what H1 currently approximates)
- Pure memorization of observed cases
- Global base-rate prediction

**Next:** Strengthen the revision mechanism (e.g., explicit hypothesis competition, Bayesian updating, or relational graph) and design a world where interaction terms must be discovered rather than defaulted.
