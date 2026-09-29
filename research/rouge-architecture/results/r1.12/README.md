# R1.12 result: PASS (pre-registered decision)

**Streaming state: facts across long streams without replay**

**Run:** GitHub Actions run `36592872133`, commit `994d448`.
- 5 models × 3 seeds on free CPU runners (tier 0), 10,000 steps × 64 examples.
- Benchmark: `benchmarks/streams.py`.
- Full numbers are in `summary.json` and `report.md`.

**Cost:** $0.

**Question:** reading a stream once, does rouge-mem keep facts over long distances (up to 80 statements after the write, 3× the training length) better than a Transformer with a 32-token window, at no more memory?

| model | dev | OOD | adversarial | ood.retain | ood.overwrite | ood.saturate | FLOPs / example | stored weights | inference memory | latency | train time |
|---|---|---|---|---|---|---|---|---|---|---|---|
| transformer-full | 34.9 ± 1.1 | 15.2 ± 1.8 | 32.0 ± 1.5 | 20.8 ± 4.5 | 6.5 ± 0.5 | 18.2 ± 1.3 | 42.1 M | 806 KiB | 710 KiB | 0.58 ms | 26 min |
| transformer-w32 | 42.2 ± 14.3 | 14.2 ± 1.7 | 39.6 ± 14.2 | 11.5 ± 1.7 | 13.5 ± 6.1 | 17.7 ± 2.9 | 42.1 M | 806 KiB | 64 KiB | 0.66 ms | 30 min |
| lstm | 54.4 ± 0.8 | 40.7 ± 0.0 | 50.7 ± 0.7 | 100.0 ± 0.0 | 7.8 ± 0.3 | 14.2 ± 0.3 | 21.7 M | 834 KiB | 2 KiB | 0.23 ms | 10 min |
| ssm | 25.9 ± 1.4 | 19.7 ± 1.1 | 24.2 ± 2.2 | 11.7 ± 1.4 | 33.5 ± 1.3 | 13.8 ± 3.0 | 39.9 M | 805 KiB | 26 KiB | 1.28 ms | 98 min |
| rouge-mem | 52.3 ± 25.5 | 36.4 ± 26.2 | 48.2 ± 24.6 | 40.2 ± 28.9 | 38.8 ± 37.4 | 30.2 ± 16.1 | 176.2 M | 901 KiB | 16 KiB | 2.35 ms | 136 min |

(Accuracies are percent, mean ± SD over seeds. FLOPs are executed per example. Inference memory is state plus KV cache for one example.)

| check | left | right (threshold) | holds | difference, 95% interval |
|---|---|---|---|---|
| T1_retain_vs_window | rouge-mem:ood.retain = 40.2 | >= transformer-w32:ood.retain = 11.5 +0.1 → 21.5 | **yes** | +28.7 ± 72.0 (within seed noise) |
| T2_memory | rouge-mem:total_bytes = 16 KiB | <= transformer-w32:total_bytes = 64 KiB → 64 KiB | **yes** |  |
| T3_vs_lstm | rouge-mem:ood.retain = 40.2 | >= lstm:ood.retain = 100.0 +0.1 → 110.0 | no | -59.8 ± 71.9 |
| T4_vs_full | rouge-mem:ood.retain = 40.2 | >= transformer-full:ood.retain = 20.8 -0.05 → 15.8 | **yes** | +19.3 ± 72.7 (within seed noise) |

**Statistical power:** 3 seeds. On suite v3 the seed SD of dev accuracy is often 4–6 points, so the 95% interval of a difference is often ±9–14 points. A gate that holds on the means but inside that interval is marked *within seed noise* below: the pre-registered decision stands, but it is provisional.

## What was learned

1. **The gate holds on the means, but rouge-mem is unstable across seeds.** Per seed:

   | metric | seed 1 | seed 2 | seed 3 |
   |---|---|---|---|
   | OOD retain | 33.0 | 72.0 | 15.5 |
   | OOD overwrite | 5.0 | 79.0 | 32.5 |

   One seed learns a working streaming memory; two do not. T1 is therefore within seed noise.
2. **The LSTM solves pure retention perfectly:** 100.0 ± 0.0 OOD retain, with a 2 KiB state and 10 minutes of training.
   - A gated vector state is exactly the right tool for "hold one fact across distractors".
   - The LSTM fails overwrite (7.8), where the right answer is the *latest* value.
3. **The full-context Transformer does not extrapolate to 3× the training length** (20.8 OOD retain), despite unbounded memory.
4. **Seed stability is now the main open problem of Rouge memory** (it was already open in R1.03).
   - Two candidates: the cheap read, which had 6× smaller seed variance in R1.09, and an LSTM-style gate in the state update. Both go into R1.14's configuration.
