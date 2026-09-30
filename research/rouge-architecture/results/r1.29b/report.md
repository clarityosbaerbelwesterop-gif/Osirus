# Rouge LM scorecard: R1.29b

Data: enwik8 (sha256 2b49720ec4d7). Bits per byte, mean ± SD over seeds (95% CIs in summary.json); lower is better.

Floors on validation bytes: unigram 4.896, order-3 byte n-gram 3.153 BPB.

## Quality

| | transformer | transformer-ternary | transformer-d200 | window-ternary |
|---|---|---|---|---|
| valid.bpb | 1.721 ± 0.029 | 1.733 ± 0.010 | 1.786 ± 0.027 | 1.847 ± 0.012 |
| test.bpb | 1.769 ± 0.035 | 1.764 ± 0.008 | 1.841 ± 0.034 | 1.887 ± 0.017 |
| stream.all | 1.602 ± 0.063 | 1.572 ± 0.022 | 1.690 ± 0.066 | 1.617 ± 0.006 |
| stream.b0_0_256 | 1.606 ± 0.043 | 1.603 ± 0.020 | 1.683 ± 0.051 | 1.710 ± 0.016 |
| stream.b1_256_1k | 1.586 ± 0.067 | 1.547 ± 0.023 | 1.668 ± 0.064 | 1.586 ± 0.003 |
| stream.b2_1k_4k | 1.606 ± 0.064 | 1.575 ± 0.023 | 1.696 ± 0.068 | 1.617 ± 0.007 |

## Cost

| | transformer | transformer-ternary | transformer-d200 | window-ternary |
|---|---|---|---|---|
| parameters | 9,946,240 | 9,946,240 | 3,912,400 | 9,946,240 |
| stored weight bytes | 38852 KiB | 14853 KiB | 15283 KiB | 14853 KiB |
| inference FLOPs / byte | 19.82 M | 19.82 M | 7.78 M | 19.82 M |
| training bytes | 32,768,000 | 32,768,000 | 32,768,000 | 32,768,000 |
| training FLOPs (3x fwd x bytes) | 1.95e+15 | 1.95e+15 | 7.65e+14 | 1.95e+15 |
| inference memory, stream eval (state + KV) | 5120 KiB | 5120 KiB | 3200 KiB | 1280 KiB |
| memory if the full 4k context were kept | 81920 KiB | 81920 KiB | 51200 KiB | 1280 KiB |
| stream throughput (CPU, batch 16) | 4167 B/s | 3266 B/s | 6389 B/s | 7388 B/s |
| peak RAM (process RSS, incl. torch) | 1679 MB | 1695 MB | 1180 MB | 1878 MB |
| training time | 246 min | 272 min | 133 min | 237 min |
| energy proxy (CPU-core-seconds) | 58990 | 65320 | 32001 | 56814 |

## Decision

`{"complete": true, "checks": {"T1_per_byte": true, "T2_near_fp32": true, "T3_combination_far": false, "T4_bytes": true}, "result": "PASS"}`
