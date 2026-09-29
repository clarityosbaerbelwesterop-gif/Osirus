# Rouge scorecard: R1.36

Mean ± SD over seeds (95% CIs in summary.json). Accuracy in %.

## Capability

| | active-learned | active-random | active-eig |
|---|---|---|---|
| **dev all** | 75.8 ± 3.3 | 75.3 ± 1.5 | 100.0 ± 0.0 |
| **holdout all** | 76.9 ± 3.3 | 77.6 ± 2.1 | 100.0 ± 0.0 |
| **ood all** | 73.6 ± 2.1 | 77.8 ± 1.4 | 100.0 ± 0.0 |
| **adv all** | 77.8 ± 3.2 | 77.0 ± 0.6 | 100.0 ± 0.0 |
| clues: dev / ood (cue floor 28) | 76 / 74 | 75 / 78 | 100 / 100 |

## Cost

| | active-learned | active-random | active-eig |
|---|---|---|---|
| parameters (physical) | 108,228 | 108,228 | 108,228 |
| parameters (active) | 108,228 | 108,228 | 108,228 |
| stored weight bytes | 423 KiB | 423 KiB | 423 KiB |
| inference FLOPs / example | 5.1 M | 5.1 M | 5.1 M |
| training FLOPs (3x fwd x examples) | 7.91e+12 | 7.91e+12 | 7.91e+12 |
| persistent state bytes | 0.0 KiB | 0.0 KiB | 0.0 KiB |
| KV / context bytes (longest OOD input) | 26.0 KiB | 26.0 KiB | 26.0 KiB |
| peak RAM (process RSS, incl. torch) | 359 MB | 365 MB | 347 MB |
| latency / example (CPU) | 0.11 ms | 0.10 ms | 0.19 ms |
| training time | 3.2 min | 2.9 min | 4.5 min |
| energy proxy (CPU-core-seconds) | 778 | 706 | 1092 |
| sample efficiency (mean probe accuracy) | 75.8 | 71.5 | 100.0 |

## Decision

`{"complete": true, "checks": {"A1_vs_random": false, "A2_near_eig": false, "A3_ood": false}, "result": "FAIL"}`
