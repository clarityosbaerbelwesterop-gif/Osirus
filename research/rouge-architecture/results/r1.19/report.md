# Rouge scorecard: R1.19

Mean ± SD over seeds (95% CIs in summary.json). Accuracy in %.

## Capability

| | transformer | moe-token | moe-context |
|---|---|---|---|
| **dev all** | 44.3 ± 5.6 | 40.9 ± 3.1 | 41.7 ± 5.7 |
| **holdout all** | 44.7 ± 4.7 | 40.9 ± 5.0 | 41.4 ± 3.9 |
| **ood all** | 32.6 ± 4.2 | 30.2 ± 2.9 | 30.4 ± 2.7 |
| **adv all** | 41.0 ± 7.1 | 37.8 ± 5.0 | 38.5 ± 7.0 |
| state: dev / ood (cue floor 15) | 16 / 16 | 14 / 14 | 16 / 13 |
| recall: dev / ood (cue floor 33) | 81 / 73 | 60 / 42 | 57 / 40 |
| hops: dev / ood (cue floor 54) | 46 / 53 | 48 / 49 | 49 / 52 |
| perm: dev / ood (cue floor 24) | 48 / 19 | 49 / 18 | 46 / 20 |
| conn: dev / ood (cue floor 50) | 49 / 48 | 49 / 53 | 54 / 50 |
| arith: dev / ood (cue floor 10) | 10 / 9 | 12 / 12 | 11 / 12 |
| binding: dev / ood (cue floor 28) | 65 / 47 | 47 / 37 | 46 / 32 |
| stack: dev / ood (cue floor 29) | 92 / 32 | 86 / 42 | 98 / 46 |
| trace: dev / ood (cue floor 15) | 36 / 28 | 38 / 32 | 37 / 35 |
| cf: dev / ood (cue floor 19) | 12 / 18 | 17 / 17 | 15 / 18 |
| plan: dev / ood (cue floor 23) | 30 / 17 | 30 / 18 | 29 / 18 |

## Cost

| | transformer | moe-token | moe-context |
|---|---|---|---|
| parameters (physical) | 206,256 | 606,384 | 608,432 |
| parameters (active) | 206,256 | 208,560 | 210,608 |
| stored weight bytes | 806 KiB | 2369 KiB | 2377 KiB |
| inference FLOPs / example | 22.8 M | 23.1 M | 23.3 M |
| training FLOPs (3x fwd x examples) | 6.57e+13 | 6.64e+13 | 6.71e+13 |
| persistent state bytes | 0.0 KiB | 0.0 KiB | 0.0 KiB |
| KV / context bytes (longest OOD input) | 198.0 KiB | 198.0 KiB | 198.0 KiB |
| peak RAM (process RSS, incl. torch) | 469 MB | 740 MB | 751 MB |
| latency / example (CPU) | 0.25 ms | 0.38 ms | 0.37 ms |
| training time | 24.7 min | 34.3 min | 32.0 min |
| energy proxy (CPU-core-seconds) | 5927 | 8232 | 7685 |
| sample efficiency (mean probe accuracy) | 35.8 | 32.4 | 32.3 |

## Decision

`{"complete": true, "checks": {"C1_accuracy": false, "C2_circuits": true, "C3_vs_dense": false}, "result": "PARTIAL"}`
