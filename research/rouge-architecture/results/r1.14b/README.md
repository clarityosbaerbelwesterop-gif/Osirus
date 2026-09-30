# R1.14b result: FAIL (pre-registered decision)

**Rouge-LM with an exact addressable memory (R1.03's second level) on enwik8**

**Run:** GitHub Actions run `36650325883`, commit `e4b79b2`.
- 3 models × 3 seeds on free CPU runners (tier 0).
- 8,000 steps × 16 streams × 256 bytes.
- Full numbers are in `summary.json` and `report.md`.

**Cost:** $0.

**Question:** does adding a small exact memory to Rouge-LM (one layer; the 8 highest-scoring bytes of each 64-byte block write their keys and values into a ring of 512 entries; every byte reads its top 8 entries per head) improve prediction far into long streams, at equal parameters and training bytes?

| model | valid BPB | test BPB | stream.b0_0_256 | stream.b1_256_1k | stream.b2_1k_4k | FLOPs / byte | stored weights | inference memory | stream throughput | train time |
|---|---|---|---|---|---|---|---|---|---|---|
| transformer | 1.722 ± 0.031 | 1.771 ± 0.041 | 1.604 ± 0.044 | 1.586 ± 0.068 | 1.608 ± 0.067 | 19.8 M | 38852 KiB | 5120 KiB | 3,662 B/s | 246 min |
| rouge-lm | 1.960 ± 0.024 | 2.017 ± 0.052 | 1.859 ± 0.054 | 1.627 ± 0.060 | 1.644 ± 0.053 | 15.8 M | 39876 KiB | 1224 KiB | 8,550 B/s | 215 min |
| rouge-mem-lm | 2.108 ± 0.090 | 2.151 ± 0.092 | 2.002 ± 0.107 | 1.656 ± 0.037 | 1.655 ± 0.035 | 16.5 M | 39877 KiB | 2312 KiB | 7,992 B/s | 218 min |

(Bits per byte, mean ± SD over seeds; lower is better. Inference memory is state plus KV cache for the stream evaluation.)

| check | left | right (threshold) | holds | difference, 95% interval |
|---|---|---|---|---|
| M1_far_context | rouge-mem-lm:stream.b2_1k_4k = 1.655 | <= rouge-lm:stream.b2_1k_4k = 1.644 -0.02 → 1.624 ± 0.000 | no | +0.011 ± 0.118 |
| M2_no_loss | rouge-mem-lm:valid.bpb = 2.108 | <= rouge-lm:valid.bpb = 1.960 +0.005 → 1.965 ± 0.000 | no | +0.149 ± 0.231 |
| M3_far_vs_transformer | rouge-mem-lm:stream.b2_1k_4k = 1.655 | <= transformer:stream.b2_1k_4k = 1.608 -0.02 → 1.588 ± 0.000 | no | +0.047 ± 0.139 |
| M4_memory | rouge-mem-lm:total_bytes = 2312 KiB | <= transformer:total_bytes = 5120 KiB × 0.5 → 2560 KiB | **yes** |  |

**Statistical power:** 3 seeds each. Seed-to-seed spread differs a lot between models: the window model varies by ±0.005 BPB, the Transformer and Rouge-LM by ±0.05–0.07 on long streams. Differences under about 0.1 BPB between the high-variance models are within seed noise; each check shows its interval.

**Data and budget:** as in R1.14, with the same training bytes and seeds. transformer and rouge-lm repeat R1.14's configurations. Their numbers agree with R1.14 within 0.005 BPB on every seed average (valid 1.722 vs 1.721; 1.960 vs 1.962), so the replication holds.

## What was learned

1. **The exact memory makes Rouge-LM worse, not better:**
   - fresh segments: 2.108 vs 1.960;
   - bytes 0–256: 2.002 vs 1.859;
   - bytes 1k–4k: 1.655 vs 1.644.
   It also stays behind the Transformer far out (1.655 vs 1.608).
2. **The memory does what it was built to do mechanically, but it does not pay.**
   - Writes are selected, reads are sparse, streaming is exact (unit tests), and inference memory is 2.3 MiB, constant in length (M4 holds).
   - With next-byte loss alone, the write head does not find bytes whose exact recall lowers the loss enough to repay the extra read path.
3. **R1.03's two-level memory does not transfer to real text at 10M.** R1.03 tripled exact recall on synthetic recall tasks; on enwik8 neither the gated slots (R1.14) nor the exact memory (R1.14b) beats a plain sliding window with a cached block.
4. **What would be needed to test it again:**
   - a training signal that rewards long-range exact recall, or
   - data where it dominates the loss (for example R1.16's copy probe as an auxiliary task).
   Either one is a different experiment and needs its own pre-registration. It is not a rescue of this one.
