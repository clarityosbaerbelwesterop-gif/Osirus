# R1.24 result: PARTIAL (pre-registered decision)

**Measurement:** `lab/hardware.py`, pre-registered in `experiments/r1_24.json`.
- Inference, batch 8, median of 3 runs, all 4 cores of the research container (Intel Xeon, 2.8 GHz). Cost: $0.
- Energy in joules is not measurable here: there are no power counters (RAPL) in the container. The proxy is CPU-core-seconds per token, in `summary.json`.

| model | 64 tokens | 256 tokens | 1024 tokens | memory per stream at 1024 tokens |
|---|---|---|---|---|
| transformer | 48,381 tok/s | 70,851 tok/s | 81,500 tok/s | 2,048.0 KiB |
| lstm | 140,272 tok/s | 196,995 tok/s | 196,550 tok/s | 1.8 KiB |
| ssm | 12,521 tok/s | 18,077 tok/s | 19,113 tok/s | 26.0 KiB |
| rouge-mem | 8,998 tok/s | 9,027 tok/s | 7,888 tok/s | 15.8 KiB |
| rouge-cheap | 13,260 tok/s | 11,853 tok/s | 11,479 tok/s | 14.6 KiB |

| Prediction | Result |
| --- | --- |
| H1: at 1024 tokens rouge-cheap needs ≤ 0.1× the Transformer's memory per stream | **yes**: 14.6 KiB vs 2,048 KiB (0.007×) |
| H2: at 1024 tokens rouge-cheap reaches ≥ 0.25× the Transformer's tokens/s | **no**: 11.5k vs 81.5k (0.14×) |

## What was learned

1. **The constant-memory claim holds physically.**
   - Rouge's per-stream inference memory stays at 15 KiB from 64 to 1,024 tokens.
   - The Transformer's KV cache grows linearly, to 2 MiB per stream at 1,024 tokens (4 layers, d = 64).
2. **Speed is bound by the kernel, not by the FLOPs.**
   - rouge-cheap needs fewer FLOPs per token than the Transformer (R1.09), yet runs at 0.14× its speed, because each token is a separate Python step.
   - The LSTM, with the same recurrent structure, runs at 2.4× the Transformer's speed because PyTorch fuses it into one kernel.
   - This matches R1.22: executed kernels, not counted FLOPs, decide physical efficiency.
3. **Consequence for the program:**
   - Before Rouge scales (R1.14+), its per-token update needs a fused kernel or a parallel (associative) scan form.
   - The cheap write is almost linear: the only non-linear part is the attention over slots, computed from the current state.
   - This is a concrete engineering item, not a research question.
