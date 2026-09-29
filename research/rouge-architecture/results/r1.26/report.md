# Rouge scorecard: R1.26

Mean ± SD over seeds (95% CIs in summary.json). Accuracy in %.

## Capability

| | dense | dense-small | dense-tiny | lowrank | kron | tt |
|---|---|---|---|---|---|---|
| **dev all** | 44.8 ± 4.7 | 41.0 ± 4.9 | 38.8 ± 2.3 | 43.0 ± 1.3 | 41.7 ± 4.2 | 44.7 ± 5.1 |
| **holdout all** | 45.3 ± 4.8 | 41.1 ± 4.7 | 37.4 ± 3.6 | 43.4 ± 2.5 | 42.1 ± 4.5 | 44.4 ± 6.2 |
| **ood all** | 32.7 ± 3.6 | 30.8 ± 2.6 | 30.0 ± 2.5 | 30.2 ± 1.1 | 30.5 ± 3.7 | 31.2 ± 4.0 |
| **adv all** | 43.6 ± 7.5 | 37.9 ± 6.5 | 32.7 ± 4.3 | 40.0 ± 1.5 | 37.5 ± 5.9 | 41.8 ± 6.2 |
| state: dev / ood (cue floor 15) | 15 / 17 | 15 / 15 | 18 / 14 | 18 / 16 | 17 / 15 | 16 / 15 |
| recall: dev / ood (cue floor 33) | 83 / 71 | 68 / 47 | 59 / 35 | 68 / 43 | 65 / 49 | 79 / 59 |
| hops: dev / ood (cue floor 54) | 48 / 53 | 49 / 56 | 52 / 54 | 47 / 52 | 49 / 52 | 52 / 50 |
| perm: dev / ood (cue floor 24) | 48 / 19 | 50 / 22 | 39 / 20 | 52 / 22 | 52 / 19 | 57 / 16 |
| conn: dev / ood (cue floor 50) | 49 / 49 | 49 / 51 | 53 / 48 | 48 / 52 | 49 / 50 | 50 / 49 |
| arith: dev / ood (cue floor 10) | 13 / 9 | 11 / 12 | 14 / 11 | 10 / 11 | 11 / 12 | 12 / 10 |
| binding: dev / ood (cue floor 28) | 68 / 46 | 50 / 41 | 47 / 42 | 63 / 39 | 48 / 36 | 58 / 39 |
| stack: dev / ood (cue floor 29) | 92 / 30 | 88 / 38 | 75 / 47 | 93 / 38 | 97 / 43 | 95 / 38 |
| trace: dev / ood (cue floor 15) | 36 / 32 | 31 / 26 | 32 / 26 | 30 / 26 | 30 / 26 | 32 / 27 |
| cf: dev / ood (cue floor 19) | 14 / 16 | 13 / 16 | 13 / 16 | 14 / 18 | 12 / 17 | 14 / 20 |
| plan: dev / ood (cue floor 23) | 28 / 18 | 28 / 16 | 26 / 18 | 28 / 18 | 28 / 16 | 29 / 18 |

## Cost

| | dense | dense-small | dense-tiny | lowrank | kron | tt |
|---|---|---|---|---|---|---|
| parameters (physical) | 206,256 | 117,840 | 82,848 | 116,144 | 77,744 | 95,664 |
| parameters (active) | 206,256 | 117,840 | 82,848 | 116,144 | 77,744 | 95,664 |
| stored weight bytes | 806 KiB | 460 KiB | 324 KiB | 454 KiB | 304 KiB | 374 KiB |
| inference FLOPs / example | 22.8 M | 12.8 M | 8.9 M | 12.4 M | 10.7 M | 32.3 M |
| training FLOPs (3x fwd x examples) | 6.57e+13 | 3.70e+13 | 2.57e+13 | 3.56e+13 | 3.08e+13 | 9.31e+13 |
| persistent state bytes | 0.0 KiB | 0.0 KiB | 0.0 KiB | 0.0 KiB | 0.0 KiB | 0.0 KiB |
| KV / context bytes (longest OOD input) | 198.0 KiB | 148.5 KiB | 123.8 KiB | 198.0 KiB | 198.0 KiB | 198.0 KiB |
| peak RAM (process RSS, incl. torch) | 454 MB | 419 MB | 420 MB | 452 MB | 539 MB | 964 MB |
| latency / example (CPU) | 0.22 ms | 0.19 ms | 0.18 ms | 0.20 ms | 0.25 ms | 0.80 ms |
| training time | 20.3 min | 17.2 min | 17.9 min | 19.5 min | 24.2 min | 98.5 min |
| energy proxy (CPU-core-seconds) | 4874 | 4119 | 4286 | 4681 | 5799 | 23640 |
| sample efficiency (mean probe accuracy) | 36.0 | 32.7 | 29.9 | 33.4 | 34.9 | 35.1 |

## Decision

`{"complete": true, "checks": {"S1_lowrank": false, "S2_kron": true, "S3_tt": true, "E1_lowrank": true, "E2_kron": true, "E3_tt": true}, "result": "PASS"}`
