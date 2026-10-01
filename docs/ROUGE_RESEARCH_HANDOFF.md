# OSIRUS → Rouge — Research Handoff (gate document)

Date: 2026-10-02 · Status: **HANDOFF READY — research not started.** This document is the bridge between the product program (complete through certification) and the Rouge 1 / Quesnir / Darus indie-AI research program. It exists so the research can start from evidence instead of enthusiasm.

## Hard gates (from the master spec, non-negotiable)

1. No Rouge/Quesnir/Darus code merges into `main`. Research lives on `rouge/*` branches or a separate repo.
2. No GPU spend (H200 or otherwise) without `TRAINING_READY=TRUE` **and** explicit owner authorization. Preconditions per spec: infrastructure, product, data contracts, evaluation system, security boundaries, billing, observability and rollback are ready. Current state: billing absent, observability PARTIAL → **TRAINING_READY=FALSE**.
3. Never fabricate training runs, benchmarks, model performance, or capability claims. A result that was not measured does not exist.

## What already exists (verified in the takeover audit)

| Asset                                                                                                                            | Where                                     | State                                            |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------ |
| Eval interleaving (+1 commit)                                                                                                    | `rouge/m57-gate` branch                   | Merge candidate via PR after CI                  |
| GPU training preflight                                                                                                           | `rouge/free-gpu-training-20260930` branch | Experimental, isolated                           |
| Native model exploration (exo/MLX)                                                                                               | `rouge/native-model-m58` branch           | Experimental, newest work (2026-10-01)           |
| Single-GPU training stack (Llama-family transformer, BPE, memmap corpus, bf16 trainer w/ checkpoint+resume, distillation client) | SCP repo `model/`                         | Real, tested — good seed scaffold                |
| Osirus evaluation harness + capability pulse + Foundry arenas                                                                    | `evals/`, `src/lib/intelligence/`         | Production-grade, reusable as Rouge's eval spine |
| Verification engine (deterministic-outranks-model arbitration)                                                                   | `src/lib/verification/engine.ts`          | Directly reusable for run/benchmark grading      |

## What must be built fresh (not present anywhere)

- Distributed training: DDP/FSDP, multi-GPU orchestration, GPU provisioning
- Experiment tracking + artifact/model store
- Data contracts: corpus provenance, licensing, dedup, decontamination against eval sets
- Rouge-specific eval suites (Quesnir/Darus task definitions are doc-only today: M59–M75)

## Suggested stage order when the owner opens the gate

- **Stage A — Corpus contracts**: provenance + licensing rules, decontamination tooling, eval-set isolation. No training.
- **Stage B — Local smoke**: SCP `model/` stack trains a tiny model end-to-end on a free tier/CPU-adjacent budget; checkpoint+resume proven; eval spine wired.
- **Stage C — Eval first**: Rouge task suites graded by the Osirus verification engine; baselines recorded honestly (including failures).
- **Stage D — Scale decision point**: written proposal (data, budget, expected metrics, rollback) → owner signs → only then GPU provisioning.
- **Stages E–G** (training, distillation, publication) follow the proposal, each with its own gate.

## First action when authorized

Merge `rouge/m57-gate` via PR after CI, then open Stage A on a fresh `rouge/stage-a-corpus` branch. Everything else waits for `TRAINING_READY`.
