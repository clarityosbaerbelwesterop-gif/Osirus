# R1.22 result: PASS (pre-registered decision)

**Measurement:** `lab/kernels.py`, pre-registered in `experiments/r1_22.json`.
- One MLP layer, forward and backward, 4,096 tokens.
- Median of 5 timed runs after 3 warm-up runs.
- Hardware: x86_64, 4 CPU cores, torch 2.14.0+cu130. This is the research container (tier 0). Cost: $0.

**Question:** does the router's sparsity (top 2 of 8 experts, R1.04) save real wall-clock time, not just counted FLOPs?

| d | dense-active (same FLOPs) | dense-total (same params) | moe-gather (top-2 of 8) | moe-masked (naive) | gather vs total | gather vs active |
|---|---|---|---|---|---|---|
| 64 | 8.8 ms | 27.1 ms | 17.0 ms | 95.3 ms | 0.62x | 1.94x |
| 256 | 38.0 ms | 191.3 ms | 73.1 ms | 413.4 ms | 0.38x | 1.93x |
| 512 | 169.7 ms | 653.5 ms | 199.6 ms | 970.1 ms | 0.31x | 1.18x |

| Prediction | Result |
| --- | --- |
| K1: at d=512, sparse ≤ 0.5× the dense model with the same parameters | **yes**: 0.31× |
| K2: at d=512, sparse ≤ 1.5× the dense model with the same active FLOPs | **yes**: 1.18× |
| K3: at d=64 overhead dominates (reported) | 1.94× the dense-active time |

## What was learned

1. **Real sparse dispatch saves real time.**
   - The gather-and-scatter MoE runs 3.3× faster than a dense MLP with the same stored parameters (d = 512).
   - Its cost approaches that of a dense MLP with the same active FLOPs, and the overhead shrinks with width: 1.9× at d = 64, 1.2× at d = 512.
2. **Executing a sparse model densely wipes out the gain.**
   - Computing every expert and then masking is 4.9–5.6× slower than real dispatch, and slower even than the full dense model.
   - Sparsity claims must therefore be measured on the executed kernel, not on counted FLOPs.
3. **Limits:** CPU only, one machine, one layer. GPU/Metal kernels (Triton, MLX) remain for tier 1–2 hardware.
