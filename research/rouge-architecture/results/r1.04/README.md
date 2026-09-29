# R1.04 result: PARTIAL (pre-registered decision)

**Runs:**
- GitHub Actions run `36562650394`, commit `825ea1b`.
- 4 models × 3 seeds on free CPU runners, 15,000 steps × 64 examples each.
- Benchmark: `benchmarks/microbench2.py`.

`summary.json` and `report.md` are in this folder. The runs are recorded in `experiments/registry.json`.

**Cost:** $0.

## Question

Does a router that executes 2 of 8 MLP modules per token beat a dense MLP of the same active compute? And does it specialise by task, beyond what the token alone explains?

## Scorecard

Accuracy is given as mean ± SD over 3 seeds.

|                                          | transformer (dense)  | transformer-wide (dense) | **moe-top2** (candidate) | moe-top1         |
| ---------------------------------------- | -------------------- | ------------------------ | ------------------------ | ---------------- |
| total parameters                         | 205,740              | 602,028                  | 605,868                  | 1,134,252        |
| active parameters per token              | 205,740              | 602,028                  | **208,044**              | 207,788          |
| FLOPs / example (ID, measured)           | 10.6 M               | 31.9 M                   | **10.7 M**               | 10.7 M           |
| train time (CPU)                         | 20.0 min             | 54.9 min                 | 27.5 min                 | 23.3 min         |
| ID all                                   | 58.6 ± 1.5           | 53.0 ± 6.4               | **58.5 ± 1.3**           | 49.6 ± 10.1      |
| OOD all                                  | 53.5 ± 0.4           | 44.6 ± 11.1              | **54.0 ± 0.4**           | 43.8 ± 11.1      |
| OOD recall                               | 97.2 ± 0.8           | 71.1 ± 35.9              | **98.3 ± 0.6**           | 65.7 ± 36.1      |
| OOD state                                | **17.0 ± 0.7**       | 13.7 ± 1.9               | 15.0 ± 3.0               | 16.9 ± 1.7       |
| OOD hops (50% guess)                     | 46.3 ± 0.7           | 49.1 ± 1.8               | 48.7 ± 3.5               | 48.9 ± 2.1       |
| task–expert NMI (unconditional)          | –                    | –                        | 0.271                    | 0.127            |
| NMI given token: trained / untrained     | –                    | –                        | **0.316 / 0.061**        | 0.239 / 0.069    |
| router entropy (normalised)              | –                    | –                        | 0.706                    | 0.996            |
| least-used expert's load                 | –                    | –                        | 1.0%                     | 3.5%             |

**Per-seed ID accuracy:**

| model            | seed 1 | seed 2 | seed 3 |
| ---------------- | ------ | ------ | ------ |
| transformer      | 59.3   | 56.8   | 59.6   |
| moe-top2         | 59.6   | 57.0   | 59.0   |
| transformer-wide | 57.6   | 55.7   | 45.7   |
| moe-top1         | 55.3   | 37.9   | 55.4   |

transformer-wide's seed 3 and moe-top1's seed 2 partly failed to learn recall.

## Predictions

| Prediction | Result | Evidence |
| --- | --- | --- |
| S1: ID ≥ dense (active-matched) + 2 points, OOD ≥ −1, FLOPs ≤ 1.15× | **no** | 58.5 vs 58.6 ID; 54.0 vs 53.5 OOD; 1.01× FLOPs. Equal, not better |
| S2: ID ≥ dense (total-matched) − 2 at ≤ 0.5× FLOPs | **yes** | 58.5 vs 53.0 at 0.34× FLOPs. The wide baseline is unstable (one seed collapsed) |
| S3: NMI given token ≥ 0.1 and ≥ 2× untrained, every expert ≥ 2% load | **no** | NMI 0.316, 5.2× untrained, but one expert has 1.0% load |

Decision rule: PASS = (S1 or S2) and S3; PARTIAL = (S1 or S2) without S3. **PARTIAL.**

## What was learned

1. **Conditional execution is free here.**
   - The sparse model matches the dense one at equal active compute on every task and in every seed, with 2.9× the stored parameters.
   - It gains nothing, because this benchmark is not capacity-limited:
     - the small dense model already solves recall (97–100%);
     - state and hops are limited by the algorithm or the budget, where more stored parameters do not help.
   - A capacity-hungry benchmark (many facts or skills) is needed to see whether sparse capacity pays.
2. **The router really specialises by context.**
   - The same token is routed differently depending on the task: token-conditioned NMI is 0.32 against 0.06 for the same router untrained.
   - The unconditional NMI would have overstated this (an untrained router already scores 0.11 on it).
   - The Switch balance loss at 0.01 still let one expert starve (1.0% load).
3. **Bigger dense and top-1 models are less stable at this learning rate.**
   - transformer-wide and moe-top1 each had one seed that partly failed.
   - Together with R1.01b's weak FLOP-matched Transformer, this means that comparisons against larger baselines need a per-size learning-rate check before they count.
   - S2's "win" is therefore weak evidence.

## Next

- Sparse circuits are kept as a component with independent evidence of **specialisation at no accuracy cost**. There is no evidence yet of efficiency gains.
- **Follow-ups before combining:**
  - a capacity-bound task set (many facts or skills);
  - a stronger balance term, or expert-choice routing;
  - a learning-rate sweep for the larger baselines.
