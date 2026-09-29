# R1.35 result: FAIL (pre-registered decision)

**Multiple internal hypotheses (+ R1.37 verifier head, R1.38 selection among hypotheses)**

**Run:** GitHub Actions run `36595777770`, commit `0ec2730`.
- 2 models × 3 seeds on free CPU runners (tier 0), 15,000 steps × 64 examples.
- Benchmark: `benchmarks/suite3.py`.
- Full numbers are in `summary.json` and `report.md`.

**Cost:** $0.

**Question:** does keeping 4 hypothesis heads with a learned score reduce confident wrong answers compared with one head? Does an independently trained verifier head predict correctness better than the model's own confidence (R1.37), and does picking the verifier's preferred hypothesis beat the model's own pick (R1.38)?

| model | dev | OOD | adversarial | dev.cal.confident_error_rate | dev.cal.auroc_confidence | FLOPs / example | stored weights | inference memory | latency | train time |
|---|---|---|---|---|---|---|---|---|---|---|
| transformer | 44.8 ± 4.7 | 33.0 ± 3.6 | 42.1 ± 5.6 | 0.3 ± 0.2 | 0.861 | 22.8 M | 806 KiB | 198 KiB | 0.24 ms | 23 min |
| hyp4 | 41.9 ± 4.5 | 32.1 ± 3.3 | 39.9 ± 5.2 | 3.0 ± 0.6 | 0.842 | 22.9 M | 888 KiB | 198 KiB | 0.27 ms | 25 min |

(Accuracies are percent, mean ± SD over seeds. FLOPs are executed per example. Inference memory is state plus KV cache for one example.)

| check | left | right (threshold) | holds | difference, 95% interval |
|---|---|---|---|---|
| H1_fewer_confident_errors | hyp4:dev.cal.confident_error_rate = 3.0 | <= transformer:dev.cal.confident_error_rate = 0.3 × 0.8 → 0.2 | no |  |
| H2_no_accuracy_loss | hyp4:dev.all = 41.9 | >= transformer:dev.all = 44.8 -0.02 → 42.8 | no | -2.9 ± 12.1 |
| V1_R1_37_verifier_beats_confidence | hyp4:dev.cal.auroc_verifier = 0.842 | >= hyp4:dev.cal.auroc_confidence = 0.842 +0.03 → 0.872 | no | -0.000 ± 0.110 |
| S1_R1_38_verifier_pick | hyp4:var.verifier.dev = 42.8 | >= hyp4:var.own.dev = 41.9 +0.01 → 42.9 | no | +0.8 ± 11.8 |
| S2_R1_38_vs_single | hyp4:var.own.dev = 41.9 | >= hyp4:var.single.dev = 36.5 +0.01 → 37.5 | **yes** | +5.5 ± 12.5 (within seed noise) |

**Statistical power:** 3 seeds. On suite v3 the seed SD of dev accuracy is often 4–6 points, so the 95% interval of a difference is often ±9–14 points. A gate that holds on the means but inside that interval is marked *within seed noise* below: the pre-registered decision stands, but it is provisional.

This run also carries **R1.37** (check V1) and **R1.38** (checks S1, S2).

## What was learned

1. **R1.35 FAIL.** Four hypothesis heads make 10× more confident errors (3.0% vs 0.3%) and lose 2.9 points of dev accuracy.
2. **R1.37 FAIL.** The verifier head's AUROC (0.842) equals the model's own confidence (0.842). Trained on the same features, it learns nothing the softmax does not already know.
3. **R1.38 FAIL.**
   - The verifier's pick beats the model's own pick by only +0.8 (needs +1).
   - The own pick does beat one fixed head of the same model (+5.5, S2), but the plain Transformer (44.8) beats both. Selection among heads repairs a weakness that the multi-head design created.
4. **Hypothesis search inside one forward pass has no independent evidence here.** It is excluded from R1.40 unless new evidence appears.
