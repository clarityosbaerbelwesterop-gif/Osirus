# R1.10 result: PARTIAL (pre-registered decision)

**Runs:**
- GitHub Actions run `36592864385`, commit `994d448`.
- rouge-mem (3-token write context) with 8, 16, 32 and 64 exact memory slots, plus the Transformer.
- 3 seeds each, benchmark v3. Cost: $0.

| slots | state bytes | OOD recall | dev all | OOD all |
|---|---|---|---|---|
| 8 | 5 KiB | 45.5 ± 17.8 | 36.2 ± 3.5 | 31.2 ± 3.7 |
| 16 | 9 KiB | 61.8 ± 21.9 | 36.4 ± 3.1 | 32.9 ± 3.8 |
| 32 | 16 KiB | 67.0 ± 13.9 | 34.6 ± 0.9 | 31.8 ± 0.4 |
| 64 | 30 KiB | 72.3 ± 5.6 | 38.4 ± 3.3 | 34.3 ± 2.5 |
| Transformer (reference) | 198 KiB KV | 71.0 ± 35.1 | 44.8 ± 4.7 | 32.8 ± 3.5 |

| Prediction | Result |
| --- | --- |
| S1: 16 > 8 slots (OOD recall) | **yes** |
| S2: 32 > 16 slots | **yes** |
| S3: saturation, i.e. 64 within 3 points of 32 | **no**: +5.3 points (72.3 vs 67.0) |

**Decision:** PARTIAL (monotone, but no saturation).

## What was learned

1. **Recall grows with memory, and has not saturated at 64 slots:**

   | slots | 8 | 16 | 32 | 64 |
   | --- | --- | --- | --- | --- |
   | OOD recall (%) | 45.5 | 61.8 | 67.0 | 72.3 |

   Roughly +9 points per doubling. The predicted saturation at "slots ≥ facts" (14–20 facts OOD) did not happen.
   - Each fact spans several tokens, and every token may write.
   - The memory therefore needs more slots than facts.
   - Better write selection, i.e. learning *what* to store, is the lever. That is R1.13's question.
2. **Retention per byte:** 5 KiB gives 45%, 30 KiB gives 72%. The Transformer needs 198 KiB of KV for 71% (with ±35 seed variance).
3. **Seed variance falls with more slots:** ±17.8 at 8 slots, ±5.6 at 64. Small memories make training fragile.
