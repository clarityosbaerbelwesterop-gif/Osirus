# SFT (M59) — rouge-1-sft-001

**Recipe:** `configs/sft-001.json`, marked draft.

- **Method:** LoRA on the attention projections and the shared expert.
- **Data:** approved registry data only.
- **Output:** a merged derivative checkpoint after validation.

**Before it runs:**

1. The CI smoke run of the training code path passes (compute plan,
   step A).
2. `rouge-1-base` is measured with `lab-v0` (step B).
3. At least 50M tokens of registry entries are approved.
4. The owner approves the compute.
