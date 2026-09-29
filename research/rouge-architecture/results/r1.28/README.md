# R1.28 result: PARTIAL (pre-registered decision)

**Implicit weight fields: W[o, i] = f(phi(o), phi(i))**

**Run:** GitHub Actions run `36595766728`, commit `0ec2730`.
- 2 models × 3 seeds on free CPU runners (tier 0), 15,000 steps × 64 examples.
- Benchmark: `benchmarks/suite3.py`.
- Full numbers are in `summary.json` and `report.md`.

**Cost:** $0.

**Question:** can a small coordinate network that generates the MLP weights match a byte-matched dense model, and what does decoding cost?

| model | dev | OOD | adversarial | FLOPs / example | stored weights | inference memory | latency | train time |
|---|---|---|---|---|---|---|---|---|
| dense-tiny | 38.8 ± 2.3 | 30.0 ± 2.5 | 32.5 ± 4.6 | 8.9 M | 324 KiB | 124 KiB | 0.17 ms | 18 min |
| field | 45.1 ± 3.8 | 32.4 ± 2.6 | 42.0 ± 4.5 | 35.2 M | 361 KiB | 198 KiB | 0.32 ms | 37 min |

(Accuracies are percent, mean ± SD over seeds. FLOPs are executed per example. Inference memory is state plus KV cache for one example.)

| check | left | right (threshold) | holds | difference, 95% interval |
|---|---|---|---|---|
| F1 | field:dev.all = 45.1 | >= dense-tiny:dev.all = 38.8 +0.02 → 40.8 | **yes** | +6.3 ± 8.2 (within seed noise) |
| F2 | field:dev.all = 45.1 | >= dense-tiny:dev.all = 38.8 -0.02 → 36.8 | **yes** | +6.3 ± 8.2 |
| F3_decode_cost | field:flops = 35.2 M | <= dense-tiny:flops = 8.9 M × 2 → 17.8 M | no |  |

**Statistical power:** 3 seeds. On suite v3 the seed SD of dev accuracy is often 4–6 points, so the 95% interval of a difference is often ±9–14 points. A gate that holds on the means but inside that interval is marked *within seed noise* below: the pre-registered decision stands, but it is provisional.

## What was learned

1. **Quality is good per stored byte.** The weight field (361 KiB) reaches 45.1 dev, against 38.8 for dense-tiny (324 KiB): +6.3 ± 8.2, within seed noise. That is as good as the full 806 KiB dense model.
2. **Decoding dominates, so F3 fails.** The field costs 35.2 M FLOPs per example, 4× dense-tiny. The brief says to reject if decoding dominates: **rejected as a runtime format.**
3. **It remains a storage format.** The weights can be decoded once and cached.
   - Runtime then equals the dense d=64 model: 22.8 M FLOPs and 806 KiB of RAM.
   - The gain is a 2.2× smaller download, not a smaller or faster model in memory.
