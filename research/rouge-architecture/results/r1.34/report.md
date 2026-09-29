# Rouge scorecard: R1.34

Mean ± SD over seeds (95% CIs in summary.json). Accuracy in %.

## Capability

| | transformer | looped-fixed4 | exec-nohint | exec-hint |
|---|---|---|---|---|
| **dev all** | 42.9 ± 4.4 | 43.8 ± 2.6 | 43.2 ± 7.0 | 41.2 ± 5.8 |
| **holdout all** | 46.7 ± 4.7 | 45.5 ± 4.2 | 43.2 ± 7.6 | 43.0 ± 5.3 |
| **ood all** | 31.9 ± 4.4 | 31.6 ± 4.4 | 26.8 ± 3.0 | 20.8 ± 2.0 |
| **adv all** | 41.5 ± 5.3 | 45.7 ± 7.4 | 45.5 ± 10.0 | 41.8 ± 2.5 |
| trace: dev / ood (cue floor 16) | 55 / 47 | 59 / 43 | 57 / 30 | 51 / 30 |
| chain: dev / ood (cue floor 17) | 31 / 16 | 28 / 20 | 30 / 23 | 32 / 11 |

## Cost

| | transformer | looped-fixed4 | exec-nohint | exec-hint |
|---|---|---|---|---|
| parameters (physical) | 206,256 | 211,120 | 211,120 | 211,120 |
| parameters (active) | 206,256 | 211,120 | 211,120 | 211,120 |
| stored weight bytes | 806 KiB | 825 KiB | 825 KiB | 825 KiB |
| inference FLOPs / example | 9.1 M | 36.2 M | 72.5 M | 72.5 M |
| training FLOPs (3x fwd x examples) | 2.61e+13 | 1.04e+14 | 2.09e+14 | 2.09e+14 |
| persistent state bytes | 0.0 KiB | 0.0 KiB | 0.0 KiB | 0.0 KiB |
| KV / context bytes (longest OOD input) | 70.0 KiB | 35.0 KiB | 35.0 KiB | 35.0 KiB |
| peak RAM (process RSS, incl. torch) | 375 MB | 433 MB | 515 MB | 520 MB |
| latency / example (CPU) | 0.17 ms | 0.42 ms | 0.62 ms | 0.59 ms |
| training time | 10.4 min | 22.7 min | 45.6 min | 43.5 min |
| energy proxy (CPU-core-seconds) | 2504 | 5445 | 10936 | 10433 |
| sample efficiency (mean probe accuracy) | 37.2 | 35.1 | 36.0 | 35.1 |

## Decision

`{"complete": true, "checks": {"X1_vs_transformer": false, "X2_hints_help": false, "X3_R1_33_step_alignment": false}, "result": "FAIL"}`
