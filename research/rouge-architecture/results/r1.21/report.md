# Rouge scorecard: R1.21

Mean ± SD over seeds (95% CIs in summary.json). Accuracy in %.

## Capability

| | transformer | early |
|---|---|---|
| **dev all** | 44.0 ± 5.3 | 36.4 ± 0.1 |
| **holdout all** | 45.3 ± 4.8 | 37.1 ± 0.2 |
| **ood all** | 32.7 ± 4.3 | 27.0 ± 1.1 |
| **adv all** | 42.4 ± 6.6 | 30.8 ± 1.7 |
| state: dev / ood (cue floor 15) | 15 / 14 | 17 / 17 |
| recall: dev / ood (cue floor 33) | 81 / 71 | 37 / 26 |
| hops: dev / ood (cue floor 54) | 46 / 52 | 50 / 50 |
| perm: dev / ood (cue floor 24) | 49 / 20 | 46 / 18 |
| conn: dev / ood (cue floor 50) | 49 / 49 | 53 / 48 |
| arith: dev / ood (cue floor 10) | 9 / 9 | 9 / 11 |
| binding: dev / ood (cue floor 28) | 65 / 49 | 34 / 32 |
| stack: dev / ood (cue floor 29) | 92 / 32 | 90 / 37 |
| trace: dev / ood (cue floor 15) | 35 / 27 | 25 / 23 |
| cf: dev / ood (cue floor 19) | 11 / 17 | 13 / 17 |
| plan: dev / ood (cue floor 23) | 30 / 19 | 29 / 17 |

## Cost

| | transformer | early |
|---|---|---|
| parameters (physical) | 206,256 | 216,000 |
| parameters (active) | 206,256 | 216,000 |
| stored weight bytes | 806 KiB | 844 KiB |
| inference FLOPs / example | 22.8 M | 22.8 M |
| training FLOPs (3x fwd x examples) | 6.57e+13 | 6.58e+13 |
| persistent state bytes | 0.0 KiB | 0.0 KiB |
| KV / context bytes (longest OOD input) | 198.0 KiB | 198.0 KiB |
| peak RAM (process RSS, incl. torch) | 465 MB | 446 MB |
| latency / example (CPU) | 0.23 ms | 0.22 ms |
| training time | 21.2 min | 22.9 min |
| energy proxy (CPU-core-seconds) | 5096 | 5501 |
| sample efficiency (mean probe accuracy) | 36.1 | 30.5 |

## Inference settings (one trained model, several settings)

| setting | transformer | early |
|---|---|---|
| exit70.dev | - | 36.4 |
| exit70.false_exit_rate | - | 0.1 |
| exit70.flops | - | 21.2 M |
| exit70.ood | - | 27.0 |
| exit70.steps | - | 3.71 |
| exit80.dev | - | 36.4 |
| exit80.false_exit_rate | - | 0.0 |
| exit80.flops | - | 21.5 M |
| exit80.ood | - | 27.0 |
| exit80.steps | - | 3.77 |
| exit90.dev | - | 36.4 |
| exit90.false_exit_rate | - | 0.0 |
| exit90.flops | - | 21.8 M |
| exit90.ood | - | 27.0 |
| exit90.steps | - | 3.82 |
| full.dev | - | 36.4 |
| full.flops | - | 22.8 M |
| full.ood | - | 27.0 |
| full.steps | - | 4.00 |

## Decision

`{"complete": true, "checks": {"E1_flops": false, "E2_accuracy": true, "E3_false_exits": true, "E4_supervision_cost": false}, "result": "PARTIAL"}`
