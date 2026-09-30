# Rouge LM scorecard: R1.14b

Data: enwik8 (sha256 2b49720ec4d7). Bits per byte, mean ± SD over seeds (95% CIs in summary.json); lower is better.

Floors on validation bytes: unigram 4.896, order-3 byte n-gram 3.153 BPB.

## Quality

| | transformer | rouge-lm | rouge-mem-lm |
|---|---|---|---|
| valid.bpb | 1.722 ± 0.031 | 1.960 ± 0.024 | 2.108 ± 0.090 |
| test.bpb | 1.771 ± 0.041 | 2.017 ± 0.052 | 2.151 ± 0.092 |
| stream.all | 1.604 ± 0.065 | 1.654 ± 0.054 | 1.677 ± 0.036 |
| stream.b0_0_256 | 1.604 ± 0.044 | 1.859 ± 0.054 | 2.002 ± 0.107 |
| stream.b1_256_1k | 1.586 ± 0.068 | 1.627 ± 0.060 | 1.656 ± 0.037 |
| stream.b2_1k_4k | 1.608 ± 0.067 | 1.644 ± 0.053 | 1.655 ± 0.035 |

## Cost

| | transformer | rouge-lm | rouge-mem-lm |
|---|---|---|---|
| parameters | 9,946,240 | 10,208,160 | 10,208,433 |
| stored weight bytes | 38852 KiB | 39876 KiB | 39877 KiB |
| inference FLOPs / byte | 19.82 M | 15.82 M | 16.52 M |
| training bytes | 32,768,000 | 32,768,000 | 32,768,000 |
| training FLOPs (3x fwd x bytes) | 1.95e+15 | 1.56e+15 | 1.62e+15 |
| inference memory, stream eval (state + KV) | 5120 KiB | 1224 KiB | 2312 KiB |
| memory if the full 4k context were kept | 81920 KiB | 1224 KiB | 2312 KiB |
| stream throughput (CPU, batch 16) | 3662 B/s | 8550 B/s | 7992 B/s |
| peak RAM (process RSS, incl. torch) | 1688 MB | 1899 MB | 2178 MB |
| training time | 246 min | 215 min | 218 min |
| energy proxy (CPU-core-seconds) | 58948 | 51499 | 52208 |

## Decision

`{"complete": true, "checks": {"M1_far_context": false, "M2_no_loss": false, "M3_far_vs_transformer": false, "M4_memory": true}, "result": "FAIL"}`
