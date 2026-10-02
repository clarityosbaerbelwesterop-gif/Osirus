# Osirus AI Lab — Phase G Scaffold

Date: 2026-10-02 · Branch: `ai-lab/foundation` · Status: **scaffold only — no training, no data downloads, no GPU spend.**

The AI Lab is the isolated research surface of the Osirus program (Rouge 1 / Quesnir /
Darus). This directory contains contracts, architecture documentation, and — in later
phases — the data pipeline, training, and evaluation code. Everything here is pure
scaffold: TypeScript interfaces, pure validation functions, and documents. There is no
runtime code, no dependency on `src/`, and no dependency on external packages.

## Isolation rules (non-negotiable)

1. `ai-lab/*` **never merges into `main`**. Research experiments live on `rouge/*`,
   `quesnir/*`, and `darus/*` branches (per `docs/ROUGE_RESEARCH_HANDOFF.md`, hard
   gate 1). This branch (`ai-lab/foundation`) is the architecture base for those
   experiment branches.
2. No GPU spend (H200 or otherwise) without `TRAINING_READY=TRUE` **and** explicit
   owner authorization. Current gate state: **TRAINING_READY=FALSE** (billing absent
   by owner deferral, observability PARTIAL — see `docs/PRODUCTION_CERTIFICATION.md`
   § 5).
3. Never fabricate training runs, benchmarks, model performance, or capability
   claims. A result that was not measured does not exist.
4. Foreign weights (DeepSeek, Qwen, …) are **never** labeled as self-trained
   Rouge/Quesnir/Darus models. The `ModelBackend.selfTrained` flag in
   `contracts/model-backend.ts` exists to make mislabeling structurally visible.
5. No scraping or ingestion without license filtering and opt-out respect; no
   "DeepSeek 2T corpus" provenance claims — that corpus was never released
   (`docs/AI_LAB_DEEPSEEK_REUSE.md` § 2).

## Contents

| Path                         | Purpose                                                                   |
| ---------------------------- | ------------------------------------------------------------------------- |
| `ARCHITECTURE.md`            | Component architecture: data pipeline, training, eval spine, registries.  |
| `contracts/model-backend.ts` | Model-layer replaceability contract (`ModelBackend`, factory type).       |
| `contracts/dataset.ts`       | Dataset registry contract + `validateDataset`.                            |
| `contracts/checkpoint.ts`    | Checkpoint registry contract + `validateCheckpoint`.                      |
| `contracts/experiment.ts`    | Experiment registry contract + `validateExperiment`.                      |
| `contracts/common.ts`        | Shared pure validation helpers (no dependencies).                         |
| `tests/contracts.test.ts`    | Positive/negative tests for the `validate*` functions.                    |
| `tsconfig.json`              | Standalone strict tsconfig for `contracts/` and the reserved `lib/` slot. |

## Build & check

The root `tsconfig.json` includes `**/*.ts`, so `ai-lab/` is type-checked by the root
gate (`npx tsc --noEmit`); the standalone config is for editor/CI use against the lab
in isolation:

```sh
npx tsc --noEmit          # root gate — must stay green
npx tsc -p ai-lab         # ai-lab standalone (contracts + lib only)
npx vitest run            # root gate — includes ai-lab/tests via vitest.config.ts
```

The root `vitest.config.ts` include list covers `ai-lab/tests/**/*.test.ts`, so the
contract tests run inside the root gate and are counted in its totals.

## Phase map (from `docs/AI_LAB_DEEPSEEK_REUSE.md` § 7)

- **Phase G (this branch):** architecture + contracts. Documentation only.
- **Phase H:** dataset / checkpoint / experiment registries implementing the
  contracts in `contracts/`; external-reuse section of the docs.
- **Phase I:** Quesnir scaffold; `APIProvider` / `LocalInference` baselines
  (DeepSeek-Coder, Qwen2.5-Coder — `selfTrained: false`); FIM config.
- **Phase J:** data contracts become binding (mix targets, repo-level ordering,
  dedup, decontamination, licensing evidence per source).
- **Phase K:** RunPod infrastructure adapter (slot reserved; see ARCHITECTURE.md § 6).
- **Phase L:** 18-checkbox training gate. Nothing trains before it passes.

## References

- `docs/ROUGE_RESEARCH_HANDOFF.md` — hard gates, existing assets, stage order.
- `docs/AI_LAB_DEEPSEEK_REUSE.md` — what is reused from DeepSeek-Coder (methodology,
  not data) and the base-model landscape.
- `docs/PRODUCTION_CERTIFICATION.md` — certified product baseline and gate status.
- `docs/SECURITY_REDTEAM.md` — security posture the lab must not weaken.
