# R1.03 result: PARTIAL (pre-registered decision)

**Runs:**
- GitHub Actions run `36562646785`, commit `825ea1b`.
- 3 models × 3 seeds on free CPU runners, 15,000 steps × 64 examples each.
- Benchmark: `benchmarks/microbench2.py` (hops without the length cue).

`summary.json` and `report.md` are in this folder. The runs are recorded in `experiments/registry.json`.

**Cost:** $0.

## Question

Does a small active state plus a constant-size exact memory close the recall gap to a Transformer? The memory design:
- 4 slots of 112 dims of active state, plus 32 exact slots;
- each token writes one slot;
- each thinking step reads the top 2 slots.

The target was to close the gap at ≤ 1/4 of the Transformer's KV-cache bytes, without losing state tracking.

## Scorecard

Accuracy is given as mean ± SD over 3 seeds, with the 95% CI in brackets. Parameters are matched within 6%.

|                                  | transformer                 | rouge-b (state only)        | rouge-mem (state + memory)     |
| -------------------------------- | --------------------------- | --------------------------- | ------------------------------ |
| parameters                       | 205,740                     | 211,374                     | 217,247                        |
| inference memory at 67 tokens    | 134 KiB (grows)             | **4 KiB**                   | 16 KiB (constant)              |
| FLOPs / example (ID / OOD)       | **11 M / 26 M**             | 100 M / 100 M               | 46 M / 46 M                    |
| train time (CPU)                 | **18.5 min**                | 97.5 min                    | 72.8 min                       |
| ID recall                        | **100.0 ± 0.0**             | 35.7 ± 2.9                  | 83.4 ± 10.0 [58.7, 100]        |
| OOD recall (14–20 facts)         | **96.9 ± 1.4**              | 21.9 ± 2.5 [15.7, 28.1]     | 58.2 ± 14.7 [21.7, 94.8]       |
| OOD state                        | 16.0 ± 1.2                  | **19.3 ± 2.8**              | 19.1 ± 3.3                     |
| OOD hops (50% guess)             | 47.6 ± 1.6                  | 50.1 ± 3.0                  | 49.9 ± 2.5                     |
| OOD all                          | **53.5 ± 0.5**              | 30.4 ± 1.4                  | 42.4 ± 4.0                     |
| think steps, recall OOD          | –                           | 1.0                         | **4.4**                        |
| ECE (ID / OOD)                   | 0.020 / 0.051               | 0.034 / 0.043               | 0.029 / 0.050                  |

**Per-seed OOD recall for rouge-mem:** 68.3 / 41.3 / 65.0. It beats rouge-b (19.3 / 24.3 / 22.0) in every seed.

**Recall by number of facts:** accuracy, then inference memory. The value-guess floor is what "answer with the most common value in the context" scores.

| facts | value-guess floor | transformer   | rouge-b     | rouge-mem       |
| ----- | ----------------- | ------------- | ----------- | --------------- |
| 2     | 51%               | 100 (14 KiB)  | 55 (4 KiB)  | 98 (16 KiB)     |
| 10    | 25%               | 100 (46 KiB)  | 24 (4 KiB)  | 73 (16 KiB)     |
| 20    | 22%               | 91 (86 KiB)   | 17 (4 KiB)  | 51 (16 KiB)     |
| 26    | 18%               | 76 (110 KiB)  | 15 (4 KiB)  | 48 (16 KiB)     |

At 26 facts (beyond training) rouge-mem uses 0.15× the Transformer's memory and keeps 63% of its recall.

## Predictions

| Prediction | Result | Evidence |
| --- | --- | --- |
| M1: OOD recall ≥ rouge-b + 10 points, ≥ Transformer − 2 points, at ≤ 0.25× memory | **no** | +36.3 over rouge-b and 0.15× memory, but 38.7 points below the Transformer |
| M1 (gain only): ≥ rouge-b + 10 points | **yes** | 58.2 vs 21.9 OOD; 83.4 vs 35.7 ID |
| M2: state and hops not worse than rouge-b − 2 points | **yes** | state 19.1 vs 19.3; hops 49.9 vs 50.1 |
| M3: facts probe ≥ rouge-b and above the untrained model | **no** | 73.3 trained vs 82.2 untrained (not gating) |

Decision rule: PASS = M1 and M2; PARTIAL = the recall gain without the rest. **PARTIAL.**

## What was learned

1. **A 16 KiB constant memory fixes most of the recall collapse.**
   - OOD recall almost triples (21.9% → 58.2%), and ID recall rises from 35.7% to 83.4%.
   - Every seed improves, and state tracking is unchanged.
   - It also halves the FLOPs, because the active state is smaller (46 M vs 100 M per example).
   - It is still far from the Transformer's exact recall (97%), and seed variance is high (41–68%). One seed learned the write/read mechanism much less well.
2. **Halting started to allocate compute once thinking had something to do.**
   - With the memory, the ACT halting that collapsed to about 1 step in R1.01, R1.01b and rouge-b now uses about 4.4 steps on recall.
   - Averaged over all tasks it uses 2.6 steps.
   - Thinking steps are now memory reads, so extra compute pays off. The earlier "halting collapse" was partly "nothing useful to compute".
   - This observation was not pre-registered. It is noted as a lead for the combined model, not as a result.
3. **What linear probes find:**
   - **Facts:** "is key x stored" is readable from rouge-mem's memory (73% balanced accuracy OOD). An untrained memory scores higher (82%), so training re-codes the slots for retrieval rather than for linear readout.
   - **Intermediate results:** no model encodes them linearly, neither the value half-way through a state chain nor the first hop (all near chance).
   - **Uncertainty:** all models are well calibrated (ECE ≤ 0.05).
   - **Goals and causal relations:** not tested; no task in this benchmark has them.
4. **The state-tracking advantage is small and fragile.**
   - Rouge leads the Transformer on OOD state by +3.3 points here, and by +5.5 in R1.01b. The means are consistently positive, but the CIs overlap and the absolute level is low (16–26%).
5. **Hops v2 is unsolved by every model.** All sit at the 50% guess level at this budget, so the cue-free version is a harder test than v1 suggested.

## Next

- **Candidate component:** the two-level memory is kept for the combined model, since it is a PARTIAL with a large, all-seed recall gain.
- **Before any combination:**
  - close the gap to exact recall with more slots, better write addressing, or a sparse exact KV of recent tokens (R1.11 hybrid);
  - reduce seed variance.
- **Combining halting and memory** waits for R1.02b's independent evidence on halting.
