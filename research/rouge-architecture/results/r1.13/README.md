# R1.13 result: FAIL (pre-registered decision)

**Learned forgetting: overwrite the key's own slot, allocate new keys to stale slots**

**Run:** GitHub Actions run `36592875762`, commit `994d448`.
- 3 models × 3 seeds on free CPU runners (tier 0), 10,000 steps × 64 examples.
- Benchmark: `benchmarks/streams.py`.
- Full numbers are in `summary.json` and `report.md`.

**Cost:** $0.

**Question:** does usage-based allocation (overwrite the key's own slot, give new keys the least recently used slot) reduce interference and saturation in rouge-mem's exact memory?

| model | dev | OOD | adversarial | ood.retain | ood.overwrite | ood.saturate | FLOPs / example | stored weights | inference memory | latency | train time |
|---|---|---|---|---|---|---|---|---|---|---|---|
| transformer-w32 | 43.1 ± 13.6 | 14.0 ± 1.9 | 34.0 ± 15.6 | 11.0 ± 1.8 | 13.7 ± 6.0 | 17.3 ± 2.8 | 42.1 M | 806 KiB | 64 KiB | 0.65 ms | 31 min |
| rouge-mem | 52.3 ± 25.5 | 36.4 ± 26.2 | 47.0 ± 28.4 | 40.2 ± 28.9 | 38.8 ± 37.4 | 30.2 ± 16.1 | 176.2 M | 901 KiB | 16 KiB | 2.65 ms | 138 min |
| rouge-forget | 29.4 ± 0.4 | 19.1 ± 1.4 | 22.4 ± 1.1 | 31.8 ± 4.5 | 6.3 ± 1.0 | 19.0 ± 0.5 | 176.5 M | 951 KiB | 16 KiB | 1.98 ms | 124 min |

(Accuracies are percent, mean ± SD over seeds. FLOPs are executed per example. Inference memory is state plus KV cache for one example.)

| check | left | right (threshold) | holds | difference, 95% interval |
|---|---|---|---|---|
| F1_overwrite | rouge-forget:ood.overwrite = 6.3 | >= rouge-mem:ood.overwrite = 38.8 +0.05 → 43.8 | no | -32.5 ± 93.0 |
| F2_saturate | rouge-forget:ood.saturate = 19.0 | >= rouge-mem:ood.saturate = 30.2 +0.05 → 35.2 | no | -11.2 ± 39.9 |
| F3_retain_kept | rouge-forget:ood.retain = 31.8 | >= rouge-mem:ood.retain = 40.2 -0.03 → 37.2 | no | -8.3 ± 72.7 |

**Statistical power:** 3 seeds. On suite v3 the seed SD of dev accuracy is often 4–6 points, so the 95% interval of a difference is often ±9–14 points. A gate that holds on the means but inside that interval is marked *within seed noise* below: the pre-registered decision stands, but it is provisional.

## What was learned

1. **Usage-based allocation made every stream task worse:**
   - overwrite: 6.3 vs 38.8;
   - saturate: 19.0 vs 30.2;
   - retain: 31.8 vs 40.2;
   - dev: 29.4 vs 52.3.
   The large seed variance of rouge-mem puts the intervals wide, but no seed of rouge-forget reaches the good rouge-mem seed.
2. **Reproducibility check passed.** rouge-mem here uses the same config and seeds as in R1.12 and reproduces its dev and OOD numbers exactly: CPU training is deterministic.
   - The adversarial split differs, because it is rebuilt per experiment.
3. **The hand-made least-recently-used heuristic is rejected.**
   - A learned forget gate per slot (as in the LSTM, which retains perfectly in R1.12) is the untested alternative. It is part of the R1.14 configuration, not a separate tuning loop.
