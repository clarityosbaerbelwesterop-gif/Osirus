# R1.01 result: FAIL (pre-registered decision)

**Run:** GitHub Actions run `36544467341` (commit `9e7dbcb`).

- 4 models × 3 seeds on free CPU runners, 3,000 steps × 64 examples each.
- Report: run `36547179782`.
- Checkpoints and per-run JSON are CI artifacts (90 days), with the sha256
  of each checkpoint in its JSON.

**Cost:** $0.

## Scorecard (mean of 3 seeds)

|                           | transformer | transformer-flops | rouge     | rouge-fixed |
| ------------------------- | ----------- | ----------------- | --------- | ----------- |
| parameters                | 205,740     | 1,796,780         | 211,373   | 211,373     |
| disk (fp32 checkpoint)    | 0.84 MB     | 7.21 MB           | 0.85 MB   | 0.85 MB     |
| state memory at 67 tokens | 134 KiB     | 402 KiB           | **4 KiB** | 4 KiB       |
| FLOPs / example (ID)      | **11 M**    | 96 M              | 101 M     | 110 M       |
| FLOPs / example (OOD)     | **26 M**    | 230 M             | 101 M     | 244 M       |
| train wall-clock (CPU)    | **3.2 min** | 12.1 min          | 18.6 min  | 19.9 min    |
| latency / example (CPU)   | **0.27 ms** | 0.92 ms           | 1.36 ms   | 1.40 ms     |
| ID all (%)                | **34.4**    | 32.8              | 33.9      | 10.6        |
| ID state (%)              | **18.1**    | 17.6              | 17.6      | 11.3        |
| ID hops (%)               | 46.6        | **48.1**          | 47.0      | 9.3         |
| ID recall (%)             | **38.4**    | 32.8              | 37.2      | 11.0        |
| OOD all (%)               | **27.0**    | 24.0              | 26.9      | 11.7        |
| OOD state (%)             | 14.8        | 16.1              | **17.4**  | 16.0        |
| OOD hops (%)              | 41.1        | 38.8              | **41.6**  | 8.7         |
| OOD recall (%)            | **25.1**    | 17.0              | 21.6      | 10.3        |

Chance level is 10%.

**Per-seed OOD accuracy** (state / hops / recall):

- transformer: [14.3, 15.7, 14.3] / [40.3, 40.0, 43.0] / [25.3, 25.3, 24.7]
- transformer-flops: [13.3, 17.7, 17.3] / [38.3, 40.0, 38.0] / [16.0, 16.7, 18.3]
- rouge: [19.3, 19.7, 13.3] / [43.3, 40.0, 41.3] / [20.0, 22.3, 22.3]
- rouge-fixed: [16.0, 16.0, 16.0] / [8.7, 8.7, 8.7] / [10.3, 10.3, 10.3]

**Rouge think steps:** mean 1.54 (ID) and 1.40 (OOD). They are flat across
difficulty: hops 1→8 all at ≈ 1.9 steps (Spearman ρ = 0.14). Allowing 16
steps at test time changes nothing (26.9%).

## Predictions

| Prediction                                                 | Result        | Evidence                                                                                      |
| ---------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------- |
| P1: state OOD, Rouge ≥ Transformer + 20 points, every seed | **no**        | +2.7 points (17.4 vs 14.8); ahead in 2 of 3 seeds                                             |
| P2: hops OOD, +10 points and depth-dependent thinking      | **no**        | +0.4 points; ρ = 0.14                                                                         |
| P3: Transformer ≥ Rouge on recall                          | yes           | 38.4 vs 37.2 (ID), 25.1 vs 21.6 (OOD). The fixed-size state loses on many facts, as predicted |
| P4: adaptive not worse than fixed thinking                 | yes (vacuous) | `rouge-fixed` never learned                                                                   |
| P5: Rouge ≥ the FLOP-matched Transformer                   | yes           | …but only because the FLOP-matched Transformer is no better than the small one                |

**Decision: FAIL.** The prototype is not scaled.

## Why it failed

1. **Nobody learned the state task.** Every model sits at 17–18% on
   _in-distribution_ state chains, near the 10% chance level.
   - With final-answer-only supervision and 3,000 steps, the benchmark
     cannot separate architectures on the one task P1 was about.
   - The FLOP-matched Transformer, with 8.7× the parameters, was no better
     than the small one.
   - So the limit was the training budget and signal, not capacity.
   - This is a flaw in the experiment, not only in the prototype.
2. **Thinking erased the state.** Repeating the cell with the same input
   contracts different states towards one point. Measured at
   initialisation, the spread between examples fell from 0.45 to 0.42
   after 4 steps and to 0.29 after 16.
   - **`rouge-fixed`**, which must pass through 4 think steps, sat at
     loss 2.30 = ln 10 (pure guessing) for all 3,000 steps in all seeds.
   - **The adaptive model** learned only because ACT's weighted mixture
     gives a shortcut to the first step. It then learned to barely think
     (≈ 1.5 steps).
   - So "adaptive compute" was never exercised.
3. **The read is expensive.** At equal parameters Rouge costs 9.5× the
   FLOPs of the Transformer per example, because every token passes all 8
   slots through the cell. It trains 5.9× slower on CPU.
4. **What held up:**
   - At equal parameters Rouge **matched** the Transformer overall (33.9 vs
     34.4 ID, 26.9 vs 27.0 OOD).
   - It did so with **a constant 4 KiB state instead of a growing KV cache**
     (33× smaller at 67 tokens, and the gap grows with length).
   - It lost on recall, exactly as the capacity argument predicts.

## Next: R1.01b (pre-registered in `experiments/r1_01b.json`)

1. **Budget.** 15,000 steps for every model, so the comparison is no longer
   decided by under-training.
2. **Repairs** in `rouge-b`. All three are known remedies (prior art, not
   novel):
   - input injection: the query is re-fed at every think step, as in
     recurrent-depth models;
   - ReZero-gated recurrence;
   - ponder-cost warm-up.
3. **The original prototype is re-run at the new budget.** That separates
   the effect of the budget from the effect of the repairs.
4. **Still at $0 on CI.**

If R1.01b also fails, the next step is the cheaper-read hybrid (R1.09 and
R1.11): a persistent state plus a small local attention window. Not
scaling.
