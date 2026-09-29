# Rouge scorecard: R1.09b

Mean ± SD over seeds (95% CIs in summary.json). Accuracy in %.

## Capability

| | transformer | rouge-cheap | rouge-scan |
|---|---|---|---|
| **dev all** | 44.3 ± 5.6 | 39.4 ± 0.9 | 31.6 ± 0.4 |
| **holdout all** | 45.2 ± 5.4 | 41.0 ± 1.7 | 31.7 ± 0.2 |
| **ood all** | 32.6 ± 4.2 | 32.5 ± 1.6 | 26.9 ± 1.3 |
| **adv all** | 43.8 ± 7.0 | 36.3 ± 3.2 | 27.3 ± 0.8 |
| state: dev / ood (cue floor 15) | 16 / 16 | 14 / 15 | 14 / 14 |
| recall: dev / ood (cue floor 33) | 81 / 73 | 92 / 70 | 51 / 36 |
| hops: dev / ood (cue floor 54) | 46 / 53 | 47 / 51 | 53 / 54 |
| perm: dev / ood (cue floor 24) | 48 / 19 | 29 / 20 | 24 / 20 |
| conn: dev / ood (cue floor 50) | 49 / 48 | 48 / 48 | 51 / 51 |
| arith: dev / ood (cue floor 10) | 10 / 9 | 10 / 8 | 7 / 12 |
| binding: dev / ood (cue floor 28) | 65 / 47 | 61 / 54 | 42 / 36 |
| stack: dev / ood (cue floor 29) | 92 / 32 | 52 / 31 | 35 / 19 |
| trace: dev / ood (cue floor 15) | 36 / 28 | 28 / 24 | 23 / 15 |
| cf: dev / ood (cue floor 19) | 12 / 18 | 15 / 18 | 14 / 20 |
| plan: dev / ood (cue floor 23) | 30 / 17 | 39 / 19 | 34 / 19 |

## Cost

| | transformer | rouge-cheap | rouge-scan |
|---|---|---|---|
| parameters (physical) | 206,256 | 232,835 | 233,255 |
| parameters (active) | 206,256 | 232,835 | 233,255 |
| stored weight bytes | 806 KiB | 910 KiB | 911 KiB |
| inference FLOPs / example | 22.8 M | 14.7 M | 12.5 M |
| training FLOPs (3x fwd x examples) | 6.57e+13 | 4.24e+13 | 3.59e+13 |
| persistent state bytes | 0.0 KiB | 14.6 KiB | 14.6 KiB |
| KV / context bytes (longest OOD input) | 198.0 KiB | 0.0 KiB | 0.0 KiB |
| peak RAM (process RSS, incl. torch) | 460 MB | 485 MB | 1220 MB |
| latency / example (CPU) | 0.26 ms | 0.33 ms | 0.43 ms |
| training time | 24.7 min | 42.5 min | 52.4 min |
| energy proxy (CPU-core-seconds) | 5927 | 10201 | 12570 |
| sample efficiency (mean probe accuracy) | 35.8 | 32.6 | 27.1 |

## Decision

`{"complete": true, "checks": {"P1_latency": false, "P2_capability": false, "P3_recall": false, "P4_vs_transformer_latency": true}, "result": "FAIL"}`
