# Preference post-training (M61) — character and response quality

The goal is to train Rouge's behaviour into the weights: precise, direct,
curious, honest about uncertainty, and excellent in German and English.

**How:**

- DPO-style training on preference pairs.
- Every pair has provenance.
- Data from closed-model outputs is excluded when that model's terms
  forbid training on it (for example `ultrafeedback-binarized` in
  `data/registry.json`).
- No giant system prompt.
