# R1.11 result: PASS (pre-registered decision)

**Local exact window + persistent state**

**Run:** GitHub Actions run `36592868065`, commit `994d448`.
- 4 models × 3 seeds on free CPU runners (tier 0), 15,000 steps × 64 examples.
- Benchmark: `benchmarks/suite3.py`.
- Full numbers are in `summary.json` and `report.md`.

**Cost:** $0.

**Question:** does an exact window of the last 16 or 32 token embeddings, read at every think step, add local exactness to rouge-mem at a small constant memory?

| model | dev | OOD | adversarial | ood.recall | FLOPs / example | stored weights | inference memory | latency | train time |
|---|---|---|---|---|---|---|---|---|---|
| transformer | 44.3 ± 5.6 | 32.4 ± 4.1 | 42.4 ± 7.3 | 72.2 ± 36.3 | 22.8 M | 806 KiB | 198 KiB | 0.23 ms | 23 min |
| rouge-mem | 34.6 ± 0.9 | 31.8 ± 0.4 | 32.8 ± 1.8 | 67.0 ± 13.9 | 104.6 M | 901 KiB | 16 KiB | 1.05 ms | 114 min |
| rouge-win16 | 38.0 ± 2.0 | 31.1 ± 3.6 | 35.4 ± 0.7 | 73.3 ± 7.0 | 91.1 M | 910 KiB | 28 KiB | 0.99 ms | 110 min |
| rouge-win32 | 37.5 ± 1.0 | 32.3 ± 2.0 | 34.3 ± 1.8 | 63.8 ± 3.1 | 91.8 M | 910 KiB | 41 KiB | 0.96 ms | 109 min |

(Accuracies are percent, mean ± SD over seeds. FLOPs are executed per example. Inference memory is state plus KV cache for one example.)

| check | left | right (threshold) | holds | difference, 95% interval |
|---|---|---|---|---|
| W1_capability | rouge-win16:dev.all = 38.0 | >= rouge-mem:dev.all = 34.6 +0.02 → 36.6 | **yes** | +3.4 ± 5.4 (within seed noise) |
| W2_recall | rouge-win16:ood.recall = 73.3 | >= rouge-mem:ood.recall = 67.0 +0.05 → 72.0 | **yes** | +6.3 ± 38.7 (within seed noise) |
| W3_memory | rouge-win16:total_bytes = 28 KiB | <= transformer:total_bytes = 198 KiB × 0.25 → 50 KiB | **yes** |  |
| W4_bigger_window | rouge-win32:dev.all = 37.5 | >= rouge-win16:dev.all = 38.0 → 38.0 | no | -0.5 ± 4.1 |

**Statistical power:** 3 seeds. On suite v3 the seed SD of dev accuracy is often 4–6 points, so the 95% interval of a difference is often ±9–14 points. A gate that holds on the means but inside that interval is marked *within seed noise* below: the pre-registered decision stands, but it is provisional.

## What was learned

1. **The 16-token window helps on the means, at 28 KiB of inference memory.**
   - Dev +3.4 and OOD recall +6.3, both within seed noise.
   - The Transformer needs 198 KiB for the same inputs.
2. **A bigger window does not help:** 32 tokens gives 37.5 vs 38.0 (W4).
3. **The Rouge family still trails the Transformer on dev accuracy:** 38.0 vs 44.3.
4. These models use the full per-token cell (91–105 M FLOPs). The window has not yet been combined with the cheap read of R1.09 (15 M FLOPs).
   - That combination is the memory configuration carried into R1.14.
