Accuracy: mean ± SD over seeds [95% CI, Student t]. Chance is 10%.

| | transformer | rouge-b | rouge-mem |
|---|---|---|---|
| parameters | 205,740 | 211,374 | 217,247 |
| disk (fp32 checkpoint) | 0.84 MB | 0.85 MB | 0.88 MB |
| state memory at 67 tokens | 134 KiB | 4 KiB | 16 KiB |
| FLOPs / example (ID) | 11 M | 100 M | 46 M |
| FLOPs / example (OOD) | 26 M | 100 M | 46 M |
| train wall-clock (CPU) | 18.5 min | 97.5 min | 72.8 min |
| latency / example (CPU, 1 batch) | 0.27 ms | 1.40 ms | 0.92 ms |
| ID all (%) | 58.1 ± 1.3 [54.9, 61.3] | 36.4 ± 1.9 [31.6, 41.3] | 52.9 ± 2.5 [46.7, 59.1] |
| ID state (%) | 26.0 ± 2.2 [20.6, 31.4] | 23.8 ± 2.2 [18.3, 29.3] | 23.3 ± 4.4 [12.5, 34.2] |
| ID hops (%) | 48.4 ± 1.7 [44.3, 52.6] | 49.9 ± 3.0 [42.4, 57.4] | 51.9 ± 1.4 [48.4, 55.3] |
| ID recall (%) | 100.0 ± 0.0 [100.0, 100.0] | 35.7 ± 2.9 [28.4, 42.9] | 83.4 ± 10.0 [58.7, 108.2] |
| OOD all (%) | 53.5 ± 0.5 [52.3, 54.6] | 30.4 ± 1.4 [26.9, 34.0] | 42.4 ± 4.0 [32.5, 52.3] |
| OOD state (%) | 16.0 ± 1.2 [13.0, 19.0] | 19.3 ± 2.8 [12.3, 26.4] | 19.1 ± 3.3 [10.9, 27.3] |
| OOD hops (%) | 47.6 ± 1.6 [43.6, 51.5] | 50.1 ± 3.0 [42.6, 57.6] | 49.9 ± 2.5 [43.6, 56.2] |
| OOD recall (%) | 96.9 ± 1.4 [93.4, 100.3] | 21.9 ± 2.5 [15.7, 28.1] | 58.2 ± 14.7 [21.7, 94.8] |

rouge-b think steps: ID 1.21, OOD 1.21; OOD with 16 think steps: 30.4%.

rouge-mem think steps: ID 2.63, OOD 2.72; OOD with 16 think steps: 42.5%.

Per-seed OOD accuracy:

- transformer: state [0.17, 0.163, 0.147], hops [0.47, 0.463, 0.493], recall [0.98, 0.973, 0.953]
- rouge-b: state [0.167, 0.223, 0.19], hops [0.503, 0.47, 0.53], recall [0.193, 0.243, 0.22]
- rouge-mem: state [0.207, 0.213, 0.153], hops [0.47, 0.51, 0.517], recall [0.683, 0.413, 0.65]

Decision: `{"note": "R1.01 predictions do not apply to R1.03"}`

| | transformer | rouge-b | rouge-mem |
|---|---|---|---|
| probe fact_present_id (%), trained / untrained | 59.1 / 59.7 | 58.1 / 50.0 | 84.1 / 90.2 |
| probe fact_present_ood (%), trained / untrained | 53.5 / 53.4 | 54.6 / 50.0 | 73.3 / 82.2 |
| probe state_halfway_id (%), trained / untrained | 10.7 / 11.2 | 10.6 / 13.2 | 10.8 / 9.9 |
| probe state_halfway_ood (%), trained / untrained | 10.4 / 12.3 | 9.3 / 13.3 | 11.1 / 11.3 |
| probe first_hop_id (%), trained / untrained | 8.2 / 20.1 | 15.0 / 4.4 | 21.6 / 25.9 |
| probe first_hop_ood (%), trained / untrained | 3.4 / 5.3 | 7.0 / 3.1 | 6.1 / 6.4 |
| ECE id | 0.020 | 0.034 | 0.029 |
| ECE ood | 0.051 | 0.043 | 0.050 |
| recall, 2 facts: acc % (memory); value-guess floor 51% | 100.0 (14 KiB) | 55.3 (4 KiB) | 97.5 (16 KiB) |
| recall, 6 facts: acc % (memory); value-guess floor 32% | 100.0 (30 KiB) | 37.3 (4 KiB) | 88.2 (16 KiB) |
| recall, 10 facts: acc % (memory); value-guess floor 25% | 100.0 (46 KiB) | 23.8 (4 KiB) | 73.3 (16 KiB) |
| recall, 14 facts: acc % (memory); value-guess floor 27% | 99.7 (62 KiB) | 24.8 (4 KiB) | 61.7 (16 KiB) |
| recall, 20 facts: acc % (memory); value-guess floor 22% | 91.0 (86 KiB) | 17.2 (4 KiB) | 50.5 (16 KiB) |
| recall, 26 facts: acc % (memory); value-guess floor 18% | 76.0 (110 KiB) | 14.7 (4 KiB) | 47.8 (16 KiB) |

R1.03 decision: `{"complete": true, "roles": {"candidate": "rouge-mem", "state_only": "rouge-b", "baseline": "transformer"}, "checks": {"M1_recall": false, "M1_recall_gain_only": true, "M2_no_regression": true, "M3_facts_probe": false}, "result": "PARTIAL"}`
