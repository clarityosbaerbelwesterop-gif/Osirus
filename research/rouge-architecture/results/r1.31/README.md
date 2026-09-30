# R1.31 result: PARTIAL (analysis of recorded runs, no new training)

**Compression frontier.** This is not a pre-registered experiment. It places every suite-v3 model trained so far on one chart:
- 35 distinct configurations;
- all trained with the same budget (batch 64, 15,000 steps, 3 seeds, $0);
- the method is fixed in `lab/frontier.py`, and the data is in `frontier.json`.

A model is on a frontier when no other model reaches at least its dev accuracy at no more cost on that axis.

### Frontier: dev accuracy vs stored weights

| model (experiment) | stored weights | dev | OOD |
|---|---|---|---|
| kron (R1.26) | 304 KiB | 41.7 ± 4.2 | 30.5 |
| ternary (R1.29) | 326 KiB | 47.2 ± 0.9 | 36.3 |
| fixed4 (R1.20) | 825 KiB | 48.2 ± 0.3 | 35.8 |

### Frontier: dev accuracy vs inference FLOPs / example

| model (experiment) | inference FLOPs / example | dev | OOD |
|---|---|---|---|
| dense-tiny (R1.29) | 8.9 M | 38.8 ± 2.3 | 30.0 |
| kron (R1.26) | 10.7 M | 41.7 ± 4.2 | 30.5 |
| lowrank (R1.26) | 12.4 M | 43.0 ± 1.3 | 30.2 |
| dense-d52 (R1.27) | 15.1 M | 44.0 ± 5.1 | 32.6 |
| ternary (R1.29) | 22.8 M | 47.2 ± 0.9 | 36.3 |
| fixed4 (R1.20) | 91.2 M | 48.2 ± 0.3 | 35.8 |

### Frontier: dev accuracy vs inference memory

| model (experiment) | inference memory | dev | OOD |
|---|---|---|---|
| gru (R1.07) | 1 KiB | 33.9 ± 0.5 | 28.7 |
| lstm (R1.07) | 2 KiB | 34.9 ± 0.5 | 28.7 |
| slots8 (R1.10) | 5 KiB | 36.2 ± 3.5 | 31.2 |
| slots16 (R1.10) | 9 KiB | 36.4 ± 3.1 | 32.9 |
| rouge-cheap (R1.09b) | 15 KiB | 39.4 ± 0.9 | 32.5 |
| transformer-d48 (R1.17) | 148 KiB | 41.0 ± 4.9 | 30.8 |
| dense-small (R1.26) | 148 KiB | 41.0 ± 4.9 | 30.8 |
| dense-d52 (R1.27) | 161 KiB | 44.0 ± 5.1 | 32.6 |
| ternary (R1.29) | 198 KiB | 47.2 ± 0.9 | 36.3 |
| fixed4 (R1.20) | 396 KiB | 48.2 ± 0.3 | 35.8 |

### Weights that fit a storage budget (arithmetic, not capability)

| format | bytes / weight | 1 GB | 5 GB | 40 GB |
|---|---|---|---|---|
| fp32 | 4 | 0.25 B | 1.25 B | 10.00 B |
| bf16 | 2 | 0.50 B | 2.50 B | 20.00 B |
| int8 | 1 | 1.00 B | 5.00 B | 40.00 B |
| int4 | 0.5 | 2.00 B | 10.00 B | 80.00 B |
| ternary, 2-bit packed | 0.25 | 4.00 B | 20.00 B | 160.00 B |
| ternary, 1.58-bit ideal | 0.1975 | 5.06 B | 25.32 B | 202.53 B |


## What was learned

1. **Stored bytes: ternary weights dominate.**
   - Ternary MLPs (R1.29) reach 47.2 dev at 326 KiB. Only the looped fixed4 model is higher (48.2), at 2.5× the bytes and 4× the FLOPs.
   - Kronecker (R1.26) is the cheapest point on the frontier (41.7 at 304 KiB).
   - Every fp32 dense model is dominated.
2. **Inference memory: Rouge's memory models own the region between recurrent and attention models.**
   - LSTM and GRU need 1–2 KiB and reach about 34–35.
   - Rouge with 8 or 16 slots (R1.10) and the cheap read (R1.09) needs 5–15 KiB and reaches 36–39.
   - The next attention model needs 148 KiB, 10× more, for 41.0.
   - This is Rouge's measured niche: more capability per byte of inference state than a fixed vector state, at a small fraction of a KV cache. At long context the gap widens, because the attention model's memory grows with length and Rouge's does not (R1.24).
3. **FLOPs: small dense and structured matrices are the cheap end; ternary is the best point at Transformer cost; looping buys the last point at 4× FLOPs.**
4. **Not measured: the 1 / 5 / 40 GB frontier.**
   - The table above is arithmetic only. At 2-bit packing, 1 GB holds 4 B ternary weights, against 0.5 B in bf16.
   - Whether ternary's advantage survives at that scale is exactly R1.32's question. That question is also open in the literature: BitNet b1.58 2402.17764 reports parity with fp16 from about 3B parameters.
   - This result is PARTIAL because the frontier is measured only between 1 KiB and 1.3 MB.

**What this means for R1.32 and R1.40.** Two mechanisms are on a frontier with independent evidence:
- ternary MLP weights (R1.29 PASS, outside seed noise);
- Rouge's small-state memory (R1.09 PASS, R1.10, R1.11 PASS; on the inference-memory frontier).

Their combination (a ternary-MLP Rouge-LM) is the candidate for scaling, once R1.14 shows how Rouge-LM does on real text.
