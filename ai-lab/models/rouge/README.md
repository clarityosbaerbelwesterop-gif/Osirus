# Rouge 1 — model card (draft)

Date: 2026-10-02 · Branch: `rouge/scaffold` · Status: **scaffold, untrained.**

## Summary

Rouge 1 is the planned **general/reasoning** model of the Osirus AI Lab
research program (alongside the Quesnir and Darus lines). This directory is its
Phase I scaffold: configuration, evaluation protocol, and training plan. **No
weights exist. No training run has happened. No benchmark has been measured.**

## Honest status

| Claim                    | State                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Trained weights          | **None.** `model.config.ts` keeps the native-checkpoint slot at `null`.                                                 |
| Benchmark results        | **None.** No number in this directory is a measurement.                                                                 |
| Capability claims        | **None.** Nothing here asserts what Rouge 1 can do.                                                                     |
| Architecture             | **PLANNED values only** (see `model.config.ts`), fixed at the Stage D scale-decision point after the Stage B smoke run. |
| Backends available today | Foreign baselines only (`api_provider`, `remote_inference`), all `selfTrained: false`, all with placeholder endpoints.  |

Per handoff gate 3: a result that was not measured does not exist, and this
card will never contain projected or third-party-reported numbers presented as
Rouge 1 results.

## Intended role

General-purpose reasoning: question answering, mathematics, logic, analysis,
and multi-step problem solving — as opposed to the code-specialized (Quesnir)
and other specialized lines. The exact task mix is defined by the evaluation
suites in `EVALUATION.md`, not by adjectives.

## Backends and the honesty invariant

Rouge 1 programs against the `ModelBackend` contract
(`ai-lab/contracts/model-backend.ts`). The scaffold configures:

- an `api_provider` baseline (third-party API, placeholder endpoint,
  `apiKeyRef` names an env var — never a secret);
- a `remote_inference` baseline (open weights on self-hosted infrastructure,
  placeholder endpoint);
- a reserved `native_checkpoint` slot that stays `null` until a checkpoint was
  actually trained under owner authorization — only then may
  `selfTrained: true` appear.

Foreign weights (DeepSeek, Qwen, …) are baselines and are **never** relabeled
as self-trained Rouge models (reuse doc § 6).

## Gates

- `TRAINING_READY=FALSE`: no training, no GPU spend. See `TRAINING.md`.
- Nothing under `ai-lab/` ever merges into `main` (handoff gate 1).
- No chain-of-thought is persisted; eval artifacts store final answers and the
  model/seed/config record only.

## Files

| File                        | Purpose                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| `model.config.ts`           | Planned architecture, baseline backend configs, dataset plan, draft baseline-eval experiment. |
| `EVALUATION.md`             | Eval suite definition and pass@1 protocol.                                                    |
| `TRAINING.md`               | Data recipe and stage plan A–G.                                                               |
| `../../tests/rouge.test.ts` | Contract and honesty-invariant tests for this scaffold.                                       |
