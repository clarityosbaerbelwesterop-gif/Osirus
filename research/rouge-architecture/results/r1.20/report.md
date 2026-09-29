# Rouge scorecard: R1.20

Mean ± SD over seeds (95% CIs in summary.json). Accuracy in %.

## Capability

| | transformer | knob | fixed4 |
|---|---|---|---|
| **dev all** | 44.0 ± 5.3 | 44.1 ± 4.0 | 48.2 ± 0.3 |
| **holdout all** | 45.1 ± 4.9 | 44.3 ± 4.1 | 48.0 ± 1.2 |
| **ood all** | 32.7 ± 4.3 | 28.9 ± 5.0 | 35.8 ± 1.3 |
| **adv all** | 43.2 ± 7.7 | 42.9 ± 6.0 | 46.9 ± 1.2 |
| state: dev / ood (cue floor 15) | 15 / 14 | 15 / 17 | 14 / 16 |
| recall: dev / ood (cue floor 33) | 81 / 71 | 83 / 63 | 100 / 94 |
| hops: dev / ood (cue floor 54) | 46 / 52 | 50 / 31 | 48 / 50 |
| perm: dev / ood (cue floor 24) | 49 / 20 | 37 / 14 | 42 / 15 |
| conn: dev / ood (cue floor 50) | 49 / 49 | 50 / 50 | 50 / 50 |
| arith: dev / ood (cue floor 10) | 9 / 9 | 12 / 11 | 12 / 11 |
| binding: dev / ood (cue floor 28) | 65 / 49 | 68 / 26 | 79 / 49 |
| stack: dev / ood (cue floor 29) | 92 / 32 | 88 / 38 | 98 / 38 |
| trace: dev / ood (cue floor 15) | 35 / 27 | 38 / 36 | 40 / 36 |
| cf: dev / ood (cue floor 19) | 11 / 17 | 12 / 18 | 16 / 17 |
| plan: dev / ood (cue floor 23) | 30 / 19 | 30 / 15 | 32 / 18 |

## Cost

| | transformer | knob | fixed4 |
|---|---|---|---|
| parameters (physical) | 206,256 | 211,120 | 211,120 |
| parameters (active) | 206,256 | 211,120 | 211,120 |
| stored weight bytes | 806 KiB | 825 KiB | 825 KiB |
| inference FLOPs / example | 22.8 M | 91.2 M | 91.2 M |
| training FLOPs (3x fwd x examples) | 6.57e+13 | 2.63e+14 | 2.63e+14 |
| persistent state bytes | 0.0 KiB | 0.0 KiB | 0.0 KiB |
| KV / context bytes (longest OOD input) | 198.0 KiB | 396.0 KiB | 396.0 KiB |
| peak RAM (process RSS, incl. torch) | 465 MB | 756 MB | 627 MB |
| latency / example (CPU) | 0.21 ms | 0.52 ms | 0.62 ms |
| training time | 18.9 min | 50.7 min | 53.1 min |
| energy proxy (CPU-core-seconds) | 4545 | 12169 | 12743 |
| sample efficiency (mean probe accuracy) | 36.1 | 33.8 | 39.0 |

## Inference settings (one trained model, several settings)

| setting | transformer | knob | fixed4 |
|---|---|---|---|
| deep.dev | - | 44.1 | 48.2 |
| deep.flops | - | 91.2 M | 91.2 M |
| deep.ood | - | 28.9 | 35.8 |
| deep.steps | - | 4.00 | 4.00 |
| fast.dev | - | 28.9 | 20.2 |
| fast.flops | - | 22.8 M | 22.8 M |
| fast.ood | - | 19.8 | 16.5 |
| fast.steps | - | 1.00 | 1.00 |
| normal.dev | - | 41.3 | 32.4 |
| normal.flops | - | 45.6 M | 45.6 M |
| normal.ood | - | 26.1 | 23.1 |
| normal.steps | - | 2.00 | 2.00 |
| ultra.dev | - | 43.8 | 40.9 |
| ultra.flops | - | 182.5 M | 182.5 M |
| ultra.ood | - | 28.8 | 31.8 |
| ultra.steps | - | 8.00 | 8.00 |

## Decision

`{"complete": true, "checks": {"K1a": true, "K1b": true, "K1c": true, "K2_ultra_gain": false, "K3_no_loss": false}, "result": "PARTIAL"}`
