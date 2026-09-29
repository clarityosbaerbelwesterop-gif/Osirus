Accuracy: mean ± SD over seeds [95% CI, Student t]. Chance is 10%.

| | transformer | transformer-flops | rouge | rouge-b |
|---|---|---|---|---|
| parameters | 205,740 | 1,796,780 | 211,373 | 211,374 |
| disk (fp32 checkpoint) | 0.84 MB | 7.21 MB | 0.85 MB | 0.85 MB |
| state memory at 67 tokens | 134 KiB | 402 KiB | 4 KiB | 4 KiB |
| FLOPs / example (ID) | 11 M | 96 M | 99 M | 99 M |
| FLOPs / example (OOD) | 26 M | 230 M | 99 M | 99 M |
| train wall-clock (CPU) | 12.7 min | 59.2 min | 95.1 min | 68.4 min |
| latency / example (CPU, 1 batch) | 0.16 ms | 0.84 ms | 1.35 ms | 0.88 ms |
| ID all (%) | 56.8 ± 1.1 [54.1, 59.5] | 33.4 ± 1.7 [29.3, 37.6] | 37.9 ± 0.9 [35.6, 40.2] | 37.6 ± 1.0 [35.1, 40.0] |
| ID state (%) | 24.1 ± 1.0 [21.6, 26.6] | 16.8 ± 0.2 [16.3, 17.3] | 30.8 ± 1.4 [27.3, 34.2] | 28.4 ± 1.1 [25.8, 31.1] |
| ID hops (%) | 46.3 ± 2.3 [40.6, 52.1] | 46.9 ± 4.1 [36.7, 57.1] | 44.3 ± 2.7 [37.6, 51.1] | 44.2 ± 0.7 [42.5, 45.9] |
| ID recall (%) | 100.0 ± 0.0 [100.0, 100.0] | 36.6 ± 1.7 [32.4, 40.7] | 38.7 ± 1.2 [35.8, 41.5] | 40.0 ± 2.0 [35.0, 45.0] |
| OOD all (%) | 51.5 ± 2.1 [46.3, 56.8] | 24.6 ± 0.4 [23.7, 25.5] | 30.2 ± 0.8 [28.3, 32.2] | 29.4 ± 0.6 [27.9, 30.9] |
| OOD state (%) | 17.1 ± 0.7 [15.4, 18.8] | 15.0 ± 1.2 [12.0, 18.0] | 25.2 ± 3.6 [16.4, 34.1] | 22.6 ± 2.8 [15.6, 29.5] |
| OOD hops (%) | 40.7 ± 4.4 [29.7, 51.6] | 40.9 ± 3.3 [32.7, 49.1] | 42.1 ± 1.6 [38.2, 46.0] | 42.8 ± 2.4 [36.9, 48.7] |
| OOD recall (%) | 96.8 ± 2.2 [91.3, 102.3] | 18.0 ± 2.3 [12.3, 23.7] | 23.3 ± 0.9 [21.1, 25.5] | 22.9 ± 1.0 [20.4, 25.4] |

rouge think steps: ID 1.04, OOD 1.02; OOD with 16 think steps: 30.2%.

rouge-b think steps: ID 1.09, OOD 1.10; OOD with 16 think steps: 29.4%.

Per-seed OOD accuracy:

- transformer: state [0.163, 0.177, 0.173], hops [0.373, 0.457, 0.39], recall [0.943, 0.973, 0.987]
- transformer-flops: state [0.14, 0.147, 0.163], hops [0.393, 0.447, 0.387], recall [0.193, 0.153, 0.193]
- rouge: state [0.233, 0.23, 0.293], hops [0.433, 0.427, 0.403], recall [0.223, 0.24, 0.237]
- rouge-b: state [0.24, 0.243, 0.193], hops [0.423, 0.407, 0.453], recall [0.24, 0.22, 0.227]

Decision: `{"complete": true, "roles": {"candidate": "rouge-b", "baseline": "transformer", "baseline_flops": "transformer-flops", "ablation": "rouge"}, "predictions": {"P1_state": false, "P2_hops": false, "P2_hops_rho": 0.893, "P3_recall": true, "P4_vs_ablation": true, "P5_compute_state": true, "P5_compute_hops": true}, "result": "FAIL"}`
