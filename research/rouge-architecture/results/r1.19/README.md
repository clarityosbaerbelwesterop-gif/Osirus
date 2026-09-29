# R1.19 result: PARTIAL (pre-registered decision)

**Circuit routing on context: the router sees the token and the sequence so far**

**Run:** GitHub Actions run `36595737022`, commit `0ec2730`.
- 3 models × 3 seeds on free CPU runners (tier 0), 15,000 steps × 64 examples.
- Benchmark: `benchmarks/suite3.py`.
- Full numbers are in `summary.json` and `report.md`.

**Cost:** $0.

**Question:** if the router sees the causal mean of the sequence so far next to the token, does it build task-specific circuits and gain accuracy over token-only routing at equal active compute?

| model | dev | OOD | adversarial | ood.recall | routing.nmi_given_token | routing.min_load | FLOPs / example | stored weights | inference memory | latency | train time |
|---|---|---|---|---|---|---|---|---|---|---|---|
| transformer | 44.3 ± 5.6 | 32.6 ± 4.2 | 41.0 ± 7.1 | 72.7 ± 36.7 | – | – | 22.8 M | 806 KiB | 198 KiB | 0.25 ms | 25 min |
| moe-token | 40.9 ± 3.1 | 30.2 ± 2.9 | 37.8 ± 5.0 | 41.8 ± 30.0 | 0.230 | 0.001 | 23.1 M | 2369 KiB | 198 KiB | 0.38 ms | 34 min |
| moe-context | 41.7 ± 5.7 | 30.4 ± 2.7 | 38.5 ± 7.0 | 40.5 ± 26.4 | 0.292 | 0.000 | 23.3 M | 2377 KiB | 198 KiB | 0.37 ms | 32 min |

(Accuracies are percent, mean ± SD over seeds. FLOPs are executed per example. Inference memory is state plus KV cache for one example.)

| check | left | right (threshold) | holds | difference, 95% interval |
|---|---|---|---|---|
| C1_accuracy | moe-context:dev.all = 41.7 | >= moe-token:dev.all = 40.9 +0.02 → 42.9 | no | +0.8 ± 12.0 |
| C2_circuits | moe-context:routing.nmi_given_token = 0.292 | >= moe-token:routing.nmi_given_token = 0.230 +0.05 → 0.280 | **yes** | +0.061 ± 0.046 (within seed noise) |
| C3_vs_dense | moe-context:dev.all = 41.7 | >= transformer:dev.all = 44.3 +0.02 → 46.3 | no | -2.6 ± 14.7 |

**Statistical power:** 3 seeds. On suite v3 the seed SD of dev accuracy is often 4–6 points, so the 95% interval of a difference is often ±9–14 points. A gate that holds on the means but inside that interval is marked *within seed noise* below: the pre-registered decision stands, but it is provisional.

## What was learned

1. **Context routing builds more task-specific circuits (C2 holds).**
   - Token-conditioned task-expert NMI is 0.292 vs 0.230 for token routing.
   - At initialisation it is 0.08 vs 0.04, so this is learned structure, not a measurement artefact (the R1.04 lesson).
2. **The circuits do not buy accuracy.**
   - Context routing gains only +0.8 over token routing (C1 fails).
   - Both MoE models are below the dense Transformer (41.7 / 40.9 vs 44.3) while storing 2.9× the bytes (2.37 MB vs 806 KiB) at the same executed FLOPs.
   - OOD recall drops to 41–42 (Transformer 73).
3. **Some experts die.** The minimum expert load after training is 0.000–0.001, against 0.006–0.02 at initialisation. A balance weight of 0.01 does not keep all 8 experts alive.
4. **Gating consequences:**
   - With R1.04 PARTIAL and no accuracy gain here, R1.18 (sparse expert cells) stays gated.
   - R1.23 (100M sparse) is not earned.
   - What is earned is the kernel result of R1.22 (sparse dispatch is 3.3× faster than same-parameter dense), which matters only once sparsity pays in accuracy.
