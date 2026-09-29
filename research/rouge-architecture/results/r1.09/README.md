# R1.09 result: PASS (pre-registered decision)

**Runs:**
- GitHub Actions run `36592861134`, commit `994d448`.
- 3 models × 3 seeds, benchmark v3, 15,000 steps.

**Cost:** $0.

**Question:** does replacing the per-token cell with one gated cross-attention write per token keep capability and recall, at ≤ 1/3 of the FLOPs?

| model | dev | OOD | adversarial | OOD recall | FLOPs / example | latency | train time | state bytes |
|---|---|---|---|---|---|---|---|---|
| transformer | 44.3 ± 5.6 | 32.6 ± 4.2 | 41.7 ± 6.9 | 71.5 ± 35.5 | 23 M | 0.22 ms | 20 min | 198 KiB |
| rouge-mem | 35.3 ± 1.3 | 32.4 ± 1.4 | 31.1 ± 1.5 | 72.7 ± 11.7 | 105 M | 0.83 ms | 97 min | 16 KiB |
| rouge-cheap | 39.9 ± 1.4 | 32.9 ± 2.1 | 35.7 ± 2.1 | 72.5 ± 1.8 | 15 M | 0.26 ms | 38 min | 15 KiB |

| Check | Result |
| --- | --- |
| C1: FLOPs ≤ 0.33× rouge-mem | **yes**: 0.15× |
| C2: dev ≥ rouge-mem − 3 points | **yes**: 39.9 vs 35.3 (+4.6) |
| C3: OOD recall ≥ rouge-mem − 5 points | **yes**: 72.5 ± 1.8 vs 72.7 ± 11.7 |
| C4 (reported): FLOPs ≤ 1.5× the Transformer | **yes**: 15 M vs 23 M |

## What was learned

The cheap read is better on every axis at once:
- 7× fewer FLOPs than the full cell, and fewer than the Transformer;
- 3.2× lower latency and 2.6× faster training;
- +4.6 points dev and +4.6 adversarial;
- the same OOD recall, with 6× smaller seed variance (±1.8 vs ±11.7).

The full cell per token was the expensive part of Rouge (R1.01 lesson 5) and did not pay for itself. **rouge-cheap is the new Rouge memory candidate.**
- It still trails the Transformer on dev accuracy (39.9 vs 44.3).
- It matches it on OOD recall (72.5 ± 1.8 vs 71.5 ± 35.5) with 15 KiB instead of 198 KiB of context memory, and far more stable across seeds.

R1.09b tests the next step: the same read as a parallel scan, for wall-clock speed.
