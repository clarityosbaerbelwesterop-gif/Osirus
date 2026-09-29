# R1.09b result: FAIL (pre-registered decision)

**Parallel-scan state reads: the cheap read as a linear recurrence**

**Run:** GitHub Actions run `36595729731`, commit `0ec2730`.
- 3 models × 3 seeds on free CPU runners (tier 0), 15,000 steps × 64 examples.
- Benchmark: `benchmarks/suite3.py`.
- Full numbers are in `summary.json` and `report.md`.

**Cost:** $0.

**Question:** does the cheap read, rewritten as an exact chunked linear scan (state-independent slot keys, token-only write addresses), keep rouge-cheap's capability while halving latency?

| model | dev | OOD | adversarial | ood.recall | FLOPs / example | stored weights | inference memory | latency | train time |
|---|---|---|---|---|---|---|---|---|---|
| transformer | 44.3 ± 5.6 | 32.6 ± 4.2 | 43.8 ± 7.0 | 72.7 ± 36.7 | 22.8 M | 806 KiB | 198 KiB | 0.26 ms | 25 min |
| rouge-cheap | 39.4 ± 0.9 | 32.5 ± 1.6 | 36.3 ± 3.2 | 69.7 ± 3.8 | 14.7 M | 910 KiB | 15 KiB | 0.33 ms | 43 min |
| rouge-scan | 31.6 ± 0.4 | 26.9 ± 1.3 | 27.3 ± 0.8 | 35.5 ± 18.2 | 12.5 M | 911 KiB | 15 KiB | 0.43 ms | 52 min |

(Accuracies are percent, mean ± SD over seeds. FLOPs are executed per example. Inference memory is state plus KV cache for one example.)

| check | left | right (threshold) | holds | difference, 95% interval |
|---|---|---|---|---|
| P1_latency | rouge-scan:latency_ms = 0.43 ms | <= rouge-cheap:latency_ms = 0.33 ms × 0.5 → 0.16 ms | no |  |
| P2_capability | rouge-scan:dev.all = 31.6 | >= rouge-cheap:dev.all = 39.4 -0.03 → 36.4 | no | -7.8 ± 2.5 |
| P3_recall | rouge-scan:ood.recall = 35.5 | >= rouge-cheap:ood.recall = 69.7 -0.05 → 64.7 | no | -34.2 ± 46.2 |
| P4_vs_transformer_latency | rouge-scan:latency_ms = 0.43 ms | <= transformer:latency_ms = 0.26 ms × 2 → 0.53 ms | **yes** |  |

**Statistical power:** 3 seeds. On suite v3 the seed SD of dev accuracy is often 4–6 points, so the 95% interval of a difference is often ±9–14 points. A gate that holds on the means but inside that interval is marked *within seed noise* below: the pre-registered decision stands, but it is provisional.

## What was learned

1. **It is slower, not faster, at benchmark lengths.** The scan takes 0.43 ms against 0.33 ms for the per-token loop.
   - Suite v3 sequences are short (tens of tokens), so a 32-token chunk means 1–2 chunks.
   - The fixed cost of the scan (flips, cumulative products, two recurrences) outweighs the Python steps it saves.
   - The long-sequence gain measured untrained in R1.24/R1.09b (96k vs 12k tokens/s at 1024 tokens) is real but not what this scorecard measures.
2. **It loses capability, and the loss is outside seed noise.**
   - Dev drops 7.8 ± 2.5 points; OOD recall falls from 69.7 to 35.5.
   - Making the slot keys independent of the state removes what made the cheap read work: the read depends on what the state already holds.
3. **Decision:** rouge-cheap (state-dependent read, R1.09) stays the memory candidate. The scan form is rejected as a replacement.
   - It may return only as a long-context inference path, and only if it can be trained to match rouge-cheap. That is not scheduled.
