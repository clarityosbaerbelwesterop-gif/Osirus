# R1.36 result: FAIL (pre-registered decision)

**Active test selection: which 2 of 4 questions to ask about a hidden target**

**Run:** GitHub Actions run `36595780971`, commit `0ec2730`.
- 3 models × 3 seeds on free CPU runners (tier 0), 8,000 steps × 64 examples.
- Benchmark: `benchmarks/clues.py`.
- Full numbers are in `summary.json` and `report.md`.

**Cost:** $0.

**Question:** given a table of 4 candidates, can the model learn to choose the 2 attribute queries that best discriminate between them, and so answer better than random questions at the same compute?

| model | dev | OOD | adversarial | FLOPs / example | stored weights | inference memory | latency | train time |
|---|---|---|---|---|---|---|---|---|
| active-learned | 75.8 ± 3.3 | 73.6 ± 2.1 | 77.8 ± 3.2 | 5.1 M | 423 KiB | 26 KiB | 0.11 ms | 3 min |
| active-random | 75.3 ± 1.5 | 77.8 ± 1.4 | 77.0 ± 0.6 | 5.1 M | 423 KiB | 26 KiB | 0.10 ms | 3 min |
| active-eig | 100.0 ± 0.0 | 100.0 ± 0.0 | 100.0 ± 0.0 | 5.1 M | 423 KiB | 26 KiB | 0.19 ms | 5 min |

(Accuracies are percent, mean ± SD over seeds. FLOPs are executed per example. Inference memory is state plus KV cache for one example.)

| check | left | right (threshold) | holds | difference, 95% interval |
|---|---|---|---|---|
| A1_vs_random | active-learned:dev.all = 75.8 | >= active-random:dev.all = 75.3 +0.1 → 85.3 | no | +0.5 ± 9.0 |
| A2_near_eig | active-learned:dev.all = 75.8 | >= active-eig:dev.all = 100.0 -0.05 → 95.0 | no | -24.2 ± 8.2 |
| A3_ood | active-learned:ood.all = 73.6 | >= active-random:ood.all = 77.8 +0.1 → 87.8 | no | -4.1 ± 4.6 |

**Statistical power:** 3 seeds. On suite v3 the seed SD of dev accuracy is often 4–6 points, so the 95% interval of a difference is often ±9–14 points. A gate that holds on the means but inside that interval is marked *within seed noise* below: the pre-registered decision stands, but it is provisional.

## What was learned

1. **The learned query policy did not learn:** 75.8 dev, against 75.3 for random queries.
2. **The task is solvable.** The exact expected-information-gain policy, with the same answer-head architecture, scores 100.0 on dev, OOD and adversarial. Two good questions always suffice; the model did not learn to ask them.
3. **OOD the learned policy is below random** (73.6 vs 77.8).
4. **Open.** The straight-through Gumbel choice gives a weak gradient to the first query.
   - A policy gradient on the query choice is the natural next attempt. Imitating the EIG teacher would test learnability, not discovery.
   - Not scheduled before R1.40's inputs are settled.
