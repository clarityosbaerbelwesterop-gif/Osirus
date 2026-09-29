# Rouge scorecard: R1.07

Mean ± SD over seeds (95% CIs in summary.json). Accuracy in %.

## Capability

| | transformer | lstm | gru | ssm | looped | moe | rouge-mem | rouge-mem3 |
|---|---|---|---|---|---|---|---|---|
| **dev all** | 44.3 ± 5.6 | 34.9 ± 0.5 | 33.9 ± 0.5 | 29.5 ± 2.8 | 48.2 ± 1.3 | 40.9 ± 3.1 | 32.3 ± 1.8 | 34.4 ± 1.3 |
| **holdout all** | 46.5 ± 5.3 | 35.2 ± 1.0 | 34.0 ± 0.6 | 29.5 ± 3.3 | 49.3 ± 1.2 | 42.0 ± 3.7 | 32.3 ± 1.8 | 34.8 ± 1.6 |
| **ood all** | 32.6 ± 4.2 | 28.7 ± 0.3 | 28.7 ± 0.5 | 26.5 ± 0.8 | 34.4 ± 1.2 | 30.2 ± 2.9 | 28.0 ± 0.7 | 31.0 ± 0.8 |
| **adv all** | 40.9 ± 6.3 | 30.1 ± 1.5 | 29.4 ± 0.8 | 25.2 ± 3.1 | 45.6 ± 1.0 | 39.2 ± 5.7 | 28.5 ± 3.0 | 31.8 ± 2.5 |
| state: dev / ood (cue floor 15) | 17 / 17 | 20 / 18 | 19 / 20 | 16 / 16 | 16 / 16 | 14 / 14 | 16 / 14 | 15 / 16 |
| recall: dev / ood (cue floor 33) | 81 / 72 | 38 / 25 | 37 / 26 | 42 / 24 | 100 / 96 | 60 / 42 | 83 / 56 | 83 / 65 |
| hops: dev / ood (cue floor 54) | 46 / 53 | 50 / 56 | 48 / 52 | 52 / 51 | 49 / 42 | 48 / 49 | 46 / 53 | 50 / 51 |
| perm: dev / ood (cue floor 24) | 50 / 19 | 27 / 21 | 26 / 19 | 22 / 21 | 42 / 16 | 49 / 18 | 20 / 20 | 21 / 22 |
| conn: dev / ood (cue floor 50) | 47 / 48 | 50 / 48 | 49 / 50 | 48 / 53 | 51 / 54 | 49 / 53 | 51 / 50 | 50 / 48 |
| arith: dev / ood (cue floor 10) | 10 / 9 | 17 / 8 | 15 / 8 | 9 / 10 | 10 / 10 | 12 / 12 | 9 / 10 | 10 / 11 |
| binding: dev / ood (cue floor 28) | 65 / 47 | 34 / 34 | 33 / 34 | 37 / 38 | 78 / 38 | 47 / 37 | 35 / 34 | 56 / 51 |
| stack: dev / ood (cue floor 29) | 92 / 31 | 58 / 39 | 62 / 41 | 35 / 25 | 98 / 35 | 86 / 42 | 25 / 19 | 24 / 18 |
| trace: dev / ood (cue floor 15) | 36 / 28 | 31 / 24 | 30 / 24 | 25 / 17 | 42 / 36 | 38 / 32 | 20 / 16 | 22 / 21 |
| cf: dev / ood (cue floor 19) | 12 / 17 | 16 / 19 | 17 / 20 | 16 / 19 | 14 / 19 | 17 / 17 | 15 / 19 | 15 / 20 |
| plan: dev / ood (cue floor 23) | 30 / 18 | 42 / 24 | 37 / 23 | 23 / 16 | 30 / 18 | 30 / 18 | 34 / 18 | 32 / 17 |

## Cost

| | transformer | lstm | gru | ssm | looped | moe | rouge-mem | rouge-mem3 |
|---|---|---|---|---|---|---|---|---|
| parameters (physical) | 206,256 | 213,520 | 210,736 | 206,176 | 211,120 | 606,384 | 218,147 | 230,691 |
| parameters (active) | 206,256 | 213,520 | 210,736 | 206,176 | 211,120 | 208,560 | 218,147 | 230,691 |
| stored weight bytes | 806 KiB | 834 KiB | 823 KiB | 805 KiB | 825 KiB | 2369 KiB | 852 KiB | 901 KiB |
| inference FLOPs / example | 22.8 M | 10.5 M | 22.8 M | 21.6 M | 91.2 M | 23.1 M | 103.2 M | 104.6 M |
| training FLOPs (3x fwd x examples) | 6.57e+13 | 3.03e+13 | 6.57e+13 | 6.23e+13 | 2.63e+14 | 6.64e+13 | 2.97e+14 | 3.01e+14 |
| persistent state bytes | 0.0 KiB | 1.8 KiB | 1.0 KiB | 26.0 KiB | 0.0 KiB | 0.0 KiB | 15.8 KiB | 15.8 KiB |
| KV / context bytes (longest OOD input) | 198.0 KiB | 0.0 KiB | 0.0 KiB | 0.0 KiB | 396.0 KiB | 198.0 KiB | 0.0 KiB | 0.0 KiB |
| peak RAM (process RSS, incl. torch) | 469 MB | 406 MB | 448 MB | 1040 MB | 647 MB | 738 MB | 625 MB | 654 MB |
| latency / example (CPU) | 0.25 ms | 0.12 ms | 0.14 ms | 0.48 ms | 0.42 ms | 0.41 ms | 1.11 ms | 0.89 ms |
| training time | 22.9 min | 10.4 min | 16.0 min | 73.1 min | 37.8 min | 34.7 min | 113.9 min | 96.8 min |
| energy proxy (CPU-core-seconds) | 5499 | 2485 | 3839 | 17550 | 9070 | 8319 | 27344 | 23235 |
| sample efficiency (mean probe accuracy) | 35.9 | 29.5 | 31.3 | 23.1 | 38.5 | 32.4 | 29.5 | 29.6 |

## Decision

`{"complete": true, "checks": {"D_state": false, "D_recall": true, "D_hops": false, "D_perm": true, "D_conn": false, "D_arith": false, "D_binding": true, "D_stack": true, "D_trace": true, "D_cf": false, "D_plan": false, "P1_attention_recall": true, "P1b_attention_recall_ssm": true, "P2_recurrent_perm": false, "P3_memory_vs_lstm_recall": true, "P4_moe_not_worse": false}, "result": "PARTIAL"}`
