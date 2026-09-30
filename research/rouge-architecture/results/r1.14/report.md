# Rouge LM scorecard: R1.14

Data: enwik8 (sha256 2b49720ec4d7). Bits per byte, mean ± SD over seeds (95% CIs in summary.json); lower is better.

Floors on validation bytes: unigram 4.896, order-3 byte n-gram 3.153 BPB.

## Quality

| | transformer | rouge-lm | window | lstm |
|---|---|---|---|---|
| valid.bpb | 1.729 ± 0.037 | 1.962 ± 0.024 | 1.801 ± 0.005 | 1.834 ± 0.004 |
| test.bpb | 1.777 ± 0.045 | 2.019 ± 0.053 | 1.844 ± 0.014 | 1.915 ± 0.003 |
| stream.all | 1.627 ± 0.065 | 1.655 ± 0.054 | 1.592 ± 0.001 | 1.746 ± 0.017 |
| stream.b0_0_256 | 1.626 ± 0.036 | 1.866 ± 0.052 | 1.688 ± 0.004 | 1.719 ± 0.031 |
| stream.b1_256_1k | 1.615 ± 0.061 | 1.629 ± 0.061 | 1.563 ± 0.003 | 1.742 ± 0.024 |
| stream.b2_1k_4k | 1.630 ± 0.069 | 1.644 ± 0.053 | 1.591 ± 0.000 | 1.749 ± 0.015 |

## Cost

| | transformer | rouge-lm | window | lstm |
|---|---|---|---|---|
| parameters | 9,946,240 | 10,208,160 | 9,946,240 | 10,049,312 |
| stored weight bytes | 38852 KiB | 39876 KiB | 38852 KiB | 39255 KiB |
| inference FLOPs / byte | 19.82 M | 15.82 M | 19.82 M | 20.07 M |
| training bytes | 32,768,000 | 32,768,000 | 32,768,000 | 32,768,000 |
| training FLOPs (3x fwd x bytes) | 1.95e+15 | 1.56e+15 | 1.95e+15 | 1.97e+15 |
| inference memory, stream eval (state + KV) | 5120 KiB | 1224 KiB | 1280 KiB | 12 KiB |
| memory if the full 4k context were kept | 81920 KiB | 1224 KiB | 1280 KiB | 12 KiB |
| stream throughput (CPU, batch 16) | 4844 B/s | 5878 B/s | 5781 B/s | 8864 B/s |
| peak RAM (process RSS, incl. torch) | 1698 MB | 1904 MB | 1825 MB | 971 MB |
| training time | 218 min | 273 min | 283 min | 189 min |
| energy proxy (CPU-core-seconds) | 52232 | 65580 | 67935 | 45466 |

## Decision

`{"complete": true, "checks": {"L1_parity": false, "L2_state_helps": false, "L3_long_context": false, "L4_memory": true, "L5_vs_lstm": false}, "result": "FAIL"}`
