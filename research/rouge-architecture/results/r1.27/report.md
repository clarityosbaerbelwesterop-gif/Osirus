# Rouge scorecard: R1.27

Mean ± SD over seeds (95% CIs in summary.json). Accuracy in %.

## Capability

| | dense | dense-d52 | bank2 |
|---|---|---|---|
| **dev all** | 44.1 ± 5.4 | 44.0 ± 5.1 | 45.7 ± 3.7 |
| **holdout all** | 45.5 ± 5.5 | 45.4 ± 5.7 | 47.7 ± 2.2 |
| **ood all** | 32.7 ± 4.2 | 32.6 ± 5.4 | 34.1 ± 0.6 |
| **adv all** | 42.5 ± 7.0 | 42.0 ± 7.3 | 44.5 ± 1.9 |
| state: dev / ood (cue floor 15) | 16 / 15 | 18 / 14 | 14 / 16 |
| recall: dev / ood (cue floor 33) | 81 / 72 | 81 / 73 | 99 / 87 |
| hops: dev / ood (cue floor 54) | 46 / 52 | 47 / 49 | 48 / 53 |
| perm: dev / ood (cue floor 24) | 48 / 19 | 50 / 22 | 45 / 15 |
| conn: dev / ood (cue floor 50) | 49 / 49 | 48 / 49 | 50 / 52 |
| arith: dev / ood (cue floor 10) | 9 / 9 | 11 / 12 | 9 / 11 |
| binding: dev / ood (cue floor 28) | 65 / 50 | 62 / 51 | 74 / 36 |
| stack: dev / ood (cue floor 29) | 92 / 32 | 92 / 25 | 86 / 42 |
| trace: dev / ood (cue floor 15) | 36 / 28 | 35 / 28 | 35 / 29 |
| cf: dev / ood (cue floor 19) | 12 / 18 | 14 / 18 | 12 / 16 |
| plan: dev / ood (cue floor 23) | 30 / 18 | 27 / 17 | 30 / 18 |

## Cost

| | dense | dense-d52 | bank2 |
|---|---|---|---|
| parameters (physical) | 206,256 | 137,640 | 140,736 |
| parameters (active) | 206,256 | 137,640 | 140,736 |
| stored weight bytes | 806 KiB | 538 KiB | 550 KiB |
| inference FLOPs / example | 22.8 M | 15.1 M | 22.8 M |
| training FLOPs (3x fwd x examples) | 6.57e+13 | 4.34e+13 | 6.57e+13 |
| persistent state bytes | 0.0 KiB | 0.0 KiB | 0.0 KiB |
| KV / context bytes (longest OOD input) | 198.0 KiB | 160.9 KiB | 198.0 KiB |
| peak RAM (process RSS, incl. torch) | 455 MB | 456 MB | 466 MB |
| latency / example (CPU) | 0.26 ms | 0.18 ms | 0.23 ms |
| training time | 24.2 min | 15.4 min | 21.0 min |
| energy proxy (CPU-core-seconds) | 5817 | 3704 | 5049 |
| sample efficiency (mean probe accuracy) | 36.0 | 36.5 | 35.8 |

## Decision

`{"complete": true, "checks": {"B1": false, "B2": true}, "result": "PARTIAL"}`
