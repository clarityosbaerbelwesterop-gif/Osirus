# Rouge scorecard: R1.11

Mean ± SD over seeds (95% CIs in summary.json). Accuracy in %.

## Capability

| | transformer | rouge-mem | rouge-win16 | rouge-win32 |
|---|---|---|---|---|
| **dev all** | 44.3 ± 5.6 | 34.6 ± 0.9 | 38.0 ± 2.0 | 37.5 ± 1.0 |
| **holdout all** | 45.3 ± 5.7 | 35.1 ± 1.5 | 37.5 ± 1.7 | 36.6 ± 1.1 |
| **ood all** | 32.4 ± 4.1 | 31.8 ± 0.4 | 31.1 ± 3.6 | 32.3 ± 2.0 |
| **adv all** | 42.4 ± 7.3 | 32.8 ± 1.8 | 35.4 ± 0.7 | 34.3 ± 1.8 |
| state: dev / ood (cue floor 15) | 17 / 16 | 16 / 15 | 14 / 15 | 16 / 15 |
| recall: dev / ood (cue floor 33) | 81 / 72 | 90 / 67 | 92 / 73 | 85 / 64 |
| hops: dev / ood (cue floor 54) | 47 / 53 | 46 / 54 | 50 / 43 | 50 / 51 |
| perm: dev / ood (cue floor 24) | 48 / 19 | 20 / 22 | 23 / 19 | 22 / 17 |
| conn: dev / ood (cue floor 50) | 48 / 48 | 48 / 47 | 52 / 50 | 52 / 49 |
| arith: dev / ood (cue floor 10) | 11 / 10 | 9 / 12 | 9 / 10 | 9 / 11 |
| binding: dev / ood (cue floor 28) | 65 / 46 | 61 / 57 | 67 / 45 | 74 / 66 |
| stack: dev / ood (cue floor 29) | 92 / 29 | 23 / 20 | 42 / 28 | 33 / 22 |
| trace: dev / ood (cue floor 15) | 36 / 28 | 22 / 19 | 25 / 23 | 24 / 22 |
| cf: dev / ood (cue floor 19) | 13 / 17 | 14 / 20 | 13 / 17 | 14 / 19 |
| plan: dev / ood (cue floor 23) | 29 / 17 | 32 / 18 | 31 / 18 | 32 / 20 |

## Cost

| | transformer | rouge-mem | rouge-win16 | rouge-win32 |
|---|---|---|---|---|
| parameters (physical) | 206,256 | 230,691 | 232,835 | 232,835 |
| parameters (active) | 206,256 | 230,691 | 232,835 | 232,835 |
| stored weight bytes | 806 KiB | 901 KiB | 910 KiB | 910 KiB |
| inference FLOPs / example | 22.8 M | 104.6 M | 91.1 M | 91.8 M |
| training FLOPs (3x fwd x examples) | 6.57e+13 | 3.01e+14 | 2.62e+14 | 2.65e+14 |
| persistent state bytes | 0.0 KiB | 15.8 KiB | 14.6 KiB | 14.6 KiB |
| KV / context bytes (longest OOD input) | 198.0 KiB | 0.0 KiB | 13.0 KiB | 26.0 KiB |
| peak RAM (process RSS, incl. torch) | 455 MB | 631 MB | 636 MB | 626 MB |
| latency / example (CPU) | 0.23 ms | 1.05 ms | 0.99 ms | 0.96 ms |
| training time | 23.2 min | 113.5 min | 110.1 min | 108.7 min |
| energy proxy (CPU-core-seconds) | 5562 | 27249 | 26431 | 26091 |
| sample efficiency (mean probe accuracy) | 35.7 | 31.4 | 32.0 | 31.1 |

## Decision

`{"complete": true, "checks": {"W1_capability": true, "W2_recall": true, "W3_memory": true, "W4_bigger_window": false}, "result": "PASS"}`
