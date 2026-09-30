# R1.14 result: FAIL (pre-registered decision)

**10M byte-level language model on real text: Rouge-LM vs a 10M Transformer**

**Run:** GitHub Actions run `36649205043`, commit `3a7fabc`.
- 4 models × 3 seeds on free CPU runners (tier 0).
- 8,000 steps × 16 streams × 256 bytes.
- Full numbers are in `summary.json` and `report.md`.

**Cost:** $0.

**Question:** at 10M parameters and the same training bytes of real text, does Rouge-LM (local window + 16 gated state slots per layer, constant inference memory) match a standard Transformer at equal visible context, and use context beyond the Transformer's window through its state, at a fraction of the inference memory?

| model | valid BPB | test BPB | stream.b0_0_256 | stream.b1_256_1k | stream.b2_1k_4k | FLOPs / byte | stored weights | inference memory | stream throughput | train time |
|---|---|---|---|---|---|---|---|---|---|---|
| transformer | 1.721 ± 0.029 | 1.769 ± 0.035 | 1.606 ± 0.043 | 1.586 ± 0.067 | 1.606 ± 0.064 | 19.8 M | 38852 KiB | 5120 KiB | 4,193 B/s | 252 min |
| rouge-lm | 1.962 ± 0.024 | 2.019 ± 0.053 | 1.866 ± 0.052 | 1.629 ± 0.061 | 1.644 ± 0.053 | 15.8 M | 39876 KiB | 1224 KiB | 5,878 B/s | 273 min |
| window | 1.801 ± 0.005 | 1.844 ± 0.014 | 1.688 ± 0.004 | 1.563 ± 0.003 | 1.591 ± 0.000 | 19.8 M | 38852 KiB | 1280 KiB | 5,781 B/s | 283 min |
| lstm | 1.834 ± 0.004 | 1.915 ± 0.003 | 1.719 ± 0.031 | 1.742 ± 0.024 | 1.749 ± 0.015 | 20.1 M | 39255 KiB | 12 KiB | 8,864 B/s | 189 min |

(Bits per byte, mean ± SD over seeds; lower is better. Inference memory is state plus KV cache for the stream evaluation.)

| check | left | right (threshold) | holds | difference, 95% interval |
|---|---|---|---|---|
| L1_parity | rouge-lm:valid.bpb = 1.962 | <= transformer:valid.bpb = 1.721 +0.03 → 1.751 ± 0.000 | no | +0.241 ± 0.070 |
| L2_state_helps | rouge-lm:stream.b2_1k_4k = 1.644 | <= window:stream.b2_1k_4k = 1.591 -0.02 → 1.571 ± 0.000 | no | +0.053 ± 0.132 |
| L3_long_context | rouge-lm:stream.b2_1k_4k = 1.644 | <= transformer:stream.b2_1k_4k = 1.606 -0.02 → 1.586 ± 0.000 | no | +0.038 ± 0.153 |
| L4_memory | rouge-lm:total_bytes = 1224 KiB | <= transformer:total_bytes = 5120 KiB × 0.5 → 2560 KiB | **yes** |  |
| L5_vs_lstm | rouge-lm:valid.bpb = 1.962 | <= lstm:valid.bpb = 1.834 → 1.834 ± 0.000 | no | +0.128 ± 0.061 |

**Statistical power:** 3 seeds each. Seed-to-seed spread differs a lot between models: the window model varies by ±0.005 BPB, the Transformer and Rouge-LM by ±0.05–0.07 on long streams. Differences under about 0.1 BPB between the high-variance models are within seed noise; each check shows its interval.

**Data:** enwik8 (SHA-256 `2b49720ec4d7…`), standard 90/5/5 split. Every model read the same 32.8M training bytes (8,000 steps × 16 streams × 256 bytes; 0.36 epochs).

**Floors on validation bytes:** unigram 4.90 BPB, order-3 byte n-gram 3.15 BPB. Every model is far below both.

**How to read the columns:**
- valid/test BPB: each 256-byte segment is read on its own, with a fresh state. All models see the same context.
- stream.*: long test streams (16 × 4,096 bytes) read from the start. Recurrent models carry their state; the Transformer reads with a sliding window of 256 bytes.

## What was learned

1. **Rouge's slot state is a net loss on real text at this scale.** Rouge-LM is worse than the same code without slots (window) in every measure:
   - fresh segments: 1.962 vs 1.801;
   - bytes 0–256 of a stream: 1.866 vs 1.688;
   - bytes 1k–4k: 1.644 vs 1.591.
   At equal parameters the slots cost width (d = 272 instead of 320), and the state does not repay it.
2. **Rouge-LM depends on a warm state.** With a fresh state its first 256 bytes are poor (1.87). It was trained with the state carried across segments, and the learned initial state is not a good start. Deeper into a stream it recovers (1.63–1.64), but it never passes the window model.
3. **The best long-stream model here is the sliding window with a cached previous block.**
   - It reaches 1.591 on bytes 1k–4k, against 1.606 ± 0.064 for the full-attention Transformer (within the Transformer's seed noise).
   - It needs a quarter of the Transformer's inference memory (1.25 MiB vs 5 MiB) and is the most stable model (±0.000–0.005).
   - This is segment-level caching and local attention, which is prior art (Transformer-XL 1901.02860, Longformer 2004.05150). It is not a Rouge mechanism.
4. **At equal visible context the full Transformer is best** (1.721), ahead of window (1.801), LSTM (1.834) and Rouge-LM (1.962).
5. **Consequences:**
   - R1.15 (50M) is **not earned**.
   - Rouge's memory mechanisms have evidence on synthetic tasks (R1.03, R1.09–R1.12) but none on real text at 10M.
   - R1.14b (an exact addressable memory) and R1.16 (long context, copy probe) test the remaining memory questions on the same data.
6. **Not tried, deliberately.** No learning-rate or width re-tuning after the result: a pre-registered FAIL is not rescued by tuning. A variant that keeps the width (slots added on top of d=320, not parameter-matched) would answer a different question and would need its own pre-registration.
