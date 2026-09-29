Mean ± SD over seeds; 95% CIs are in summary.json.

| | transformer | transformer-flops | loop-fixed | loop-act | loop-act-warm | loop-ponder |
|---|---|---|---|---|---|---|
| parameters | 117,064 | 902,632 | 120,041 | 120,041 | 120,041 | 120,041 |
| FLOPs / example (ID) | 23.2 M | 185.8 M | 185.8 M | 68.5 M | 83.3 M | 119.7 M |
| FLOPs / example (OOD) | 23.2 M | 185.8 M | 185.8 M | 69.4 M | 82.8 M | 113.4 M |
| activation memory (one input) | 158 KiB at 105 tokens | 630 KiB at 105 tokens | 118 KiB at 105 tokens | 118 KiB at 105 tokens | 118 KiB at 105 tokens | 118 KiB at 105 tokens |
| train wall-clock | 33.1 min | 130.7 min | 133.3 min | 60.0 min | 81.3 min | 176.4 min |
| latency / example (CPU) | 0.67 ms | 3.03 ms | 2.96 ms | 1.62 ms | 2.01 ms | 4.00 ms |
| ID accuracy (%) | 48.7 ± 3.7 | 49.8 ± 0.6 | 49.9 ± 1.5 | 48.5 ± 2.6 | 49.0 ± 1.2 | 48.2 ± 0.1 |
| OOD accuracy (%) | 49.2 ± 5.7 | 49.6 ± 2.7 | 51.6 ± 2.6 | 45.8 ± 0.1 | 47.2 ± 3.5 | 42.3 ± 2.6 |
| Spearman rho(depth, steps) | 0.00 ± 0.00 | 0.00 ± 0.00 | 0.00 ± 0.00 | 0.05 ± 0.07 | -0.04 ± 0.01 | -0.30 ± 0.06 |
| depth 1: accuracy (%) | 46.2 ± 5.3 | 51.8 ± 3.4 | 50.2 ± 8.0 | 47.3 ± 1.8 | 48.0 ± 6.5 | 46.3 ± 2.1 |
| depth 2: accuracy (%) | 51.2 ± 3.5 | 47.8 ± 3.8 | 48.2 ± 4.3 | 49.2 ± 2.3 | 51.5 ± 6.6 | 49.2 ± 2.3 |
| depth 4: accuracy (%) | 51.5 ± 3.5 | 50.3 ± 2.3 | 52.0 ± 3.0 | 49.5 ± 4.8 | 48.7 ± 1.9 | 48.7 ± 1.6 |
| depth 8: accuracy (%) | 46.0 ± 5.6 | 49.0 ± 2.0 | 49.2 ± 2.3 | 48.2 ± 2.8 | 48.0 ± 3.8 | 48.7 ± 2.8 |
| depth 12: accuracy (%) | 50.2 ± 7.6 | 48.8 ± 1.4 | 54.2 ± 5.0 | 48.3 ± 1.9 | 47.3 ± 3.8 | 48.0 ± 4.3 |
| depth 16: accuracy (%) | 48.3 ± 3.9 | 50.3 ± 5.0 | 49.0 ± 1.8 | 43.3 ± 2.1 | 47.2 ± 3.3 | 36.7 ± 4.1 |
| depth 1: steps | 4.00 | 8.00 | 8.00 | 2.99 | 3.62 | 5.14 |
| depth 2: steps | 4.00 | 8.00 | 8.00 | 2.92 | 3.58 | 5.17 |
| depth 4: steps | 4.00 | 8.00 | 8.00 | 2.96 | 3.58 | 5.16 |
| depth 8: steps | 4.00 | 8.00 | 8.00 | 2.94 | 3.56 | 5.14 |
| depth 12: steps | 4.00 | 8.00 | 8.00 | 2.95 | 3.59 | 5.17 |
| depth 16: steps | 4.00 | 8.00 | 8.00 | 3.03 | 3.54 | 4.59 |

Terminal-guess baseline: ID 50.0%, OOD 50.0%.

Decision: `{"complete": true, "result": "INCONCLUSIVE", "reason": "no model beat the terminal-guess baseline by 0.2"}`
