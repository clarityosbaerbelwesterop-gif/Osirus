Accuracy: mean ± SD over seeds [95% CI, Student t]. Chance is 10%.

| | transformer | transformer-wide | moe-top2 | moe-top1 |
|---|---|---|---|---|
| parameters | 205,740 | 602,028 | 605,868 | 1,134,252 |
| disk (fp32 checkpoint) | 0.84 MB | 2.43 MB | 2.44 MB | 4.56 MB |
| state memory at 67 tokens | 134 KiB | 134 KiB | 134 KiB | 134 KiB |
| FLOPs / example (ID) | 11 M | 32 M | 11 M | 11 M |
| FLOPs / example (OOD) | 26 M | 77 M | 26 M | 26 M |
| train wall-clock (CPU) | 20.0 min | 54.9 min | 27.5 min | 23.3 min |
| latency / example (CPU, 1 batch) | 0.27 ms | 0.49 ms | 0.40 ms | 0.32 ms |
| ID all (%) | 58.6 ± 1.5 [54.7, 62.4] | 53.0 ± 6.4 [37.1, 68.8] | 58.5 ± 1.3 [55.2, 61.9] | 49.6 ± 10.1 [24.5, 74.7] |
| ID state (%) | 26.9 ± 2.8 [19.8, 33.9] | 22.7 ± 5.5 [9.0, 36.3] | 28.1 ± 0.5 [26.8, 29.4] | 21.7 ± 3.6 [12.7, 30.6] |
| ID hops (%) | 48.8 ± 1.8 [44.2, 53.3] | 49.8 ± 0.2 [49.3, 50.3] | 47.4 ± 3.6 [38.5, 56.4] | 47.4 ± 4.1 [37.3, 57.6] |
| ID recall (%) | 100.0 ± 0.0 [100.0, 100.0] | 86.4 ± 23.5 [28.1, 144.8] | 100.0 ± 0.0 [100.0, 100.0] | 79.6 ± 34.3 [-5.6, 164.7] |
| OOD all (%) | 53.5 ± 0.4 [52.5, 54.6] | 44.6 ± 11.1 [17.0, 72.3] | 54.0 ± 0.4 [52.9, 55.1] | 43.8 ± 11.1 [16.1, 71.5] |
| OOD state (%) | 17.0 ± 0.7 [15.3, 18.7] | 13.7 ± 1.9 [9.1, 18.3] | 15.0 ± 3.0 [7.6, 22.4] | 16.9 ± 1.7 [12.6, 21.1] |
| OOD hops (%) | 46.3 ± 0.7 [44.7, 48.0] | 49.1 ± 1.8 [44.6, 53.7] | 48.7 ± 3.5 [39.9, 57.4] | 48.9 ± 2.1 [43.6, 54.2] |
| OOD recall (%) | 97.2 ± 0.8 [95.1, 99.3] | 71.1 ± 35.9 [-18.1, 160.4] | 98.3 ± 0.6 [96.9, 99.8] | 65.7 ± 36.1 [-24.0, 155.3] |

Per-seed OOD accuracy:

- transformer: state [0.17, 0.163, 0.177], hops [0.47, 0.463, 0.457], recall [0.98, 0.973, 0.963]
- transformer-wide: state [0.133, 0.12, 0.157], hops [0.47, 0.503, 0.5], recall [0.933, 0.903, 0.297]
- moe-top2: state [0.183, 0.127, 0.14], hops [0.45, 0.52, 0.49], recall [0.987, 0.987, 0.977]
- moe-top1: state [0.15, 0.173, 0.183], hops [0.48, 0.513, 0.473], recall [0.927, 0.247, 0.797]

Decision: `{"note": "R1.01 predictions do not apply to R1.04"}`

| | total params | active params | FLOPs/example (ID) | task-expert NMI | NMI given token (trained / init) | router entropy | min expert load |
|---|---|---|---|---|---|---|---|
| transformer | 205,740 | 205,740 | 10.6 M | - | - / - | - | - |
| transformer-wide | 602,028 | 602,028 | 31.9 M | - | - / - | - | - |
| moe-top2 | 605,868 | 208,044 | 10.7 M | 0.271 | 0.316 / 0.061 | 0.706 | 0.010 |
| moe-top1 | 1,134,252 | 207,788 | 10.7 M | 0.127 | 0.239 / 0.069 | 0.996 | 0.035 |

R1.04 decision: `{"complete": true, "roles": {"candidate": "moe-top2", "active_matched": "transformer", "total_matched": "transformer-wide", "secondary": ["moe-top1"]}, "checks": {"S1_vs_active_matched": false, "S2_vs_total_matched": true, "S3_specialisation": false}, "result": "PARTIAL"}`
