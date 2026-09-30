# R1.27 result: PARTIAL (pre-registered decision)

**Shared basis bank: every MLP matrix is a mix of 2 shared bases**

**Run:** GitHub Actions run `36646266252`, commit `719c88e`.
- 3 models × 3 seeds on free CPU runners (tier 0), 15,000 steps × 64 examples.
- Benchmark: `benchmarks/suite3.py`.
- Full numbers are in `summary.json` and `report.md`.

**Cost:** $0.

**Question:** can a small shared basis (2 matrices per shape, per-layer coefficients) represent the MLPs of 4 layers better than a dense model with the same bytes?

| model | dev | OOD | adversarial | FLOPs / example | stored weights | inference memory | latency | train time |
|---|---|---|---|---|---|---|---|---|
| dense | 44.1 ± 5.4 | 32.7 ± 4.2 | 42.5 ± 7.0 | 22.8 M | 806 KiB | 198 KiB | 0.26 ms | 24 min |
| dense-d52 | 44.0 ± 5.1 | 32.6 ± 5.4 | 42.0 ± 7.3 | 15.1 M | 538 KiB | 161 KiB | 0.18 ms | 15 min |
| bank2 | 45.7 ± 3.7 | 34.1 ± 0.6 | 44.5 ± 1.9 | 22.8 M | 550 KiB | 198 KiB | 0.23 ms | 21 min |

(Accuracies are percent, mean ± SD over seeds. FLOPs are executed per example. Inference memory is state plus KV cache for one example.)

| check | left | right (threshold) | holds | difference, 95% interval |
|---|---|---|---|---|
| B1 | bank2:dev.all = 45.7 | >= dense-d52:dev.all = 44.0 +0.02 → 46.0 | no | +1.7 ± 11.6 |
| B2 | bank2:dev.all = 45.7 | >= dense-d52:dev.all = 44.0 -0.02 → 42.0 | **yes** | +1.7 ± 11.6 (within seed noise) |

**Statistical power:** 3 seeds. On suite v3 the seed SD of dev accuracy is often 4–6 points, so the 95% interval of a difference is often ±9–14 points. A gate that holds on the means but inside that interval is marked *within seed noise* below: the pre-registered decision stands, but it is provisional.

**Amendment before any baseline result:** the byte-matched baseline first crashed at step 0 (d=52 with 4 heads gives an odd head dimension, which RoPE cannot rotate; run `36595763191`). It was re-run with 2 heads (538 KiB). The gate is unchanged. See `amendments` in `experiments/r1_27.json`.

## What was learned

1. **A shared basis bank matches a byte-matched dense model; it does not beat it by the pre-registered 2 points.**
   - bank2 at 550 KiB scores 45.7 dev; dense-d52 at 538 KiB scores 44.0 (+1.7 ± 11.6).
2. **It is the most stable model of the run.** OOD accuracy is 34.1 ± 0.6, against ± 4–5 for the dense models.
3. **Dense capacity saturates early on suite v3.** dense-d52 (538 KiB) already equals dense-d64 (806 KiB): 44.0 vs 44.1.
   - Byte-matched comparisons at 500–800 KiB therefore have little room to show gains.
   - The informative region is below 500 KiB, where ternary (R1.29, 326 KiB, 47.2) and tensor-train (R1.26, 374 KiB, 44.7) sit above the dense curve (dense-d40, 324 KiB: 38.8).
4. **Carried into R1.31 as a measured point.** It is not a winner for R1.32.
