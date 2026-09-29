# Rouge scorecard: R1.39

Mean ± SD over seeds (95% CIs in summary.json). Accuracy in %.

## Capability

| | transformer-sup | transformer-rl | exec-sup | exec-rl |
|---|---|---|---|---|
| **dev all** | 46.6 ± 7.2 | 15.8 ± 1.9 | 43.2 ± 7.0 | 14.8 ± 0.6 |
| **holdout all** | 47.0 ± 8.0 | 18.4 ± 1.2 | 47.2 ± 6.3 | 14.4 ± 1.5 |
| **ood all** | 32.4 ± 2.8 | 15.2 ± 1.0 | 26.8 ± 3.0 | 15.1 ± 0.8 |
| **adv all** | 44.3 ± 10.0 | 10.2 ± 2.8 | 45.5 ± 7.8 | 8.5 ± 1.0 |
| trace: dev / ood (cue floor 16) | 62 / 48 | 16 / 14 | 57 / 30 | 14 / 13 |
| chain: dev / ood (cue floor 17) | 31 / 17 | 16 / 16 | 30 / 23 | 16 / 17 |

## Cost

| | transformer-sup | transformer-rl | exec-sup | exec-rl |
|---|---|---|---|---|
| parameters (physical) | 206,256 | 206,256 | 211,120 | 211,120 |
| parameters (active) | 206,256 | 206,256 | 211,120 | 211,120 |
| stored weight bytes | 806 KiB | 806 KiB | 825 KiB | 825 KiB |
| inference FLOPs / example | 9.1 M | 9.1 M | 72.5 M | 72.5 M |
| training FLOPs (3x fwd x examples) | 2.61e+13 | 2.61e+13 | 2.09e+14 | 2.09e+14 |
| persistent state bytes | 0.0 KiB | 0.0 KiB | 0.0 KiB | 0.0 KiB |
| KV / context bytes (longest OOD input) | 70.0 KiB | 70.0 KiB | 35.0 KiB | 35.0 KiB |
| peak RAM (process RSS, incl. torch) | 378 MB | 366 MB | 509 MB | 521 MB |
| latency / example (CPU) | 0.15 ms | 0.20 ms | 0.64 ms | 0.53 ms |
| training time | 10.1 min | 12.1 min | 46.5 min | 40.8 min |
| energy proxy (CPU-core-seconds) | 2419 | 2906 | 11161 | 9795 |
| sample efficiency (mean probe accuracy) | 37.9 | 17.6 | 36.0 | 21.6 |

## Decision

`{"complete": true, "checks": {"R1_exec_rl_id": false, "R2_exec_rl_ood": false, "R3_exec_vs_transformer_rl": false, "R4_learned_at_all": false}, "result": "FAIL"}`
