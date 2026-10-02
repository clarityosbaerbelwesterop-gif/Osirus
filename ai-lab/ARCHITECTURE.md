# AI Lab — Component Architecture

Date: 2026-10-02 · Branch: `ai-lab/foundation` · Status: **architecture only —
TRAINING_READY=FALSE, zero spend, zero training.**

This document defines the component architecture of the Osirus AI Lab. Phase G
delivers contracts and interfaces only; implementation phases are noted per
component. Gate documents: `docs/ROUGE_RESEARCH_HANDOFF.md` (hard gates),
`docs/AI_LAB_DEEPSEEK_REUSE.md` (reuse analysis), `docs/PRODUCTION_CERTIFICATION.md`
(gate status).

## 0. Layering and isolation

```
┌────────────────────────────────────────────────────────────┐
│ experiments (rouge/*, quesnir/*, darus/* branches)         │
├────────────────────────────────────────────────────────────┤
│ registries:  dataset · checkpoint · experiment  (Phase H)  │
├────────────────────────────────────────────────────────────┤
│ eval spine · training loop · data pipeline    (B/I/J)      │
├────────────────────────────────────────────────────────────┤
│ model backends  (contracts/model-backend.ts)               │
├────────────────────────────────────────────────────────────┤
│ infra: local single-GPU · RunPod adapter slot  (Phase K)   │
└────────────────────────────────────────────────────────────┘
```

- `ai-lab/` has **no runtime dependency on `src/`**. Reuse of Osirus product code
  (verification engine, eval harness) happens by documented interface, not by import,
  so the lab tree stays severable into a separate repo if the owner chooses.
- Nothing in `ai-lab/` ever merges into `main` (handoff gate 1).

## 1. Data pipeline (Phase J contracts, methodology per DeepSeek-Coder)

Stages, each a pure, separately testable transform with a registry-recorded manifest:

1. **ingest** — pull raw sources (candidates: The Stack v1/v2, StarCoder2 data,
   CodeSearchNet, commit/diff sets; see reuse doc § 4). Every source records
   `source`, `license`, and `provenanceUri` in the dataset contract. The DeepSeek
   2T-token corpus is **not** available and must never appear as a provenance
   source (reuse doc § 2).
2. **license-filter** — drop anything without a permissive license or with a
   recorded opt-out. Licensing evidence is stored per source; no unfiltered
   GitHub/Common Crawl scraping.
3. **dedup (near-dup)** — exact + near-duplicate filtering (MinHash-style
   fingerprinting), per spec § 27 and reuse doc § 3. The method identifier is
   recorded in `Dataset.dedupMethod`.
4. **decontamination** — remove anything overlapping the evaluation sets we run
   (HumanEval, MBPP, DS-1000, MultiPL-E, plus future Rouge task suites). The eval
   sets a dataset was decontaminated against are recorded in
   `Dataset.decontaminatedAgainst`; eval-set isolation is non-negotiable.
5. **tokenize** — tokenizer fixed per experiment config; `Dataset.tokenCount` is
   recorded after this stage.
6. **pack** — repo-level packing with **dependency-ordered file sequencing**
   (DeepSeek-Coder methodology: whole repositories parsed, files ordered by
   dependency, not isolated file shuffling; reuse doc § 3). The original
   implementation is not public; we re-implement the algorithm from the paper.

Target mix starts from the 87% code / 13% natural-language hypothesis and is
validated by ablation, not copied blindly (reuse doc § 3).

## 2. Training (Phase I; seed = SCP `model/` stack)

- **Seed scaffold:** the SCP repo `model/` stack — Llama-family transformer, BPE
  tokenizer, memmap corpus, bf16 trainer with checkpoint + resume, distillation
  client — verified real and tested in the takeover audit
  (`docs/ROUGE_RESEARCH_HANDOFF.md`, asset table).
- **Stage B smoke:** single-GPU (or free-tier/CPU-adjacent) end-to-end tiny run
  proving checkpoint + resume and the eval spine wiring **before** any scale
  discussion.
- **Scale path:** DDP/FSDP multi-GPU orchestration is a later option only. It
  requires the Stage D decision point: written proposal (data, budget, expected
  metrics, rollback) → owner sign-off → Phase L 18-checkbox gate → only then GPU
  provisioning.
- Every produced artifact is registered via `contracts/checkpoint.ts`
  (`parentId` chains resume lineage; `metricsRef` points at eval results —
  measured results only, never projections).

## 3. Eval spine (reused from Osirus product)

- **Arbitration:** the Osirus verification engine
  (`src/lib/verification/engine.ts`) is reused by interface: **deterministic
  checks outrank model judgment** for run/benchmark grading. The lab wraps it;
  it does not fork it.
- **Protocol:** pass@1 with a full **model / seed / config** record per run (reuse
  doc § 3, eval-harness row). `GenerateRequest.seed` is mandatory in the backend
  contract for exactly this reason.
- **Suites:** HumanEval / MBPP / DS-1000 / MultiPL-E to start; Rouge-specific
  suites (Quesnir/Darus task definitions M59–M75) are defined on experiment
  branches and graded by the same engine.
- **Honesty:** baselines are recorded including failures; third-party-reported
  numbers (reuse doc § 5) must be re-measured on this spine before appearing in
  any Osirus artifact. No chain-of-thought is persisted in eval artifacts —
  only final answers, scores, and the model/seed/config record.

## 4. Registries (Phase H — contracts delivered here)

Phase H builds the actual stores. Phase G fixes the data-class contracts and
pure validation functions (dependency-free TypeScript, no zod):

| Registry   | Contract                  | Key invariants                                                     |
| ---------- | ------------------------- | ------------------------------------------------------------------ |
| dataset    | `contracts/dataset.ts`    | license + provenance mandatory; dedup + decontamination recorded   |
| checkpoint | `contracts/checkpoint.ts` | `step` lineage via `parentId`; `metricsRef` links measured results |
| experiment | `contracts/experiment.ts` | hypothesis + `configHash` + dataset/baseline ids before any run    |

Validators return `string[]` of human-readable errors (empty = valid), so the
registry layer can surface contract violations without a schema library.

## 5. Model backends (replaceability contract)

`contracts/model-backend.ts` defines the `ModelBackend` interface. All training,
evaluation, and experiment code programs against this interface, so the model
layer is replaceable across four kinds:

- `native_checkpoint` — our own SCP-derived checkpoints (`selfTrained: true`
  only when that is literally true).
- `local_inference` — open weights served locally (e.g. Qwen2.5-Coder,
  DeepSeek-Coder) as **baselines** (`selfTrained: false`).
- `remote_inference` — self-hosted remote serving of open weights, same
  baseline role.
- `api_provider` — third-party APIs as comparison baselines (reuse doc § 5).

Honesty invariant: `modelId` is the honest upstream identifier and
`selfTrained` is `false` for DeepSeek/Qwen/etc. weights — foreign weights are
never relabeled as self-trained Rouge/Quesnir/Darus models (reuse doc § 6).

## 6. Infrastructure (Phase K — slot reserved)

- **Local/dev:** CPU or single consumer GPU; the entire Phase G scaffold runs
  with zero spend.
- **RunPod adapter (Phase K):** a reserved adapter slot behind the infra
  interface. Provisioning happens only after the Phase L gate passes
  (TRAINING_READY=TRUE + owner authorization). No adapter implementation, no
  credentials, and no GPU calls exist in this scaffold.

## 7. What this scaffold explicitly does not contain

- No training code, no data downloads, no benchmarks, no GPU calls, no secrets.
- No runtime imports from `src/` — reuse is by documented interface only.
- No registry implementations (Phase H), no backend implementations (Phase I),
  no infra adapter (Phase K).
