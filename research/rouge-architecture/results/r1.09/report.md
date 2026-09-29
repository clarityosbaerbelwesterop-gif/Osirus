# Rouge scorecard: R1.09

Mean ± SD over seeds (95% CIs in summary.json). Accuracy in %.

## Capability

| | transformer | rouge-mem | rouge-cheap |
|---|---|---|---|
| **dev all** | 44.3 ± 5.6 | 35.3 ± 1.3 | 39.9 ± 1.4 |
| **holdout all** | 45.0 ± 5.0 | 35.9 ± 0.7 | 40.0 ± 2.0 |
| **ood all** | 32.6 ± 4.2 | 32.4 ± 1.4 | 32.9 ± 2.1 |
| **adv all** | 41.7 ± 6.9 | 31.1 ± 1.5 | 35.7 ± 2.1 |
| state: dev / ood (cue floor 15) | 17 / 17 | 15 / 16 | 14 / 16 |
| recall: dev / ood (cue floor 33) | 81 / 72 | 92 / 73 | 94 / 72 |
| hops: dev / ood (cue floor 54) | 46 / 53 | 46 / 51 | 48 / 50 |
| perm: dev / ood (cue floor 24) | 50 / 19 | 20 / 21 | 28 / 20 |
| conn: dev / ood (cue floor 50) | 47 / 48 | 48 / 46 | 50 / 50 |
| arith: dev / ood (cue floor 10) | 10 / 9 | 9 / 12 | 11 / 7 |
| binding: dev / ood (cue floor 28) | 65 / 47 | 63 / 58 | 56 / 49 |
| stack: dev / ood (cue floor 29) | 92 / 31 | 24 / 19 | 56 / 35 |
| trace: dev / ood (cue floor 15) | 36 / 28 | 24 / 22 | 29 / 24 |
| cf: dev / ood (cue floor 19) | 12 / 17 | 14 / 21 | 15 / 16 |
| plan: dev / ood (cue floor 23) | 30 / 18 | 32 / 19 | 39 / 20 |

## Cost

| | transformer | rouge-mem | rouge-cheap |
|---|---|---|---|
| parameters (physical) | 206,256 | 230,691 | 232,835 |
| parameters (active) | 206,256 | 230,691 | 232,835 |
| stored weight bytes | 806 KiB | 901 KiB | 910 KiB |
| inference FLOPs / example | 22.8 M | 104.6 M | 15.2 M |
| training FLOPs (3x fwd x examples) | 6.57e+13 | 3.01e+14 | 4.37e+13 |
| persistent state bytes | 0.0 KiB | 15.8 KiB | 14.6 KiB |
| KV / context bytes (longest OOD input) | 198.0 KiB | 0.0 KiB | 0.0 KiB |
| peak RAM (process RSS, incl. torch) | 471 MB | 651 MB | 483 MB |
| latency / example (CPU) | 0.22 ms | 0.83 ms | 0.26 ms |
| training time | 20.4 min | 97.4 min | 37.5 min |
| energy proxy (CPU-core-seconds) | 4894 | 23378 | 9009 |
| sample efficiency (mean probe accuracy) | 35.9 | 31.1 | 33.4 |

## Decision

`{"complete": true, "checks": {"C1_flops": true, "C2_capability": true, "C3_recall": true, "C4_near_transformer": true}, "result": "PASS"}`
