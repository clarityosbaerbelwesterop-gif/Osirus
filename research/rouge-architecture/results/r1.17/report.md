# Rouge scorecard: R1.17

Mean ± SD over seeds (95% CIs in summary.json). Accuracy in %.

## Capability

| | transformer | transformer-d48 | mod50 |
|---|---|---|---|
| **dev all** | 44.8 ± 4.7 | 41.0 ± 4.9 | 35.7 ± 0.9 |
| **holdout all** | 45.6 ± 4.0 | 42.2 ± 4.6 | 35.7 ± 1.7 |
| **ood all** | 32.8 ± 3.5 | 30.8 ± 2.6 | 26.6 ± 1.0 |
| **adv all** | 42.7 ± 5.0 | 38.4 ± 6.7 | 30.3 ± 1.9 |
| state: dev / ood (cue floor 15) | 15 / 17 | 15 / 15 | 15 / 16 |
| recall: dev / ood (cue floor 33) | 85 / 72 | 68 / 47 | 38 / 26 |
| hops: dev / ood (cue floor 54) | 46 / 53 | 49 / 56 | 49 / 54 |
| perm: dev / ood (cue floor 24) | 47 / 17 | 50 / 22 | 44 / 20 |
| conn: dev / ood (cue floor 50) | 50 / 49 | 49 / 51 | 49 / 49 |
| arith: dev / ood (cue floor 10) | 12 / 10 | 11 / 12 | 11 / 12 |
| binding: dev / ood (cue floor 28) | 66 / 46 | 50 / 41 | 34 / 33 |
| stack: dev / ood (cue floor 29) | 92 / 31 | 88 / 38 | 78 / 26 |
| trace: dev / ood (cue floor 15) | 36 / 30 | 31 / 26 | 29 / 23 |
| cf: dev / ood (cue floor 19) | 13 / 16 | 13 / 16 | 16 / 19 |
| plan: dev / ood (cue floor 23) | 31 / 18 | 28 / 16 | 30 / 17 |

## Cost

| | transformer | transformer-d48 | mod50 |
|---|---|---|---|
| parameters (physical) | 206,256 | 117,840 | 206,516 |
| parameters (active) | 206,256 | 117,840 | 206,516 |
| stored weight bytes | 806 KiB | 460 KiB | 807 KiB |
| inference FLOPs / example | 22.8 M | 12.8 M | 14.3 M |
| training FLOPs (3x fwd x examples) | 6.57e+13 | 3.70e+13 | 4.11e+13 |
| persistent state bytes | 0.0 KiB | 0.0 KiB | 0.0 KiB |
| KV / context bytes (longest OOD input) | 198.0 KiB | 148.5 KiB | 123.8 KiB |
| peak RAM (process RSS, incl. torch) | 459 MB | 429 MB | 440 MB |
| latency / example (CPU) | 0.20 ms | 0.20 ms | 0.21 ms |
| training time | 19.8 min | 17.9 min | 18.1 min |
| energy proxy (CPU-core-seconds) | 4741 | 4294 | 4350 |
| sample efficiency (mean probe accuracy) | 35.7 | 32.7 | 28.9 |

## Inference settings (one trained model, several settings)

| setting | transformer | transformer-d48 | mod50 |
|---|---|---|---|
| full.dev | - | - | 30.2 |
| full.flops | - | - | 22.8 M |
| full.ood | - | - | 23.8 |
| full.steps | - | - | 0.00 |
| routed.dev | - | - | 35.7 |
| routed.flops | - | - | 14.3 M |
| routed.ood | - | - | 26.6 |
| routed.steps | - | - | 0.00 |

## Decision

`{"complete": true, "checks": {"M1_acc": false, "M1_flops": true, "M2_vs_flop_matched": false}, "result": "FAIL"}`
