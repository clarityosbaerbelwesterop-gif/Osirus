# Rouge scorecard: R1.25

Mean ± SD over seeds (95% CIs in summary.json). Accuracy in %.

## Capability

| | dense | dense-d80 | hyper |
|---|---|---|---|
| **dev all** | 44.5 ± 4.4 | 44.7 ± 4.5 | 33.2 ± 3.3 |
| **holdout all** | 46.2 ± 3.8 | 45.4 ± 5.2 | 34.3 ± 4.5 |
| **ood all** | 33.1 ± 3.7 | 33.8 ± 3.8 | 25.1 ± 1.3 |
| **adv all** | 42.6 ± 4.0 | 42.8 ± 6.9 | 35.1 ± 5.0 |
| state: dev / ood (cue floor 15) | 13 / 15 | 16 / 14 | 16 / 16 |
| recall: dev / ood (cue floor 33) | 85 / 71 | 79 / 62 | 49 / 30 |
| hops: dev / ood (cue floor 54) | 46 / 52 | 48 / 54 | 46 / 53 |
| perm: dev / ood (cue floor 24) | 48 / 18 | 50 / 20 | 39 / 22 |
| conn: dev / ood (cue floor 50) | 51 / 50 | 49 / 49 | 49 / 46 |
| arith: dev / ood (cue floor 10) | 11 / 9 | 10 / 10 | 12 / 9 |
| binding: dev / ood (cue floor 28) | 66 / 49 | 61 / 43 | 44 / 32 |
| stack: dev / ood (cue floor 29) | 93 / 34 | 98 / 51 | 69 / 29 |
| trace: dev / ood (cue floor 15) | 35 / 30 | 36 / 30 | 26 / 23 |
| cf: dev / ood (cue floor 19) | 11 / 17 | 16 / 19 | 14 / 15 |
| plan: dev / ood (cue floor 23) | 31 / 19 | 28 / 18 | 0 / 0 |

## Cost

| | dense | dense-d80 | hyper |
|---|---|---|---|
| parameters (physical) | 206,256 | 319,248 | 313,904 |
| parameters (active) | 206,256 | 319,248 | 313,904 |
| stored weight bytes | 806 KiB | 1247 KiB | 1226 KiB |
| inference FLOPs / example | 22.8 M | 35.6 M | 23.6 M |
| training FLOPs (3x fwd x examples) | 6.57e+13 | 1.03e+14 | 6.80e+13 |
| persistent state bytes | 0.0 KiB | 0.0 KiB | 0.0 KiB |
| KV / context bytes (longest OOD input) | 198.0 KiB | 247.5 KiB | 198.0 KiB |
| peak RAM (process RSS, incl. torch) | 474 MB | 500 MB | 523 MB |
| latency / example (CPU) | 0.14 ms | 0.26 ms | 0.22 ms |
| training time | 13.6 min | 23.3 min | 22.5 min |
| energy proxy (CPU-core-seconds) | 3263 | 5602 | 5406 |
| sample efficiency (mean probe accuracy) | 36.1 | 35.0 | 30.4 |

## Decision

`{"complete": true, "checks": {"G1": false, "G2": false}, "result": "FAIL"}`
