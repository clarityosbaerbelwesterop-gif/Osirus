# R1.29b result: PASS (pre-registered decision)

**Ternary MLP weights on real text: 10M byte-level language models on enwik8, byte-matched**

**Run:** GitHub Actions run `36681965922`, commit `b07d8ad`.
- 4 models × 3 seeds on free CPU runners (tier 0).
- Same data, token budget and seeds as R1.14.
- Full numbers are in `summary.json` and `report.md`.

**Cost:** $0.

**Question:** does R1.29's result (ternary weights, synthetic suite v3) transfer to real text?
- Does a 10M Transformer with ternary MLP weights (15.2 MB stored) predict enwik8 better than an fp32 Transformer with the same stored bytes (d=200, 15.6 MB)?
- Does it stay close to the full fp32 model (38.9 MB)?
- Does the combination of the two measured winners (window architecture + ternary MLP) keep the full model's far-stream quality?

| model | valid BPB | test BPB | stream.b0_0_256 | stream.b1_256_1k | stream.b2_1k_4k | FLOPs / byte | stored weights | inference memory | stream throughput | train time |
|---|---|---|---|---|---|---|---|---|---|---|
| transformer | 1.721 ± 0.029 | 1.769 ± 0.035 | 1.606 ± 0.043 | 1.586 ± 0.067 | 1.606 ± 0.064 | 19.8 M | 38852 KiB | 5120 KiB | 4,167 B/s | 246 min |
| transformer-ternary | 1.733 ± 0.010 | 1.764 ± 0.008 | 1.603 ± 0.020 | 1.547 ± 0.023 | 1.575 ± 0.023 | 19.8 M | 14853 KiB | 5120 KiB | 3,266 B/s | 272 min |
| transformer-d200 | 1.786 ± 0.027 | 1.841 ± 0.034 | 1.683 ± 0.051 | 1.668 ± 0.064 | 1.696 ± 0.068 | 7.8 M | 15283 KiB | 3200 KiB | 6,389 B/s | 133 min |
| window-ternary | 1.847 ± 0.012 | 1.887 ± 0.017 | 1.710 ± 0.016 | 1.586 ± 0.003 | 1.617 ± 0.007 | 19.8 M | 14853 KiB | 1280 KiB | 7,388 B/s | 237 min |

| check | left | right (threshold) | holds | difference, 95% interval |
|---|---|---|---|---|
| T1_per_byte | transformer-ternary:valid.bpb = 1.733 | <= transformer-d200:valid.bpb = 1.786 -0.03 → 1.756 ± 0.000 | **yes** | -0.054 ± 0.072 (within seed noise) |
| T2_near_fp32 | transformer-ternary:valid.bpb = 1.733 | <= transformer:valid.bpb = 1.721 +0.05 → 1.771 ± 0.000 | **yes** | +0.011 ± 0.077 (within seed noise) |
| T3_combination_far | window-ternary:stream.b2_1k_4k = 1.617 | <= transformer:stream.b2_1k_4k = 1.606 → 1.606 ± 0.000 | no | +0.012 ± 0.161 |
| T4_bytes | transformer-ternary:stored_bytes = 14853 KiB | <= transformer:stored_bytes = 38852 KiB × 0.45 → 17484 KiB | **yes** |  |

(BPB = bits per byte, mean ± SD over 3 seeds. `stream.bX` = BPB at that distance into long streams. FLOPs are executed per byte. Stored weights count 2-bit packing for ternary layers.)

**Decision rule** (pre-registered):
- PASS = T1 and T2 hold.
- PARTIAL = one of them holds.
- T3 and T4 are reported, not required.

## What was learned

1. **Ternary transfers to real text, on the pre-registered means.**
   - The ternary-MLP Transformer stores 14.5 MiB and reaches 1.733 ± 0.010 valid BPB.
   - The byte-matched fp32 model (d=200, 14.9 MiB) reaches 1.786 ± 0.027, and 1.841 vs 1.764 test BPB.
   - The full fp32 model (37.9 MiB) reaches 1.721 ± 0.029. Ternary is within 0.012 BPB of it with 38% of the bytes.
2. **Honest strength of the evidence.**
   - The byte-matched gap is 0.054 BPB, and T1 required 0.03. Its 95% Welch interval, however, is ±0.072 with 3 seeds, so it is *within seed noise*. The decision stands as registered but is provisional.
   - As in R1.29, the ternary model's seed SD is about 3× smaller than fp32's (0.010 vs 0.029): the regularising effect repeats on real text.
3. **Speed is not a win yet.** Ternary trained 10% slower (272 vs 246 min) and streams 22% slower (3,266 vs 4,167 B/s). Fake quantisation runs fp32 matmuls, and no low-bit kernel exists; no speed claim is made.
4. **The combination (window + ternary) did not keep far-stream quality (T3 fails).**
   - Far stream (1k–4k) is 1.617 vs 1.606 for the full model.
   - Its KV/inference memory is 4× smaller (1.25 MiB) and its streaming throughput 1.8× higher.
   - Within noise (±0.161), this is neither shown better nor shown worse.

## Consequence for Rouge Architecture v1

- **Candidate C keeps ternary FFN weights** (`configs/native/tournament-v1.json`, `r1_29b = pass`).
- Candidates D and E stay ternary as registered. The int8 control is not needed.
- The tournament (Levels B and C) decides whether ternary earns its place at 22M–40M parameters, by the pre-registered Pareto rule, with quality gated at +0.02 BPB against the Transformer baseline.
