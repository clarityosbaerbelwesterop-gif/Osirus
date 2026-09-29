# R1.29 result: PASS (pre-registered decision)

**Ternary weights trained from the start (BitNet b1.58-style MLP)**

**Run:** GitHub Actions run `36595770781`, commit `0ec2730`.
- 3 models × 3 seeds on free CPU runners (tier 0), 15,000 steps × 64 examples.
- Benchmark: `benchmarks/suite3.py`.
- Full numbers are in `summary.json` and `report.md`.

**Cost:** $0.

**Question:** do ternary MLP weights, trained from the start (BitNet b1.58-style, 2 bits stored), give more capability per stored byte than a full-precision dense model with the same bytes?

| model | dev | OOD | adversarial | FLOPs / example | stored weights | inference memory | latency | train time |
|---|---|---|---|---|---|---|---|---|
| dense | 44.2 ± 5.5 | 32.7 ± 4.3 | 41.8 ± 7.4 | 22.8 M | 806 KiB | 198 KiB | 0.18 ms | 17 min |
| dense-tiny | 38.8 ± 2.3 | 30.0 ± 2.5 | 32.3 ± 4.5 | 8.9 M | 324 KiB | 124 KiB | 0.18 ms | 19 min |
| ternary | 47.2 ± 0.9 | 36.3 ± 0.7 | 44.8 ± 0.9 | 22.8 M | 326 KiB | 198 KiB | 0.23 ms | 22 min |

(Accuracies are percent, mean ± SD over seeds. FLOPs are executed per example. Inference memory is state plus KV cache for one example.)

| check | left | right (threshold) | holds | difference, 95% interval |
|---|---|---|---|---|
| T1_per_byte | ternary:dev.all = 47.2 | >= dense-tiny:dev.all = 38.8 +0.02 → 40.8 | **yes** | +8.4 ± 6.1 |
| T2_near_fp32 | ternary:dev.all = 47.2 | >= dense:dev.all = 44.2 -0.03 → 41.2 | **yes** | +3.0 ± 13.9 (within seed noise) |

**Statistical power:** 3 seeds. On suite v3 the seed SD of dev accuracy is often 4–6 points, so the 95% interval of a difference is often ±9–14 points. A gate that holds on the means but inside that interval is marked *within seed noise* below: the pre-registered decision stands, but it is provisional.

## What was learned

1. **The strongest weight-format result so far, and outside seed noise.**
   - The ternary-MLP model stores 326 KiB and scores 47.2 ± 0.9 dev.
   - The byte-matched fp32 model (dense-tiny, 324 KiB) scores 38.8 ± 2.3: +8.4 ± 6.1.
2. **It is also above the full fp32 model on the means.**
   - Dev: 47.2 vs 44.2 (within noise). OOD: 36.3 ± 0.7 vs 32.7 ± 4.3.
   - Its seed SD is 6× smaller. At this scale, quantisation-aware ternary training acts as a regulariser.
3. **Scope.**
   - Only the MLPs are ternary; attention and embeddings stay fp32. Stored bytes count 2-bit packing.
   - FLOPs are unchanged: ternary matmuls run as fp32 here, and no kernel speed-up is claimed.
4. **Winner for R1.31/R1.32.** Ternary is the first structured-parameter mechanism with independent PASS evidence.
