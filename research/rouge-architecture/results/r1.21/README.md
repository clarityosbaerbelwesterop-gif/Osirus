# R1.21 result: PARTIAL (pre-registered decision)

**Early exit with calibrated confidence**

**Run:** GitHub Actions run `36595745090`, commit `0ec2730`.
- 2 models × 3 seeds on free CPU runners (tier 0), 15,000 steps × 64 examples.
- Benchmark: `benchmarks/suite3.py`.
- Full numbers are in `summary.json` and `report.md`.

**Cost:** $0.

**Question:** with an answer head after every layer, can the model stop at the first confident layer and save ≥ 30% FLOPs, losing ≤ 1 point, with ≤ 5% false early exits?

| model | dev | OOD | adversarial | FLOPs / example | stored weights | inference memory | latency | train time |
|---|---|---|---|---|---|---|---|---|
| transformer | 44.0 ± 5.3 | 32.7 ± 4.3 | 42.4 ± 6.6 | 22.8 M | 806 KiB | 198 KiB | 0.23 ms | 21 min |
| early | 36.4 ± 0.1 | 27.0 ± 1.1 | 30.8 ± 1.7 | 22.8 M | 844 KiB | 198 KiB | 0.22 ms | 23 min |

(Accuracies are percent, mean ± SD over seeds. FLOPs are executed per example. Inference memory is state plus KV cache for one example.)

| check | left | right (threshold) | holds | difference, 95% interval |
|---|---|---|---|---|
| E1_flops | early:var.exit80.flops = 21.5 M | <= early:var.full.flops = 22.8 M × 0.7 → 16.0 M | no |  |
| E2_accuracy | early:var.exit80.dev = 36.4 | >= early:var.full.dev = 36.4 -0.01 → 35.4 | **yes** | +0.0 ± 0.3 |
| E3_false_exits | early:var.exit80.false_exit_rate = 0.0 | <= value → 5.0 | **yes** |  |
| E4_supervision_cost | early:var.full.dev = 36.4 | >= transformer:dev.all = 44.0 -0.02 → 42.0 | no | -7.5 ± 13.2 |

**Statistical power:** 3 seeds. On suite v3 the seed SD of dev accuracy is often 4–6 points, so the 95% interval of a difference is often ±9–14 points. A gate that holds on the means but inside that interval is marked *within seed noise* below: the pre-registered decision stands, but it is provisional.

Exit variants: at threshold 0.8 the mean exit layer is 3.77 of 4; at 0.7 it is 3.71.

## What was learned

1. **Early exit here is safe but saves almost nothing.**
   - Accuracy is unchanged and there are zero false exits (E2, E3).
   - Only 5.7% of the FLOPs are saved at 0.8, and 7% at 0.7 (E1 needs 30%).
   - Early layers are rarely confident on suite v3: its tasks need every layer.
2. **Deep supervision of a 4-layer model costs 7.5 points of dev accuracy** (36.4 vs 44.0; E4).
3. **Early exit only pays when many inputs are easy.** It is parked until the LM setting of R1.14, where easy tokens are common, and is re-tested there on the trained model.
