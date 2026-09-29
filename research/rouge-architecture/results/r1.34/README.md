# R1.34 result: FAIL (pre-registered decision)

**Latent program execution: one latent step per program step, with and without execution supervision (covers R1.33)**

**Run:** GitHub Actions run `36595774284`, commit `0ec2730`.
- 4 models × 3 seeds on free CPU runners (tier 0), 15,000 steps × 64 examples.
- Benchmark: `benchmarks/programs.py`.
- Full numbers are in `summary.json` and `report.md`.

**Cost:** $0.

**Question:** if a shared block runs once per program step (oracle depth) and is supervised with the program state after every step, does execution generalise to longer programs? Without the step supervision (R1.33), does the step-aligned loop alone help?

| model | dev | OOD | adversarial | ood.trace | ood.chain | FLOPs / example | stored weights | inference memory | latency | train time |
|---|---|---|---|---|---|---|---|---|---|---|
| transformer | 42.9 ± 4.4 | 31.9 ± 4.4 | 41.5 ± 5.3 | 47.3 ± 4.9 | 16.5 ± 4.4 | 9.1 M | 806 KiB | 70 KiB | 0.17 ms | 10 min |
| looped-fixed4 | 43.8 ± 2.6 | 31.6 ± 4.4 | 45.7 ± 7.4 | 42.7 ± 8.5 | 20.5 ± 0.5 | 36.2 M | 825 KiB | 35 KiB | 0.42 ms | 23 min |
| exec-nohint | 43.2 ± 7.0 | 26.8 ± 3.0 | 45.5 ± 10.0 | 30.5 ± 3.3 | 23.0 ± 3.0 | 72.5 M | 825 KiB | 35 KiB | 0.62 ms | 46 min |
| exec-hint | 41.2 ± 5.8 | 20.8 ± 2.0 | 41.8 ± 2.5 | 30.5 ± 0.5 | 11.0 ± 3.8 | 72.5 M | 825 KiB | 35 KiB | 0.59 ms | 43 min |

(Accuracies are percent, mean ± SD over seeds. FLOPs are executed per example. Inference memory is state plus KV cache for one example.)

| check | left | right (threshold) | holds | difference, 95% interval |
|---|---|---|---|---|
| X1_vs_transformer | exec-hint:ood.all = 20.8 | >= transformer:ood.all = 31.9 +0.1 → 41.9 | no | -11.2 ± 12.0 |
| X2_hints_help | exec-hint:ood.all = 20.8 | >= exec-nohint:ood.all = 26.8 +0.05 → 31.8 | no | -6.0 ± 6.7 |
| X3_R1_33_step_alignment | exec-nohint:ood.all = 26.8 | >= looped-fixed4:ood.all = 31.6 +0.05 → 36.6 | no | -4.8 ± 9.8 |

**Statistical power:** 3 seeds. On suite v3 the seed SD of dev accuracy is often 4–6 points, so the 95% interval of a difference is often ±9–14 points. A gate that holds on the means but inside that interval is marked *within seed noise* below: the pre-registered decision stands, but it is provisional.

This run also carries **R1.33** (check X3).

## What was learned

1. **Step supervision hurts out of distribution.**
   - With hints: 20.8 OOD. Without: 26.8. Transformer: 31.9.
   - In distribution all models are close (41–44 dev). The step-aligned loop fits the trained program lengths and extrapolates worse.
   - Supervising the intermediate states makes it worse still (X1 and X2 fail).
2. **R1.33 FAIL.** Step alignment without supervision (26.8 OOD) is below the same block at fixed depth 4 (31.6; X3 fails).
3. **Calibration.** The step-aligned models are worse calibrated OOD: ECE 0.18 vs 0.13 for the Transformer, and exec-nohint makes confident errors 9.2% of the time.
4. **This differs from the neural-execution literature (CLRS and similar), which works at larger scale** with processor designs built for graphs. At this scale and design, latent program execution is not earned.
   - It is not tuned further. R1.39 tests whether execution rewards help instead.
