# R1.39 result: FAIL (pre-registered decision)

**Verifiable training: learning program execution from executor rewards only**

**Run:** GitHub Actions run `36595784457`, commit `0ec2730`.
- 4 models × 3 seeds on free CPU runners (tier 0), 15,000 steps × 64 examples.
- Benchmark: `benchmarks/programs.py`.
- Full numbers are in `summary.json` and `report.md`.

**Cost:** $0.

**Question:** trained only on the executor's right/wrong signal for its own sampled answer (no answer labels, no self-grading), how close do a Transformer and the step-aligned latent program model get to their supervised versions?

| model | dev | OOD | adversarial | ood.trace | ood.chain | FLOPs / example | stored weights | inference memory | latency | train time |
|---|---|---|---|---|---|---|---|---|---|---|
| transformer-sup | 46.6 ± 7.2 | 32.4 ± 2.8 | 44.3 ± 10.0 | 47.8 ± 5.9 | 17.0 ± 1.8 | 9.1 M | 806 KiB | 70 KiB | 0.15 ms | 10 min |
| transformer-rl | 15.8 ± 1.9 | 15.2 ± 1.0 | 10.2 ± 2.8 | 14.0 ± 3.0 | 16.3 ± 1.3 | 9.1 M | 806 KiB | 70 KiB | 0.20 ms | 12 min |
| exec-sup | 43.2 ± 7.0 | 26.8 ± 3.0 | 45.5 ± 7.8 | 30.5 ± 3.3 | 23.0 ± 3.0 | 72.5 M | 825 KiB | 35 KiB | 0.64 ms | 47 min |
| exec-rl | 14.8 ± 0.6 | 15.1 ± 0.8 | 8.5 ± 1.0 | 13.2 ± 1.4 | 17.0 ± 1.3 | 72.5 M | 825 KiB | 35 KiB | 0.53 ms | 41 min |

(Accuracies are percent, mean ± SD over seeds. FLOPs are executed per example. Inference memory is state plus KV cache for one example.)

| check | left | right (threshold) | holds | difference, 95% interval |
|---|---|---|---|---|
| R1_exec_rl_id | exec-rl:dev.all = 14.8 | >= exec-sup:dev.all = 43.2 × 0.8 → 34.5 | no |  |
| R2_exec_rl_ood | exec-rl:ood.all = 15.1 | >= exec-sup:ood.all = 26.8 × 0.8 → 21.4 | no |  |
| R3_exec_vs_transformer_rl | exec-rl:ood.all = 15.1 | >= transformer-rl:ood.all = 15.2 +0.05 → 20.2 | no | -0.1 ± 2.4 |
| R4_learned_at_all | exec-rl:dev.all = 14.8 | >= value → 20.0 | no |  |

**Statistical power:** 3 seeds. On suite v3 the seed SD of dev accuracy is often 4–6 points, so the 95% interval of a difference is often ±9–14 points. A gate that holds on the means but inside that interval is marked *within seed noise* below: the pre-registered decision stands, but it is provisional.

## What was learned

1. **Reward-only training from scratch did not learn.**
   - Both models end at 15–16% dev. That is at the cue floor (16.3 / 16.7) and barely above the 10% chance the pre-registration names.
   - The supervised versions reach 43–47.
2. **Confidence collapses under REINFORCE.** 19–24% of answers are confident errors (supervised: under 1%).
3. **This matches practice.** Verifiable-reward RL works as *fine-tuning* of a model that already solves some cases, so that it sees non-zero reward; it does not work from scratch with a sparse reward.
4. **Next (pre-registered separately):** R1.39b starts reward-only fine-tuning from the supervised checkpoint and measures whether OOD execution improves without labels.
