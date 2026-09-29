# Rouge scorecard: R1.35

Mean ± SD over seeds (95% CIs in summary.json). Accuracy in %.

## Capability

| | transformer | hyp4 |
|---|---|---|
| **dev all** | 44.8 ± 4.7 | 41.9 ± 4.5 |
| **holdout all** | 45.8 ± 3.7 | 42.4 ± 5.1 |
| **ood all** | 33.0 ± 3.6 | 32.1 ± 3.3 |
| **adv all** | 42.1 ± 5.6 | 39.9 ± 5.2 |
| state: dev / ood (cue floor 15) | 14 / 17 | 14 / 15 |
| recall: dev / ood (cue floor 33) | 85 / 73 | 80 / 62 |
| hops: dev / ood (cue floor 54) | 46 / 53 | 46 / 56 |
| perm: dev / ood (cue floor 24) | 47 / 16 | 39 / 20 |
| conn: dev / ood (cue floor 50) | 51 / 49 | 50 / 50 |
| arith: dev / ood (cue floor 10) | 12 / 8 | 11 / 10 |
| binding: dev / ood (cue floor 28) | 66 / 47 | 61 / 40 |
| stack: dev / ood (cue floor 29) | 92 / 34 | 91 / 35 |
| trace: dev / ood (cue floor 15) | 36 / 30 | 33 / 31 |
| cf: dev / ood (cue floor 19) | 12 / 17 | 14 / 18 |
| plan: dev / ood (cue floor 23) | 32 / 18 | 22 / 16 |

## Cost

| | transformer | hyp4 |
|---|---|---|
| parameters (physical) | 206,256 | 227,269 |
| parameters (active) | 206,256 | 227,269 |
| stored weight bytes | 806 KiB | 888 KiB |
| inference FLOPs / example | 22.8 M | 22.9 M |
| training FLOPs (3x fwd x examples) | 6.57e+13 | 6.59e+13 |
| persistent state bytes | 0.0 KiB | 0.0 KiB |
| KV / context bytes (longest OOD input) | 198.0 KiB | 198.0 KiB |
| peak RAM (process RSS, incl. torch) | 447 MB | 472 MB |
| latency / example (CPU) | 0.24 ms | 0.27 ms |
| training time | 23.1 min | 24.5 min |
| energy proxy (CPU-core-seconds) | 5539 | 5885 |
| sample efficiency (mean probe accuracy) | 35.8 | 32.6 |

## Inference settings (one trained model, several settings)

| setting | transformer | hyp4 |
|---|---|---|
| own.dev | - | 41.9 |
| own.flops | - | 22.9 M |
| own.ood | - | 32.1 |
| own.steps | - | 0.00 |
| single.dev | - | 36.5 |
| single.flops | - | 22.9 M |
| single.ood | - | 27.1 |
| single.steps | - | 0.00 |
| verifier.dev | - | 42.8 |
| verifier.flops | - | 22.9 M |
| verifier.ood | - | 31.4 |
| verifier.steps | - | 0.00 |

## Decision

`{"complete": true, "checks": {"H1_fewer_confident_errors": false, "H2_no_accuracy_loss": false, "V1_R1_37_verifier_beats_confidence": false, "S1_R1_38_verifier_pick": false, "S2_R1_38_vs_single": true}, "result": "FAIL"}`
