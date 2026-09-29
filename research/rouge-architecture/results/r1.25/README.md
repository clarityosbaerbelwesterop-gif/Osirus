# R1.25 result: FAIL (pre-registered decision)

**Generated weights: a per-input low-rank delta from a small hypernetwork**

**Run:** GitHub Actions run `36595748698`, commit `0ec2730`.
- 3 models × 3 seeds on free CPU runners (tier 0), 15,000 steps × 64 examples.
- Benchmark: `benchmarks/suite3.py`.
- Full numbers are in `summary.json` and `report.md`.

**Cost:** $0.

**Question:** does generating a rank-2 MLP delta per input (W0 + U(c)V(c)) beat a dense model with the same stored bytes?

| model | dev | OOD | adversarial | FLOPs / example | stored weights | inference memory | latency | train time |
|---|---|---|---|---|---|---|---|---|
| dense | 44.5 ± 4.4 | 33.1 ± 3.7 | 42.6 ± 4.0 | 22.8 M | 806 KiB | 198 KiB | 0.14 ms | 14 min |
| dense-d80 | 44.7 ± 4.5 | 33.8 ± 3.8 | 42.8 ± 6.9 | 35.6 M | 1247 KiB | 248 KiB | 0.26 ms | 23 min |
| hyper | 33.2 ± 3.3 | 25.1 ± 1.3 | 35.1 ± 5.0 | 23.6 M | 1226 KiB | 198 KiB | 0.22 ms | 23 min |

(Accuracies are percent, mean ± SD over seeds. FLOPs are executed per example. Inference memory is state plus KV cache for one example.)

| check | left | right (threshold) | holds | difference, 95% interval |
|---|---|---|---|---|
| G1 | hyper:dev.all = 33.2 | >= dense-d80:dev.all = 44.7 +0.02 → 46.7 | no | -11.5 ± 10.3 |
| G2 | hyper:dev.all = 33.2 | >= dense-d80:dev.all = 44.7 -0.02 → 42.7 | no | -11.5 ± 10.3 |

**Statistical power:** 3 seeds. On suite v3 the seed SD of dev accuracy is often 4–6 points, so the 95% interval of a difference is often ±9–14 points. A gate that holds on the means but inside that interval is marked *within seed noise* below: the pre-registered decision stands, but it is provisional.

## What was learned

1. **The per-input generated delta hurts.**
   - hyper scores 33.2 dev, against 44.7 for the byte-matched dense model (d=80, 1.25 MB).
   - It also loses to the plain d=64 model that hyper extends (44.5).
   - The loss is −11.5 ± 10.3 points, outside seed noise.
2. **Rejected in this form.** Input-conditioned weights add a second, unstable path that the small model does not learn to use at this data scale.
