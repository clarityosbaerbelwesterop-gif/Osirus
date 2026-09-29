# Rouge scorecard: R1.13

Mean ± SD over seeds (95% CIs in summary.json). Accuracy in %.

## Capability

| | transformer-w32 | rouge-mem | rouge-forget |
|---|---|---|---|
| **dev all** | 43.1 ± 13.6 | 52.3 ± 25.5 | 29.4 ± 0.4 |
| **holdout all** | 41.0 ± 13.8 | 50.6 ± 25.3 | 28.5 ± 1.0 |
| **ood all** | 14.0 ± 1.9 | 36.4 ± 26.2 | 19.1 ± 1.4 |
| **adv all** | 34.0 ± 15.6 | 47.0 ± 28.4 | 22.4 ± 1.1 |
| retain: dev / ood (cue floor 17) | 39 / 11 | 50 / 40 | 33 / 32 |
| overwrite: dev / ood (cue floor 20) | 58 / 14 | 55 / 39 | 29 / 6 |
| saturate: dev / ood (cue floor 31) | 32 / 17 | 51 / 30 | 26 / 19 |

## Cost

| | transformer-w32 | rouge-mem | rouge-forget |
|---|---|---|---|
| parameters (physical) | 206,256 | 230,691 | 243,348 |
| parameters (active) | 206,256 | 230,691 | 243,348 |
| stored weight bytes | 806 KiB | 901 KiB | 951 KiB |
| inference FLOPs / example | 42.1 M | 176.2 M | 176.5 M |
| training FLOPs (3x fwd x examples) | 8.08e+13 | 3.38e+14 | 3.39e+14 |
| persistent state bytes | 0.0 KiB | 15.8 KiB | 15.8 KiB |
| KV / context bytes (longest OOD input) | 64.0 KiB | 0.0 KiB | 0.0 KiB |
| peak RAM (process RSS, incl. torch) | 740 MB | 903 MB | 1115 MB |
| latency / example (CPU) | 0.65 ms | 2.65 ms | 1.98 ms |
| training time | 31.4 min | 138.0 min | 124.0 min |
| energy proxy (CPU-core-seconds) | 7525 | 33108 | 29766 |
| sample efficiency (mean probe accuracy) | 35.8 | 50.5 | 27.6 |

## Decision

`{"complete": true, "checks": {"F1_overwrite": false, "F2_saturate": false, "F3_retain_kept": false}, "result": "FAIL"}`
