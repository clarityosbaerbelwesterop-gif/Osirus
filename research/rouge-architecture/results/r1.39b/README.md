# R1.39b result: FAIL (pre-registered decision)

**Verifiable rewards as fine-tuning: supervised start, then executor rewards only**

**Run:** GitHub Actions run `36649207166`, commit `3a7fabc`.
- 4 models × 3 seeds on free CPU runners (tier 0), 15,000 steps × 64 examples.
- Benchmark: `benchmarks/programs.py`.
- Full numbers are in `summary.json` and `report.md`.

**Cost:** $0.

**Question:** if a model learns from labels for the first third of the steps and then only from the executor's right/wrong signal on its own sampled answers, does it execute programs better out of distribution than the same model trained with labels for all 15,000 steps?

| model | dev | OOD | adversarial | ood.trace | ood.chain | ood.cal.confident_error_rate | FLOPs / example | stored weights | inference memory | latency | train time |
|---|---|---|---|---|---|---|---|---|---|---|---|
| transformer-sup | 46.7 ± 10.4 | 29.7 ± 1.7 | 46.7 ± 12.0 | 42.7 ± 5.2 | 16.7 ± 1.9 | 7.2 ± 9.5 | 9.1 M | 806 KiB | 70 KiB | 0.17 ms | 11 min |
| transformer-sup-rl | 37.6 ± 3.6 | 31.2 ± 2.5 | 36.8 ± 3.7 | 45.0 ± 3.1 | 17.3 ± 3.0 | 15.7 ± 10.5 | 9.1 M | 806 KiB | 70 KiB | 0.18 ms | 11 min |
| exec-sup | 41.4 ± 5.5 | 27.5 ± 3.5 | 41.3 ± 5.2 | 31.5 ± 3.5 | 23.5 ± 3.5 | 9.6 ± 3.6 | 72.5 M | 825 KiB | 35 KiB | 0.60 ms | 44 min |
| exec-sup-rl | 30.5 ± 4.6 | 26.6 ± 3.0 | 31.0 ± 7.4 | 34.3 ± 4.1 | 18.8 ± 2.0 | 28.8 ± 8.8 | 72.5 M | 825 KiB | 35 KiB | 0.55 ms | 40 min |

(Accuracies are percent, mean ± SD over seeds. FLOPs are executed per example. Inference memory is state plus KV cache for one example.)

| check | left | right (threshold) | holds | difference, 95% interval |
|---|---|---|---|---|
| RL1_exec_ood | exec-sup-rl:ood.all = 26.6 | >= exec-sup:ood.all = 27.5 +0.03 → 30.5 | no | -0.9 ± 8.4 |
| RL2_transformer_ood | transformer-sup-rl:ood.all = 31.2 | >= transformer-sup:ood.all = 29.7 +0.03 → 32.7 | no | +1.5 ± 5.5 |
| RL3_no_id_loss | exec-sup-rl:dev.all = 30.5 | >= exec-sup:dev.all = 41.4 -0.02 → 39.4 | no | -10.9 ± 13.1 |
| RL4_calibration | exec-sup-rl:ood.cal.confident_error_rate = 28.8 | <= exec-sup:ood.cal.confident_error_rate = 9.6 × 1.5 → 14.4 | no |  |

**Statistical power:** 3 seeds. On suite v3 the seed SD of dev accuracy is often 4–6 points, so the 95% interval of a difference is often ±9–14 points. A gate that holds on the means but inside that interval is marked *within seed noise* below: the pre-registered decision stands, but it is provisional.

## What was learned

1. **Rewards after a supervised start do not improve out-of-distribution execution.**
   - Latent program model: 26.6 OOD, against 27.5 with labels throughout.
   - Transformer: 31.2 against 29.7 (+1.5 ± 5.5, below the +3 needed).
2. **The reward phase costs in-distribution accuracy.**
   - Latent program model: −10.9 points dev (30.5 vs 41.4).
   - Transformer: −9.1 points (37.6 vs 46.7).
   - Continued supervision is simply the better use of the remaining 10,000 steps at this scale.
3. **Calibration degrades, as in R1.39.** Confident errors out of distribution triple for the latent program model: 28.8% vs 9.6% (RL4 fails).
4. **Reproducibility note.** The supervised baselines repeat R1.39's configurations and seeds, but they are not bit-identical:
   - exec-sup scores 41.4 ± 5.5 dev here, against 43.2 ± 7.0 in R1.39;
   - transformer-sup scores 46.7 vs 46.6;
   - the likely cause is multi-threaded CPU reductions on different runner hardware.
   R1.13 did reproduce R1.12 exactly, so determinism holds only on identical hardware. Replications are compared through their seed intervals, not bit for bit (this corrects the note in R1.14b's pre-registration).
5. **Verifiable-reward training has no independent evidence in Rouge's recipe at this scale.** Together with R1.39 (from scratch), it stays out of R1.40.
