# Model-native long context (M65): 262k → 512k → 1M → 2M

**Step 0 (no training).** Measure the pinned base's YaRN factor-4 setting at
128k, 262k, 512k and 1M with the `lab-v0` long-context suite.

**Then:**

- RoPE/YaRN scaling;
- long-context continued pretraining and SFT, with progressive lengths;
- context parallelism, including Gated DeltaNet state passing.

Costs are in `docs/rouge/compute-plan.md` §6. A context length is claimed
only after a checkpoint passes it.
