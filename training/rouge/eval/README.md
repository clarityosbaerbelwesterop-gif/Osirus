# Rouge Model Lab (M69, begins with lab-v0)

The Lab measures **checkpoints, not wrappers**.

**What it compares:** Qwen base, checkpoint N−1 and checkpoint N. All three
are served the same way (vLLM or SGLang, BF16, the same sampling), on the
same suite versions and on held-out splits.

**Where suites come from:**

- `configs/lab-v0.json` defines the suites.
- Generated suites reuse `evals/rouge/m57-benchmark.ts`, with a fresh
  holdout seed per run.
- Paired statistics come from `evals/rouge/stats.ts`: bootstrap confidence
  interval and McNemar's test.

**How results are used:**

- Results go into the checkpoint's manifest (`evaluations`).
- Promotion is decided by `rouge_train/checkpoints.promotion_decision`.
- Comparisons with external systems use only their published results or
  our own reproductions, labelled as such, and never invented numbers.
