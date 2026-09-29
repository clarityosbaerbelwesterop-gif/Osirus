# R1.01b result: FAIL (pre-registered decision)

**Runs:**
- Training: GitHub Actions run `36547600972`, commit `6c1003b`. 4 models × 3 seeds on free CPU runners, 15,000 steps × 64 examples each.
- Report with seed statistics: run `36560367230`.
- `summary.json` and `report.md` are in this folder. Every run is recorded in `experiments/registry.json` with its code SHA, dataset hash, checkpoint sha256 and metrics.

**Cost:** $0. The 12 jobs used about 11.8 runner-hours of free CPU.

**Decision:** the pre-registration (`experiments/r1_01b.json`) defines only ADVANCE and FAIL; there is no PARTIAL. The result is **FAIL**.

## Scorecard

Accuracy is given as mean ± SD over 3 seeds, with the 95% CI (Student t) in brackets. Chance is 10%.

|                         | transformer            | transformer-flops     | rouge (R1.01 prototype) | rouge-b (repaired)     |
| ----------------------- | ---------------------- | --------------------- | ----------------------- | ---------------------- |
| parameters              | 205,740                | 1,796,780             | 211,373                 | 211,374                |
| state / KV at 67 tokens | 134 KiB                | 402 KiB               | **4 KiB**               | **4 KiB**              |
| FLOPs / example (ID)    | **11 M**               | 96 M                  | 99 M                    | 99 M                   |
| FLOPs / example (OOD)   | **26 M**               | 230 M                 | 99 M                    | 99 M                   |
| train time (CPU, mean)  | **12.7 min**           | 59.2 min              | 95.1 min                | 68.4 min               |
| latency / example       | **0.16 ms**            | 0.84 ms               | 1.35 ms                 | 0.88 ms                |
| ID all                  | **56.8 ± 1.1** [54.1, 59.5] | 33.4 ± 1.7       | 37.9 ± 0.9              | 37.6 ± 1.0             |
| ID state                | 24.1 ± 1.0             | 16.8 ± 0.2            | **30.8 ± 1.4** [27.3, 34.2] | 28.4 ± 1.1         |
| ID hops                 | 46.3 ± 2.3             | 46.9 ± 4.1            | 44.3 ± 2.7              | 44.2 ± 0.7             |
| ID recall (fact recall) | **100.0 ± 0.0**        | 36.6 ± 1.7            | 38.7 ± 1.2              | 40.0 ± 2.0             |
| OOD all                 | **51.5 ± 2.1** [46.3, 56.8] | 24.6 ± 0.4       | 30.2 ± 0.8              | 29.4 ± 0.6 [27.9, 30.9] |
| OOD state (long state)  | 17.1 ± 0.7 [15.4, 18.8] | 15.0 ± 1.2           | **25.2 ± 3.6** [16.4, 34.1] | 22.6 ± 2.8 [15.6, 29.5] |
| OOD hops                | 40.7 ± 4.4             | 40.9 ± 3.3            | 42.1 ± 1.6              | 42.8 ± 2.4             |
| OOD recall              | **96.8 ± 2.2**         | 18.0 ± 2.3            | 23.3 ± 0.9              | 22.9 ± 1.0             |

**Per-seed OOD state accuracy:**
- transformer: 16.3 / 17.7 / 17.3
- rouge: 23.3 / 23.0 / 29.3
- rouge-b: 24.0 / 24.3 / 19.3

Both Rouge variants are ahead of the Transformer in every seed.

**Average recurrent (think) steps:**
- rouge-b: 1.09 ID, 1.10 OOD.
- rouge: 1.04 ID, 1.02 OOD.

By level, rouge-b uses 1.2 steps at hops 6–8 and 1.0–1.2 on state.

## Predictions

| Prediction | Result | Evidence |
| --- | --- | --- |
| P1: state OOD, rouge-b ≥ Transformer + 20 points, ahead in every seed | **no** | +5.5 points (22.6 vs 17.1). Ahead in every seed, but the 95% CIs overlap |
| P2: hops OOD +10 points, and ρ(hops, steps) ≥ 0.6 | **no** | +2.1 points. ρ = 0.89, but steps only move from 1.0 to 1.2, so the correlation is real and the effect is negligible |
| P3: Transformer ≥ rouge-b on recall | yes | 96.8 vs 22.9 OOD. Much larger than predicted |
| P4: repairs not worse than the prototype, and 16 think steps do not hurt | yes (vacuous) | 29.4 vs 30.2 OOD. Halting stops after about 1 step, so a limit of 16 is never reached |
| P5: beats the FLOP-matched Transformer where P1/P2 hold | yes, not meaningful | The FLOP-matched Transformer is weaker than the small one (see below) |

Decision rule: (P1 and P5 on state) or (P2 and P5 on hops). **FAIL.**

## Deltas vs R1.01 (3,000 steps)

- **Transformer.** OOD all rose from 27.0 to 51.5 and OOD recall from 25.1 to 96.8. The 5× budget was decisive for the baseline: it learned exact recall completely.
- **Rouge (prototype).** OOD all rose from 26.9 to 30.2 and OOD state from 17.4 to 25.2. Recall only moved from 21.6 to 23.3.
- **The repairs had no measurable effect.** rouge-b (input injection, ReZero, ponder warm-up) is within noise of the unrepaired prototype on every metric.
  - Its think steps still collapse to about 1.1.
  - So the collapse does not come from the ponder cost; ACT's weighted-mixture shortcut through the first step remains.
  - R1.02 tests PonderNet, which trains every step's prediction.
- **The gap reversed direction:** in R1.01 Rouge matched the Transformer overall; in R1.01b the Transformer leads by 22 points OOD.

## What was learned

1. **Persistent state helps state tracking, a little and consistently.**
   - Rouge leads the parameter-matched Transformer on long state chains by 5.5–8 points OOD, and on ID state by 4–7 points, in every seed.
   - It does so with a 4 KiB state instead of a 134 KiB KV cache, a 33× difference at 67 tokens that grows with length.
   - The effect is small in absolute terms: 25% against 10% chance.
2. **Exact recall is the binding weakness, and it is capacity, not training.**
   - Given the budget, the Transformer reaches 97–100% recall.
   - The fixed 4 KiB state stays at 23%, both ID and OOD.
   - This is the capacity limit the plan predicted (and *Repeat After Me*, arXiv 2402.01032, reports for fixed-state models).
   - This is exactly R1.03's hypothesis: add a small exact memory without a growing KV cache.
3. **Learned halting did not learn to think.** Both ACT variants stop after about 1 step. Adaptive compute is still unexercised, and R1.02 isolates this question.
4. **The FLOP-matched baseline is weak.**
   - The d = 192 Transformer (8.7× the parameters) learns recall to only 37% ID, while the d = 64 one reaches 100%.
   - The shared learning rate (1e-3) and budget likely do not suit the larger model.
   - So "beats the FLOP-matched Transformer" is not evidence here. Later experiments report both matchings and do not rely on the FLOP-matched model alone.
5. **Cost.** At equal parameters Rouge's per-token read costs 9× the FLOPs of the Transformer and trains 5–7× slower on CPU. The cheaper read (R1.09) remains open.

## Next

Per the brief, R1.01 is not repaired further. Each mechanism is tested on its own:

- **R1.02, learned halting** (running): depth-controlled benchmark; PonderNet, ACT with warm-up, ACT and fixed depth vs matched Transformers.
- **R1.03, state quality and two-level memory:** targets the recall weakness from point 2.
- **R1.04, sparse conditional circuits.**
