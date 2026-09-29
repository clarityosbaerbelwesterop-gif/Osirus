# Rouge scorecard: R1.29

Mean ± SD over seeds (95% CIs in summary.json). Accuracy in %.

## Capability

| | dense | dense-tiny | ternary |
|---|---|---|---|
| **dev all** | 44.2 ± 5.5 | 38.8 ± 2.3 | 47.2 ± 0.9 |
| **holdout all** | 44.8 ± 4.5 | 37.9 ± 3.0 | 47.8 ± 1.1 |
| **ood all** | 32.7 ± 4.3 | 30.0 ± 2.5 | 36.3 ± 0.7 |
| **adv all** | 41.8 ± 7.4 | 32.3 ± 4.5 | 44.8 ± 0.9 |
| state: dev / ood (cue floor 15) | 16 / 16 | 18 / 14 | 16 / 15 |
| recall: dev / ood (cue floor 33) | 81 / 71 | 59 / 35 | 100 / 89 |
| hops: dev / ood (cue floor 54) | 46 / 54 | 52 / 54 | 48 / 50 |
| perm: dev / ood (cue floor 24) | 50 / 20 | 39 / 20 | 52 / 20 |
| conn: dev / ood (cue floor 50) | 47 / 49 | 53 / 48 | 46 / 51 |
| arith: dev / ood (cue floor 10) | 10 / 9 | 14 / 11 | 12 / 10 |
| binding: dev / ood (cue floor 28) | 65 / 46 | 47 / 42 | 72 / 52 |
| stack: dev / ood (cue floor 29) | 93 / 32 | 75 / 47 | 97 / 47 |
| trace: dev / ood (cue floor 15) | 35 / 27 | 32 / 26 | 35 / 30 |
| cf: dev / ood (cue floor 19) | 12 / 17 | 13 / 16 | 14 / 18 |
| plan: dev / ood (cue floor 23) | 30 / 18 | 26 / 18 | 30 / 16 |

## Cost

| | dense | dense-tiny | ternary |
|---|---|---|---|
| parameters (physical) | 206,256 | 82,848 | 206,256 |
| parameters (active) | 206,256 | 82,848 | 206,256 |
| stored weight bytes | 806 KiB | 324 KiB | 326 KiB |
| inference FLOPs / example | 22.8 M | 8.9 M | 22.8 M |
| training FLOPs (3x fwd x examples) | 6.57e+13 | 2.57e+13 | 6.57e+13 |
| persistent state bytes | 0.0 KiB | 0.0 KiB | 0.0 KiB |
| KV / context bytes (longest OOD input) | 198.0 KiB | 123.8 KiB | 198.0 KiB |
| peak RAM (process RSS, incl. torch) | 481 MB | 424 MB | 451 MB |
| latency / example (CPU) | 0.18 ms | 0.18 ms | 0.23 ms |
| training time | 16.8 min | 18.7 min | 21.7 min |
| energy proxy (CPU-core-seconds) | 4030 | 4480 | 5205 |
| sample efficiency (mean probe accuracy) | 35.9 | 29.9 | 37.6 |

## Decision

`{"complete": true, "checks": {"T1_per_byte": true, "T2_near_fp32": true}, "result": "PASS"}`
