# Darus — model card (draft)

Date: 2026-10-02 · Branch: `darus/scaffold` · Status: **scaffold, untrained.**

## Summary

Darus is the planned **broad-expert** model of the Osirus AI Lab research
program (alongside the Rouge and Quesnir lines): wide domain knowledge across
many fields, and the planned distillation target from which narrower
specialist lines can later be distilled. This directory is its Phase I
scaffold: configuration, evaluation protocol, and training plan. **No weights
exist. No training run has happened. No benchmark has been measured.**

## Honest status

| Claim                    | State                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Trained weights          | **None.** `model.config.ts` keeps the native-checkpoint slot at `null`.                                                 |
| Benchmark results        | **None.** No number in this directory is a measurement.                                                                 |
| Capability claims        | **None.** Nothing here asserts what Darus can do.                                                                       |
| Architecture             | **PLANNED values only** (see `model.config.ts`), fixed at the Stage D scale-decision point after the Stage B smoke run. |
| Backends available today | Foreign baselines only (`api_provider`, `remote_inference`), all `selfTrained: false`, all with placeholder endpoints.  |

Per handoff gate 3: a result that was not measured does not exist, and this
card will never contain projected or third-party-reported numbers presented as
Darus results.

## Intended role

Broad domain expertise: question answering, analysis, and reasoning across
many knowledge domains — as opposed to the code-specialized (Quesnir) and
general/reasoning (Rouge) lines. Darus is also the planned **distillation
target**: a strong broad teacher-side reference from which smaller specialist
students could later be distilled (Stage F option, gated separately). The
exact task mix is defined by the evaluation suites in `EVALUATION.md`, not by
adjectives.

## Backends and the honesty invariant

Darus programs against the `ModelBackend` contract
(`ai-lab/contracts/model-backend.ts`). The scaffold configures:

- an `api_provider` baseline (third-party API, placeholder endpoint,
  `apiKeyRef` names an env var — never a secret);
- a `remote_inference` baseline (open weights on self-hosted infrastructure,
  placeholder endpoint);
- license-review slots for both baselines (`DARUS_BASELINE_LICENSES`), all
  `pending` until terms are verified at Phase I execution time;
- a reserved `native_checkpoint` slot that stays `null` until a checkpoint was
  actually trained under owner authorization — only then may
  `selfTrained: true` appear.

Foreign weights (DeepSeek, Qwen, …) are baselines and are **never** relabeled
as self-trained Darus models (reuse doc § 6).

## Gates

- `TRAINING_READY=FALSE`: no training, no GPU spend. See `TRAINING.md`.
- Nothing under `ai-lab/` ever merges into `main` (handoff gate 1).
- No chain-of-thought is persisted; eval artifacts store final answers and the
  model/seed/config record only.

## Files

| File                        | Purpose                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| `model.config.ts`           | Planned architecture (MoE option documented), baseline backend configs, license slots, dataset plans. |
| `EVALUATION.md`             | Eval suite definition, pass@1 protocol, distillation-eval concept.                                    |
| `TRAINING.md`               | Data recipe, distillation option, stage plan A–G.                                                     |
| `../../tests/darus.test.ts` | Contract and honesty-invariant tests for this scaffold.                                               |
