# R1.16 result: FAIL (pre-registered decision)

**Long context 4k–128k bytes on the trained R1.14 models.** No new training: the report job of run `36649205043` (code `3a7fabc`) evaluated the 12 R1.14 checkpoints (4 models × 3 seeds).

**Cost:** $0.

**Measured:**
- test streams of 4 × 65,536 bytes, reported as BPB by distance from the start;
- a copy probe: a random 32-byte string repeated 128 / 1k / 4k / 16k bytes later. The gain is bits per byte on the first occurrence minus bits per byte on the second;
- memory and throughput at 4k–128k bytes, batch 1.

| metric | transformer | rouge-lm | window | lstm |
|---|---|---|---|---|
| stream.b0_0_256 | 1.914 ± 0.063 | 2.228 ± 0.038 | 2.036 ± 0.017 | 2.045 ± 0.020 |
| stream.b1_256_1k | 1.669 ± 0.065 | 1.729 ± 0.063 | 1.647 ± 0.015 | 1.846 ± 0.007 |
| stream.b2_1k_4k | 1.631 ± 0.043 | 1.671 ± 0.035 | 1.627 ± 0.015 | 1.733 ± 0.006 |
| stream.b3_4k_16k | 1.684 ± 0.043 | 1.708 ± 0.034 | 1.668 ± 0.005 | 1.787 ± 0.003 |
| stream.b4_16k_64k | 1.720 ± 0.033 | 1.744 ± 0.037 | 1.705 ± 0.011 | 1.822 ± 0.003 |
| copy.128.gain | 1.040 ± 0.316 | 0.051 ± 0.045 | -0.018 ± 0.071 | 0.261 ± 0.198 |
| copy.128.second_bpb | 8.467 ± 0.686 | 9.213 ± 0.322 | 9.196 ± 0.301 | 8.973 ± 0.123 |
| copy.1024.gain | -0.089 ± 0.091 | -0.051 ± 0.009 | -0.162 ± 0.051 | 0.019 ± 0.057 |
| copy.1024.second_bpb | 9.313 ± 0.400 | 9.362 ± 0.245 | 9.369 ± 0.182 | 9.060 ± 0.213 |
| copy.4096.gain | -0.099 ± 0.079 | -0.144 ± 0.089 | -0.184 ± 0.090 | -0.137 ± 0.048 |
| copy.4096.second_bpb | 9.282 ± 0.257 | 9.233 ± 0.313 | 9.126 ± 0.254 | 9.150 ± 0.099 |
| copy.16384.gain | -0.019 ± 0.036 | -0.067 ± 0.030 | -0.133 ± 0.135 | 0.121 ± 0.023 |
| copy.16384.second_bpb | 9.221 ± 0.308 | 9.128 ± 0.257 | 9.073 ± 0.185 | 9.034 ± 0.162 |
| throughput.4096 | 2238 B/s | 2884 B/s | 2830 B/s | 4030 B/s |
| memory.4096 | 5120 KiB | 1224 KiB | 1280 KiB | 12 KiB |
| memory_full.4096 | 81920 KiB | 1224 KiB | 1280 KiB | 12 KiB |
| throughput.16384 | 2139 B/s | 2894 B/s | 2845 B/s | 4015 B/s |
| memory.16384 | 5120 KiB | 1224 KiB | 1280 KiB | 12 KiB |
| memory_full.16384 | 327680 KiB | 1224 KiB | 1280 KiB | 12 KiB |
| throughput.65536 | 2151 B/s | 2869 B/s | 2886 B/s | 4074 B/s |
| memory.65536 | 5120 KiB | 1224 KiB | 1280 KiB | 12 KiB |
| memory_full.65536 | 1310720 KiB | 1224 KiB | 1280 KiB | 12 KiB |
| throughput.131072 | 2185 B/s | 2876 B/s | 2839 B/s | 4022 B/s |
| memory.131072 | 5120 KiB | 1224 KiB | 1280 KiB | 12 KiB |
| memory_full.131072 | 2621440 KiB | 1224 KiB | 1280 KiB | 12 KiB |

| check | result |
|---|---|
| C5 probe sanity: the Transformer copies inside its window (gain ≥ 1.0) | holds (1.040 ± 0.316), so the probe is valid, not VOID |
| C1 Rouge-LM copies over 1k bytes (gain ≥ 0.5) | no: −0.051 |
| C1b better than the window model at 1k | no |
| C2 no drift far out (16k–64k ≤ 1k–4k + 0.02) | no: 1.744 vs 1.671 |
| C3 Rouge-LM ≥ 0.02 better than the Transformer at 16k–64k | no: 1.744 vs 1.720 |
| C4 memory at 128k ≤ 1% of a full-context KV cache | yes: 1.2 MiB vs 2.5 GiB (analytic) |

## What was learned

1. **No model carries an exact string beyond its window.**
   - Copy gain at 1k, 4k and 16k is at most noise (−0.18 to +0.12) for every model.
   - Only the Transformer copies inside its 256-byte window (1.04 bits/byte at 128).
   - Rouge-LM's 16 gated slots do not store exact content, as pre-registered in the prediction for C1.
2. **C2's failure is not evidence of recurrent drift.**
   - BPB rises far into the streams for every model, including the stateless sliding-window Transformer (1.631 → 1.720).
   - With 4 streams, the distance buckets are confounded with how hard the text is at those offsets.
   - The gate is recorded as written. The honest reading is that stability cannot be judged from this probe.
3. **Rouge-LM stays behind the Transformer at every distance up to 64k** (1.744 vs 1.720 far out). The window model is the best stream model at every distance beyond 256 bytes (1.705 far out), at 1.25 MiB of memory.
4. **Constant memory is real:**
   - 1.2 MiB at any length, against 2.5 GiB for a full-context KV cache at 128k;
   - throughput is flat from 4k to 128k (about 2.9k bytes/s, CPU, batch 1);
   - but that memory holds no retrievable content.

**Consequence for Rouge Architecture v1:** long context needs an exact, retrievable store (attention over a longer window, or sparse retrieval over cached keys), not a compressed state. Any memory mechanism must beat the window baseline on the copy probe, not only on BPB.
