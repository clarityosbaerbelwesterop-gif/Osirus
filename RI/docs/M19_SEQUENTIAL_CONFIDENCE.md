# M19 — Adaptive Sequential Confidence Bounds for Stopping, Abstention and Drift

## Outcome

M19 / E12 has an executed, reproducible 30-seed benchmark and a successful GitHub Actions run. The methods remain an isolated research gate; this milestone does **not** switch the production M18 thresholds or bypass M17's lifecycle.

Implementation commit: `47f500d6ecc1e50851b7b802ae22414d1f31efdb`.

## Compared methods

- **Fixed M18-style baseline:** classify using an accuracy threshold of 0.85 over at most 14 observations. The insufficient-evidence case has only 10 observations; the unidentifiable case has zero. No observations are padded.
- **Wald SPRT:** simple hypotheses `H0: p=0.85` and `H1: p=0.95`, with `alpha=0.05`, `beta=0.10`, and cap 4,000. Its nominal error interpretation assumes independent Bernoulli observations under the stated hypotheses. The interval between 0.85 and 0.95 is an indifference region.
- **Empirical-Bernstein sequential:** a time-indexed alpha-spending schedule `delta_t = 6 alpha / (pi^2 t^2)` is used with an empirical-Bernstein radius. It assumes independent bounded observations and is deliberately conservative.

## Results from the CI benchmark

Thirty seeds were run across nine synthetic task conditions (270 method-task outcomes per method). The reported evidence costs below exclude unidentifiable tasks when comparing costs, because those correctly use zero observations.

| Method | Mean observations, identifiable tasks | Cost vs fixed baseline | False statistical acceptance | Correct action outside indifference region | Inconclusive |
| --- | ---: | ---: | ---: | ---: | ---: |
| Fixed M18-style threshold | 13.50 | 1.00× | 18/270 = 6.67% | 91.43% | 0.00% |
| Wald SPRT | 28.57 | 2.12× | 2/270 = 0.74% | 98.10% | 9.63% |
| Empirical-Bernstein sequential | 1,149.20 | 85.13× | 0/270 observed | 100.00% | 18.52% |

Across the 90 generated outcomes whose underlying accuracy was at most 0.85, the fixed method accepted 18 (20.0%), SPRT accepted 2 (2.22%), and empirical Bernstein accepted 0. The Wilson 95% interval for 0/90 still extends to 4.09%; zero observed errors does not prove zero risk.

The 270-outcome rates combine nine task conditions and should not be interpreted as real-world probabilities. Tasks are grouped within 30 seeds; seed-cluster evidence costs are also reported in the generated result file.

## Drift and noise-shift results

Each regime was run with 30 seeds. The target-versus-anchor monitor produced no alarms in the stationary case (0/30; the Wilson 95% upper bound on the false-alarm rate is 11.35%). It classified abrupt target drift correctly on 30/30 seeds with a mean detection delay of 11.47 observations, and gradual drift on 30/30 with a delay of 51.23. A common-mode noise surge was classified correctly on 25/30 seeds (83.33%); recovery was classified correctly on 29/30 (96.67%). The no-monitor ablation missed all four changed-regime families by construction.

These results show a useful trade-off, not a universal winner: SPRT substantially lowers observed false acceptance with about 2.12× the identifiable-task evidence cost; the empirical-Bernstein method observed no false acceptance but uses about 85× the baseline evidence and abstains more often. The noise-surge confusion shows why drift conclusions depend on reliable anchors.

## Safety boundary

The benchmark's `guarded_promotion_decision` is an adapter for testing admission requirements only. A statistical accept is never a productive promotion. Independent validation, adversarial checks, locked M16/M17 regression, rollback availability, quarantine, and the existing M17 promotion transaction remain mandatory. The prototype has not replaced the production M17/M18 gate.

## Reproducibility

- Benchmark/results CI run: [run 39914581682](https://github.com/clarityosbaerbelwesterop-gif/Osirus/actions/runs/39914581682). The later full-suite validation, including the corrected task label, noise-estimation tests and committed result records, passed: [run 39915276819](https://github.com/clarityosbaerbelwesterop-gif/Osirus/actions/runs/39915276819).
- CI-produced raw task rows and summaries are retained in the run artifact; the committed `RI/results/m19_summary.json` and `RI/results/m19_ablation_results.json` are compact, human-readable result records.
- The evaluation source labels the high-accuracy task as `stable_high_quality`; it is **not** a semantic-equivalence test.

## Limitations and next gate

All observations and drift streams are synthetic Bernoulli draws. SPRT guarantees do not extend automatically to unknown or changing rates, correlated errors, or arbitrary drift. The anchor monitor assumes stable anchor semantics. These results justify retaining both adaptive methods as research alternatives, not turning them on in production. M20 remains hierarchical multi-step experimental planning after the evidence-cost/security trade-off is independently reviewed.