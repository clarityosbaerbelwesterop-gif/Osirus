# R1.17 result: FAIL (pre-registered decision)

**Per-token adaptive depth (Mixture-of-Depths, 50% capacity)**

**Run:** GitHub Actions run `36595733271`, commit `0ec2730`.
- 3 models × 3 seeds on free CPU runners (tier 0), 15,000 steps × 64 examples.
- Benchmark: `benchmarks/suite3.py`.
- Full numbers are in `summary.json` and `report.md`.

**Cost:** $0.

**Question:** does routing only half of the positions through each block after the first (Mixture-of-Depths, 50% capacity) keep accuracy at fewer FLOPs, and beat a dense model with the same FLOPs?

| model | dev | OOD | adversarial | ood.recall | FLOPs / example | stored weights | inference memory | latency | train time |
|---|---|---|---|---|---|---|---|---|---|
| transformer | 44.8 ± 4.7 | 32.8 ± 3.5 | 42.7 ± 5.0 | 72.2 ± 36.3 | 22.8 M | 806 KiB | 198 KiB | 0.20 ms | 20 min |
| transformer-d48 | 41.0 ± 4.9 | 30.8 ± 2.6 | 38.4 ± 6.7 | 47.0 ± 33.2 | 12.8 M | 460 KiB | 148 KiB | 0.20 ms | 18 min |
| mod50 | 35.7 ± 0.9 | 26.6 ± 1.0 | 30.3 ± 1.9 | 25.8 ± 1.9 | 14.3 M | 807 KiB | 124 KiB | 0.21 ms | 18 min |

(Accuracies are percent, mean ± SD over seeds. FLOPs are executed per example. Inference memory is state plus KV cache for one example.)

| check | left | right (threshold) | holds | difference, 95% interval |
|---|---|---|---|---|
| M1_acc | mod50:dev.all = 35.7 | >= transformer:dev.all = 44.8 -0.02 → 42.8 | no | -9.2 ± 12.0 |
| M1_flops | mod50:flops = 14.3 M | <= transformer:flops = 22.8 M × 0.7 → 16.0 M | **yes** |  |
| M2_vs_flop_matched | mod50:dev.all = 35.7 | >= transformer-d48:dev.all = 41.0 +0.02 → 43.0 | no | -5.3 ± 12.3 |

**Statistical power:** 3 seeds. On suite v3 the seed SD of dev accuracy is often 4–6 points, so the 95% interval of a difference is often ±9–14 points. A gate that holds on the means but inside that interval is marked *within seed noise* below: the pre-registered decision stands, but it is provisional.

Inference settings of the trained mod50 model:

| setting | dev | OOD | FLOPs / example |
|---|---|---|---|
| routed (50%, as trained) | 35.7 | 26.6 | 14.3 M |
| full (every position in every block) | 30.2 | 23.8 | 22.8 M |

## What was learned

1. **The FLOPs fall as designed (0.63×), but accuracy falls further.**
   - mod50 loses 9.2 points of dev accuracy against the full Transformer.
   - It is 5.3 points below a dense model with fewer FLOPs (d=48, 12.8 M).
2. **Exact recall collapses: OOD recall is 25.8, against 72.2 for the Transformer.** Positions skipped by the router cannot be retrieved by later layers, so recall-style tasks lose exactly what they need.
3. **The router does learn something.** Sending every position through every block at inference makes the model worse (30.2 vs 35.7): it was trained for its own routing.
4. **Per-token adaptive depth is not earned at this scale on suite v3.**
   - Together with R1.02b (halting does not track depth), R1.20 (the knob adds nothing beyond training depth) and R1.21 (early exit saves 6%), no dynamic-compute mechanism has independent PASS evidence.
   - None enters R1.40 as a mechanism. What remains is R1.03's lead: adaptive compute may need useful internal state first.
