# Rouge scorecard: R1.39b

Mean ± SD over seeds (95% CIs in summary.json). Accuracy in %.

## Capability

| | transformer-sup | transformer-sup-rl | exec-sup | exec-sup-rl |
|---|---|---|---|---|
| **dev all** | 46.7 ± 10.4 | 37.6 ± 3.6 | 41.4 ± 5.5 | 30.5 ± 4.6 |
| **holdout all** | 47.2 ± 12.9 | 39.7 ± 4.0 | 41.2 ± 3.4 | 33.1 ± 5.6 |
| **ood all** | 29.7 ± 1.7 | 31.2 ± 2.5 | 27.5 ± 3.5 | 26.6 ± 3.0 |
| **adv all** | 46.7 ± 12.0 | 36.8 ± 3.7 | 41.3 ± 5.2 | 31.0 ± 7.4 |
| trace: dev / ood (cue floor 16) | 61 / 43 | 47 / 45 | 55 / 32 | 40 / 34 |
| chain: dev / ood (cue floor 17) | 32 / 17 | 28 / 17 | 28 / 24 | 21 / 19 |

## Cost

| | transformer-sup | transformer-sup-rl | exec-sup | exec-sup-rl |
|---|---|---|---|---|
| parameters (physical) | 206,256 | 206,256 | 211,120 | 211,120 |
| parameters (active) | 206,256 | 206,256 | 211,120 | 211,120 |
| stored weight bytes | 806 KiB | 806 KiB | 825 KiB | 825 KiB |
| inference FLOPs / example | 9.1 M | 9.1 M | 72.5 M | 72.5 M |
| training FLOPs (3x fwd x examples) | 2.61e+13 | 2.61e+13 | 2.09e+14 | 2.09e+14 |
| persistent state bytes | 0.0 KiB | 0.0 KiB | 0.0 KiB | 0.0 KiB |
| KV / context bytes (longest OOD input) | 70.0 KiB | 70.0 KiB | 35.0 KiB | 35.0 KiB |
| peak RAM (process RSS, incl. torch) | 362 MB | 369 MB | 513 MB | 514 MB |
| latency / example (CPU) | 0.17 ms | 0.18 ms | 0.60 ms | 0.55 ms |
| training time | 10.7 min | 11.5 min | 44.0 min | 40.5 min |
| energy proxy (CPU-core-seconds) | 2559 | 2748 | 10571 | 9712 |
| sample efficiency (mean probe accuracy) | 36.9 | 33.0 | 35.4 | 32.5 |

## Decision

`{"complete": true, "checks": {"RL1_exec_ood": false, "RL2_transformer_ood": false, "RL3_no_id_loss": false, "RL4_calibration": false}, "result": "FAIL"}`
