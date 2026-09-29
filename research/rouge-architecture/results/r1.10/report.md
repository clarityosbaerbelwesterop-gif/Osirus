# Rouge scorecard: R1.10

Mean ± SD over seeds (95% CIs in summary.json). Accuracy in %.

## Capability

| | transformer | slots8 | slots16 | slots32 | slots64 |
|---|---|---|---|---|---|
| **dev all** | 44.8 ± 4.7 | 36.2 ± 3.5 | 36.4 ± 3.1 | 34.6 ± 0.9 | 38.4 ± 3.3 |
| **holdout all** | 44.9 ± 4.6 | 36.3 ± 3.2 | 36.8 ± 3.8 | 34.7 ± 1.0 | 38.3 ± 3.5 |
| **ood all** | 32.8 ± 3.5 | 31.2 ± 3.7 | 32.9 ± 3.8 | 31.8 ± 0.4 | 34.3 ± 2.5 |
| **adv all** | 42.9 ± 7.2 | 33.6 ± 4.8 | 33.9 ± 3.5 | 32.7 ± 0.8 | 36.4 ± 3.6 |
| state: dev / ood (cue floor 15) | 15 / 18 | 15 / 17 | 17 / 16 | 16 / 15 | 16 / 16 |
| recall: dev / ood (cue floor 33) | 85 / 71 | 68 / 46 | 80 / 62 | 90 / 67 | 93 / 72 |
| hops: dev / ood (cue floor 54) | 46 / 53 | 48 / 53 | 46 / 51 | 46 / 54 | 48 / 52 |
| perm: dev / ood (cue floor 24) | 48 / 18 | 30 / 21 | 23 / 22 | 20 / 22 | 22 / 22 |
| conn: dev / ood (cue floor 50) | 48 / 50 | 53 / 50 | 52 / 47 | 48 / 47 | 50 / 49 |
| arith: dev / ood (cue floor 10) | 12 / 10 | 9 / 11 | 11 / 13 | 9 / 12 | 10 / 11 |
| binding: dev / ood (cue floor 28) | 67 / 46 | 50 / 47 | 62 / 60 | 61 / 57 | 71 / 64 |
| stack: dev / ood (cue floor 29) | 93 / 31 | 63 / 44 | 47 / 34 | 23 / 20 | 44 / 30 |
| trace: dev / ood (cue floor 15) | 36 / 30 | 19 / 18 | 19 / 18 | 22 / 19 | 24 / 22 |
| cf: dev / ood (cue floor 19) | 13 / 16 | 11 / 18 | 12 / 19 | 14 / 20 | 12 / 19 |
| plan: dev / ood (cue floor 23) | 30 / 18 | 31 / 18 | 33 / 20 | 32 / 18 | 33 / 20 |

## Cost

| | transformer | slots8 | slots16 | slots32 | slots64 |
|---|---|---|---|---|---|
| parameters (physical) | 206,256 | 227,979 | 228,883 | 230,691 | 234,307 |
| parameters (active) | 206,256 | 227,979 | 228,883 | 230,691 | 234,307 |
| stored weight bytes | 806 KiB | 891 KiB | 894 KiB | 901 KiB | 915 KiB |
| inference FLOPs / example | 22.8 M | 104.3 M | 104.4 M | 104.6 M | 105.1 M |
| training FLOPs (3x fwd x examples) | 6.57e+13 | 3.00e+14 | 3.01e+14 | 3.01e+14 | 3.03e+14 |
| persistent state bytes | 0.0 KiB | 5.2 KiB | 8.8 KiB | 15.8 KiB | 29.8 KiB |
| KV / context bytes (longest OOD input) | 198.0 KiB | 0.0 KiB | 0.0 KiB | 0.0 KiB | 0.0 KiB |
| peak RAM (process RSS, incl. torch) | 474 MB | 560 MB | 569 MB | 631 MB | 747 MB |
| latency / example (CPU) | 0.16 ms | 0.93 ms | 1.02 ms | 1.00 ms | 0.97 ms |
| training time | 14.5 min | 107.3 min | 110.4 min | 109.9 min | 98.1 min |
| energy proxy (CPU-core-seconds) | 3476 | 25761 | 26497 | 26376 | 23532 |
| sample efficiency (mean probe accuracy) | 35.8 | 30.6 | 31.0 | 31.4 | 32.9 |

## Decision

`{"complete": true, "checks": {"S1_16_gt_8": true, "S2_32_gt_16": true, "S3a_64_saturates_hi": false, "S3b_64_saturates_lo": true}, "result": "PARTIAL"}`
