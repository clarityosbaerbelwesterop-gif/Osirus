# R1.20 result: PARTIAL (pre-registered decision)

**Think-harder knob: a looped model trained with random depth**

**Run:** GitHub Actions run `36595741098`, commit `0ec2730`.
- 3 models × 3 seeds on free CPU runners (tier 0), 15,000 steps × 64 examples.
- Benchmark: `benchmarks/suite3.py`.
- Full numbers are in `summary.json` and `report.md`.

**Cost:** $0.

**Question:** if a shared block is trained with a random number of iterations (1–8), does test-time depth become a real capability knob (FAST 1, NORMAL 2, DEEP 4, ULTRA 8), and does ULTRA beat a model trained at fixed depth 4?

| model | dev | OOD | adversarial | FLOPs / example | stored weights | inference memory | latency | train time |
|---|---|---|---|---|---|---|---|---|
| transformer | 44.0 ± 5.3 | 32.7 ± 4.3 | 43.2 ± 7.7 | 22.8 M | 806 KiB | 198 KiB | 0.21 ms | 19 min |
| knob | 44.1 ± 4.0 | 28.9 ± 5.0 | 42.9 ± 6.0 | 91.2 M | 825 KiB | 396 KiB | 0.52 ms | 51 min |
| fixed4 | 48.2 ± 0.3 | 35.8 ± 1.3 | 46.9 ± 1.2 | 91.2 M | 825 KiB | 396 KiB | 0.62 ms | 53 min |

(Accuracies are percent, mean ± SD over seeds. FLOPs are executed per example. Inference memory is state plus KV cache for one example.)

| check | left | right (threshold) | holds | difference, 95% interval |
|---|---|---|---|---|
| K1a | knob:var.normal.ood = 26.1 | >= knob:var.fast.ood = 19.8 -0.005 → 19.3 | **yes** | +6.3 ± 8.3 (within seed noise) |
| K1b | knob:var.deep.ood = 28.9 | >= knob:var.normal.ood = 26.1 -0.005 → 25.6 | **yes** | +2.8 ± 11.0 (within seed noise) |
| K1c | knob:var.ultra.ood = 28.8 | >= knob:var.deep.ood = 28.9 -0.005 → 28.4 | **yes** | -0.1 ± 12.9 (within seed noise) |
| K2_ultra_gain | knob:var.ultra.ood = 28.8 | >= fixed4:var.deep.ood = 35.8 +0.02 → 37.8 | no | -7.1 ± 12.7 |
| K3_no_loss | knob:var.deep.dev = 44.1 | >= fixed4:var.deep.dev = 48.2 -0.02 → 46.2 | no | -4.2 ± 10.0 |

**Statistical power:** 3 seeds. On suite v3 the seed SD of dev accuracy is often 4–6 points, so the 95% interval of a difference is often ±9–14 points. A gate that holds on the means but inside that interval is marked *within seed noise* below: the pre-registered decision stands, but it is provisional.

Test-time depth variants (mean over seeds, OOD accuracy):

| model | FAST (1) | NORMAL (2) | DEEP (4) | ULTRA (8) |
|---|---|---|---|---|
| knob (random depth) | 19.8 | 26.1 | 28.9 | 28.8 |
| fixed4 | 16.5 | 23.1 | 35.8 | 31.8 |

## What was learned

1. **Random-depth training gives a monotone dial; fixed-depth training does not.**
   - The fixed-depth model degrades both below and above its training depth.
   - The knob degrades gracefully, but it never gets better beyond 4 steps: ULTRA equals DEEP at 2× the FLOPs.
2. **The dial costs peak quality.**
   - At depth 4 the knob reaches 44.1 dev / 28.9 OOD, against 48.2 / 35.8 for fixed4 (K2 and K3 fail).
3. **fixed4 (a looped block, 4 steps, d=128) is the best model on suite v3 so far.**
   - It scores 48.2 ± 0.3 dev and 35.8 ± 1.3 OOD with very low seed variance.
   - This matches R1.07, where the looped model was strongest, but it costs 4× the Transformer's FLOPs.
4. **The knob is useful as a cost dial (cheap to good), not as "think harder than trained".**
   - Gains beyond the training depth were not found here, nor with step supervision (R1.34).
