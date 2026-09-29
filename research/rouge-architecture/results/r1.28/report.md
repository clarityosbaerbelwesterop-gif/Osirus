# Rouge scorecard: R1.28

Mean ± SD over seeds (95% CIs in summary.json). Accuracy in %.

## Capability

| | dense-tiny | field |
|---|---|---|
| **dev all** | 38.8 ± 2.3 | 45.1 ± 3.8 |
| **holdout all** | 35.8 ± 4.1 | 44.4 ± 4.5 |
| **ood all** | 30.0 ± 2.5 | 32.4 ± 2.6 |
| **adv all** | 32.5 ± 4.6 | 42.0 ± 4.5 |
| state: dev / ood (cue floor 15) | 18 / 14 | 15 / 15 |
| recall: dev / ood (cue floor 33) | 59 / 35 | 88 / 70 |
| hops: dev / ood (cue floor 54) | 52 / 54 | 51 / 50 |
| perm: dev / ood (cue floor 24) | 39 / 20 | 43 / 18 |
| conn: dev / ood (cue floor 50) | 53 / 48 | 51 / 48 |
| arith: dev / ood (cue floor 10) | 14 / 12 | 9 / 13 |
| binding: dev / ood (cue floor 28) | 47 / 42 | 68 / 40 |
| stack: dev / ood (cue floor 29) | 75 / 47 | 96 / 43 |
| trace: dev / ood (cue floor 15) | 32 / 26 | 29 / 24 |
| cf: dev / ood (cue floor 19) | 13 / 16 | 14 / 19 |
| plan: dev / ood (cue floor 23) | 26 / 18 | 31 / 17 |

## Cost

| | dense-tiny | field |
|---|---|---|
| parameters (physical) | 82,848 | 92,352 |
| parameters (active) | 82,848 | 92,352 |
| stored weight bytes | 324 KiB | 361 KiB |
| inference FLOPs / example | 8.9 M | 35.2 M |
| training FLOPs (3x fwd x examples) | 2.57e+13 | 1.01e+14 |
| persistent state bytes | 0.0 KiB | 0.0 KiB |
| KV / context bytes (longest OOD input) | 123.8 KiB | 198.0 KiB |
| peak RAM (process RSS, incl. torch) | 420 MB | 518 MB |
| latency / example (CPU) | 0.17 ms | 0.32 ms |
| training time | 18.0 min | 37.2 min |
| energy proxy (CPU-core-seconds) | 4321 | 8924 |
| sample efficiency (mean probe accuracy) | 29.9 | 36.9 |

## Decision

`{"complete": true, "checks": {"F1": true, "F2": true, "F3_decode_cost": false}, "result": "PARTIAL"}`
