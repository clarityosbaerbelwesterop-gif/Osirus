# R1.07 result: PARTIAL (pre-registered decision)

**Runs:**
- GitHub Actions run `36592709577`, commit `994d448`.
- 8 models × 3 seeds on free CPU runners, 15,000 steps × 64 examples each.
- Benchmark v3 (`benchmarks/suite3.py`, audited).
- Full scorecard: `report.md`. Statistics: `summary.json`.

**Cost:** $0.

**Gate:** does the benchmark discriminate?
- It does on 5 of 11 tasks: recall, perm, binding, stack, trace. Discriminating means some model is at least 20 points above the task's cue floor.
- PASS needed 6 tasks, so the decision is **PARTIAL**.

## Scorecard

Mean ± SD over 3 seeds.

| model | params | dev | holdout | OOD | adversarial | OOD recall | FLOPs/ex | state / KV bytes (longest OOD) | train |
|---|---|---|---|---|---|---|---|---|---|
| transformer | 206,256 (206,256 active) | 44.3 ± 5.6 | 46.5 ± 5.3 | 32.6 ± 4.2 | 40.9 ± 6.3 | 71.5 ± 35.5 | 23 M | 0 / 198 KiB | 23 min |
| lstm | 213,520 (213,520 active) | 34.9 ± 0.5 | 35.2 ± 1.0 | 28.7 ± 0.3 | 30.1 ± 1.5 | 25.0 ± 1.3 | 11 M | 2 / 0 KiB | 10 min |
| gru | 210,736 (210,736 active) | 33.9 ± 0.5 | 34.0 ± 0.6 | 28.7 ± 0.5 | 29.4 ± 0.8 | 25.7 ± 1.0 | 23 M | 1 / 0 KiB | 16 min |
| ssm | 206,176 (206,176 active) | 29.5 ± 2.8 | 29.5 ± 3.3 | 26.5 ± 0.8 | 25.2 ± 3.1 | 23.5 ± 0.9 | 22 M | 26 / 0 KiB | 73 min |
| looped | 211,120 (211,120 active) | 48.2 ± 1.3 | 49.3 ± 1.2 | 34.4 ± 1.2 | 45.6 ± 1.0 | 95.5 ± 1.3 | 91 M | 0 / 396 KiB | 38 min |
| moe | 606,384 (208,560 active) | 40.9 ± 3.1 | 42.0 ± 3.7 | 30.2 ± 2.9 | 39.2 ± 5.7 | 41.8 ± 30.0 | 23 M | 0 / 198 KiB | 35 min |
| rouge-mem | 218,147 (218,147 active) | 32.3 ± 1.8 | 32.3 ± 1.8 | 28.0 ± 0.7 | 28.5 ± 3.0 | 56.5 ± 7.2 | 103 M | 16 / 0 KiB | 114 min |
| rouge-mem3 | 230,691 (230,691 active) | 34.4 ± 1.3 | 34.8 ± 1.6 | 31.0 ± 0.8 | 31.8 ± 2.5 | 65.5 ± 16.8 | 105 M | 16 / 0 KiB | 97 min |

## Per task

Dev / OOD accuracy (%); the cue floor is in brackets.

| task (cue floor) | transformer | lstm | gru | ssm | looped | moe | rouge-mem | rouge-mem3 |
|---|---|---|---|---|---|---|---|---|
| state (15) | 17 / 17 | 20 / 18 | 19 / 20 | 16 / 16 | 16 / 16 | 14 / 14 | 16 / 14 | 15 / 16 |
| recall (33) | 81 / 72 | 38 / 25 | 37 / 26 | 42 / 24 | 100 / 96 | 60 / 42 | 83 / 56 | 83 / 65 |
| hops (54) | 46 / 53 | 50 / 56 | 48 / 52 | 52 / 51 | 49 / 42 | 48 / 49 | 46 / 53 | 50 / 51 |
| perm (24) | 50 / 19 | 27 / 21 | 26 / 19 | 22 / 21 | 42 / 16 | 49 / 18 | 20 / 20 | 21 / 22 |
| conn (50) | 47 / 48 | 50 / 48 | 49 / 50 | 48 / 53 | 51 / 54 | 49 / 53 | 51 / 50 | 50 / 48 |
| arith (10) | 10 / 9 | 17 / 8 | 15 / 8 | 9 / 10 | 10 / 10 | 12 / 12 | 9 / 10 | 10 / 11 |
| binding (28) | 65 / 47 | 34 / 34 | 33 / 34 | 37 / 38 | 78 / 38 | 47 / 37 | 35 / 34 | 56 / 51 |
| stack (29) | 92 / 31 | 58 / 39 | 62 / 41 | 35 / 25 | 98 / 35 | 86 / 42 | 25 / 19 | 24 / 18 |
| trace (15) | 36 / 28 | 31 / 24 | 30 / 24 | 25 / 17 | 42 / 36 | 38 / 32 | 20 / 16 | 22 / 21 |
| cf (19) | 12 / 17 | 16 / 19 | 17 / 20 | 16 / 19 | 14 / 19 | 17 / 17 | 15 / 19 | 15 / 20 |
| plan (23) | 30 / 18 | 42 / 24 | 37 / 23 | 23 / 16 | 30 / 18 | 30 / 18 | 34 / 18 | 32 / 17 |

## Predictions

| Prediction | Result |
| --- | --- |
| P1: Transformer ≥ LSTM and ≥ SSM on OOD recall | **yes**: 71.5 vs 25.0 and 23.5. The Transformer's seed variance is large (±35) |
| P2: a recurrent model beats the Transformer on OOD permutation composition by > 5 points | **no**: every model is at the 20% chance level OOD |
| P3: rouge-mem ≥ LSTM on OOD recall | **yes**: 56.5 (65.5 with the 3-token write context) vs 25.0 |
| P4: MoE ≥ Transformer − 2 points (dev) | **no**: 40.9 vs 44.3 |

## What was learned

1. **Six capabilities are unsolved by every model at this scale and budget:** state, hops, graph connectivity, carries, counterfactual state and OOD planning.
   - All models sit at or near the cue floor on them.
   - Benchmark v3 is honest but too hard for about 210k parameters and 15k steps. These tasks need a curriculum, more budget, or step supervision (see R1.34).
2. **The looped Transformer is the strongest baseline:** one shared block run 4 times.
   - Best dev (48.2), holdout (49.3), adversarial (45.6) and OOD recall (95.5 ± 1.3), with every seed stable.
   - It pays for it with 4× the FLOPs of the Transformer and 2× the KV memory.
   - Weight-shared depth is the baseline to beat.
3. **The 3-token write context matters:** rouge-mem3 beats rouge-mem, which is R1.03's exact design.
   - binding 56 vs 35 (dev); OOD recall 65.5 vs 56.5.
   - This confirms that the write at `v` in `k = v` could not see `k`.
4. **Rouge's memory models are weak where the answer depends on order:**
   - stack: 24 vs 92 for the Transformer;
   - loop tracing: 22 vs 36.
   - On exact recall they are close to the Transformer at 16 KiB instead of 198 KiB of context.
5. **The LSTM, GRU and SSM** lose clearly on recall and binding, as the fixed-state literature predicts. The small sequential-scan SSM is the weakest model here.
6. **Generalisation gaps:** stack, binding and perm are learned in distribution (Transformer and looped at 42–98) but collapse at longer lengths (16–42). Length generalisation is the common failure.
