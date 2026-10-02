# Quasnir — Model Card (draft)

Date: 2026-10-02 · Branch: `quasnir/scaffold` (from `ai-lab/foundation`) ·
Status: **scaffold, untrained — no weights exist, TRAINING_READY=FALSE.**

## Identity

- **Name:** Quasnir (`osirus/quasnir-1`)
- **Role:** coding + security specialist model of the Osirus research program
  (alongside Rouge 1 / Darus; see `ai-lab/ARCHITECTURE.md`).
- **Intended use (planned):** code completion and generation, fill-in-the-middle
  (FIM) infilling, and security-oriented coding tasks (vulnerability-aware code
  review assistance, secure-coding generation). All of this is aspirational until
  a gated training run exists.

## What exists today

| Artifact           | State                                                              |
| ------------------ | ------------------------------------------------------------------ |
| Weights/checkpoint | **None.** `nativeCheckpoint` slot is reserved; no artifact exists. |
| Configuration      | `model.config.ts` — planned values only, validated by tests        |
| Eval plan          | `EVALUATION.md` — suite definition, no results                     |
| Training plan      | `TRAINING.md` — data recipe hypothesis, gated                      |

## Honesty statement

No benchmarks are reported here because none were measured. Per the program
hard gates (`docs/ROUGE_RESEARCH_HANDOFF.md`): a result that was not measured
does not exist. Third-party-reported numbers for baseline models appear only in
`docs/AI_LAB_DEEPSEEK_REUSE.md` § 5, clearly marked "reported", and must be
re-measured on the Osirus eval spine before appearing in any Osirus artifact.

## Baselines (foreign weights — never self-trained)

Quasnir will be compared against open code models from the reuse-doc § 5
landscape, all with `selfTrained: false` (see `model.config.ts`):

| Baseline                        | License         | Backend kinds used |
| ------------------------------- | --------------- | ------------------ |
| Qwen2.5-Coder-7B-Instruct       | Apache-2.0      | local_inference    |
| Qwen2.5-Coder-32B-Instruct      | Apache-2.0      | remote_inference   |
| DeepSeek-Coder-V2-Lite-Instruct | DeepSeek custom | remote_inference   |
| DeepSeek-Coder-V2               | DeepSeek custom | api_provider       |

Foreign weights are never relabeled as self-trained Quasnir models.

## Gates

- This branch never merges into `main` (hard gate 1).
- No GPU spend without `TRAINING_READY=TRUE` + explicit owner authorization
  (currently FALSE).
- No chain-of-thought is persisted in any eval or training artifact — only
  final answers, scores, and model/seed/config records.

## References

- `ai-lab/ARCHITECTURE.md` — component architecture and phase plan
- `docs/AI_LAB_DEEPSEEK_REUSE.md` — reuse analysis (methodology, not data)
- `docs/ROUGE_RESEARCH_HANDOFF.md` — hard gates and stage order
