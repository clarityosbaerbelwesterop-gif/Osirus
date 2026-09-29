# Rouge scorecard: R1.12

Mean ± SD over seeds (95% CIs in summary.json). Accuracy in %.

## Capability

| | transformer-full | transformer-w32 | lstm | ssm | rouge-mem |
|---|---|---|---|---|---|
| **dev all** | 34.9 ± 1.1 | 42.2 ± 14.3 | 54.4 ± 0.8 | 25.9 ± 1.4 | 52.3 ± 25.5 |
| **holdout all** | 34.3 ± 2.0 | 44.7 ± 14.5 | 54.6 ± 0.8 | 28.9 ± 1.3 | 51.3 ± 23.9 |
| **ood all** | 15.2 ± 1.8 | 14.2 ± 1.7 | 40.7 ± 0.0 | 19.7 ± 1.1 | 36.4 ± 26.2 |
| **adv all** | 32.0 ± 1.5 | 39.6 ± 14.2 | 50.7 ± 0.7 | 24.2 ± 2.2 | 48.2 ± 24.6 |
| retain: dev / ood (cue floor 17) | 34 / 21 | 38 / 12 | 91 / 100 | 18 / 12 | 50 / 40 |
| overwrite: dev / ood (cue floor 20) | 46 / 6 | 57 / 14 | 47 / 8 | 34 / 34 | 55 / 39 |
| saturate: dev / ood (cue floor 31) | 25 / 18 | 32 / 18 | 26 / 14 | 25 / 14 | 51 / 30 |

## Cost

| | transformer-full | transformer-w32 | lstm | ssm | rouge-mem |
|---|---|---|---|---|---|
| parameters (physical) | 206,256 | 206,256 | 213,520 | 206,176 | 230,691 |
| parameters (active) | 206,256 | 206,256 | 213,520 | 206,176 | 230,691 |
| stored weight bytes | 806 KiB | 806 KiB | 834 KiB | 805 KiB | 901 KiB |
| inference FLOPs / example | 42.1 M | 42.1 M | 21.7 M | 39.9 M | 176.2 M |
| training FLOPs (3x fwd x examples) | 8.08e+13 | 8.08e+13 | 4.17e+13 | 7.66e+13 | 3.38e+14 |
| persistent state bytes | 0.0 KiB | 0.0 KiB | 1.8 KiB | 26.0 KiB | 15.8 KiB |
| KV / context bytes (longest OOD input) | 710.0 KiB | 64.0 KiB | 0.0 KiB | 0.0 KiB | 0.0 KiB |
| peak RAM (process RSS, incl. torch) | 699 MB | 701 MB | 513 MB | 1858 MB | 903 MB |
| latency / example (CPU) | 0.58 ms | 0.66 ms | 0.23 ms | 1.28 ms | 2.35 ms |
| training time | 25.9 min | 29.8 min | 10.5 min | 97.9 min | 135.6 min |
| energy proxy (CPU-core-seconds) | 6213 | 7146 | 2515 | 23485 | 32547 |
| sample efficiency (mean probe accuracy) | 35.2 | 36.5 | 48.6 | 22.1 | 50.5 |

## Decision

`{"complete": true, "checks": {"T1_retain_vs_window": true, "T2_memory": true, "T3_vs_lstm": false, "T4_vs_full": true}, "result": "PASS"}`
