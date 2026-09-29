# R1.26 result: PASS (pre-registered decision)

**Structured matrices (low-rank, Kronecker, tensor-train) vs byte-matched dense**

**Run:** GitHub Actions run `36595752409`, commit `0ec2730`.
- 6 models × 3 seeds on free CPU runners (tier 0), 15,000 steps × 64 examples.
- Benchmark: `benchmarks/suite3.py`.
- Full numbers are in `summary.json` and `report.md`.

**Cost:** $0.

**Question:** do structured MLP weight matrices (low-rank, Kronecker, tensor-train) give more capability per stored byte than a smaller dense Transformer with the same bytes?

| model | dev | OOD | adversarial | FLOPs / example | stored weights | inference memory | latency | train time |
|---|---|---|---|---|---|---|---|---|
| dense | 44.8 ± 4.7 | 32.7 ± 3.6 | 43.6 ± 7.5 | 22.8 M | 806 KiB | 198 KiB | 0.22 ms | 20 min |
| dense-small | 41.0 ± 4.9 | 30.8 ± 2.6 | 37.9 ± 6.5 | 12.8 M | 460 KiB | 148 KiB | 0.19 ms | 17 min |
| dense-tiny | 38.8 ± 2.3 | 30.0 ± 2.5 | 32.7 ± 4.3 | 8.9 M | 324 KiB | 124 KiB | 0.18 ms | 18 min |
| lowrank | 43.0 ± 1.3 | 30.2 ± 1.1 | 40.0 ± 1.5 | 12.4 M | 454 KiB | 198 KiB | 0.20 ms | 20 min |
| kron | 41.7 ± 4.2 | 30.5 ± 3.7 | 37.5 ± 5.9 | 10.7 M | 304 KiB | 198 KiB | 0.25 ms | 24 min |
| tt | 44.7 ± 5.1 | 31.2 ± 4.0 | 41.8 ± 6.2 | 32.3 M | 374 KiB | 198 KiB | 0.80 ms | 99 min |

(Accuracies are percent, mean ± SD over seeds. FLOPs are executed per example. Inference memory is state plus KV cache for one example.)

| check | left | right (threshold) | holds | difference, 95% interval |
|---|---|---|---|---|
| S1_lowrank | lowrank:dev.all = 43.0 | >= dense-small:dev.all = 41.0 +0.02 → 43.0 | no | +2.0 ± 12.5 |
| S2_kron | kron:dev.all = 41.7 | >= dense-tiny:dev.all = 38.8 +0.02 → 40.8 | **yes** | +3.0 ± 8.8 (within seed noise) |
| S3_tt | tt:dev.all = 44.7 | >= dense-tiny:dev.all = 38.8 +0.02 → 40.8 | **yes** | +6.0 ± 13.9 (within seed noise) |
| E1_lowrank | lowrank:dev.all = 43.0 | >= dense-small:dev.all = 41.0 -0.02 → 39.0 | **yes** | +2.0 ± 12.5 (within seed noise) |
| E2_kron | kron:dev.all = 41.7 | >= dense-tiny:dev.all = 38.8 -0.02 → 36.8 | **yes** | +3.0 ± 8.8 (within seed noise) |
| E3_tt | tt:dev.all = 44.7 | >= dense-tiny:dev.all = 38.8 -0.02 → 36.8 | **yes** | +6.0 ± 13.9 (within seed noise) |

**Statistical power:** 3 seeds. On suite v3 the seed SD of dev accuracy is often 4–6 points, so the 95% interval of a difference is often ±9–14 points. A gate that holds on the means but inside that interval is marked *within seed noise* below: the pre-registered decision stands, but it is provisional.

## What was learned

1. **PASS by the pre-registered mean rule, with low power.** Both structured results are within seed noise:
   - Kronecker at 304 KiB: 41.7 dev, vs 38.8 for dense-tiny at 324 KiB (+3.0 ± 8.8).
   - Tensor-train (rank 8) at 374 KiB: 44.7, vs dense-tiny +6.0 ± 13.9. That equals the full dense model (44.8 at 806 KiB) with 46% of the bytes.
2. **The costs differ.**
   - Tensor-train executes 1.4× the FLOPs and is 3.6× slower on CPU (0.80 ms), and it trains 5× longer (einsum chains).
   - Kronecker is cheaper than dense in FLOPs (10.7 M) and only 1.1× slower.
   - Low-rank (rank 16, 454 KiB) shows no gate gain over dense-small (43.0 vs 41.0), but has the lowest seed variance (±1.3).
3. **Carried into R1.31 as candidates, behind ternary (R1.29)**, which wins outside seed noise.
