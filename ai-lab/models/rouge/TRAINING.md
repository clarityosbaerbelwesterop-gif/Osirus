# Rouge 1 — training plan (draft)

Date: 2026-10-02 · Status: **plan only — TRAINING_READY=FALSE. Nothing trains
before the Phase L gate passes and the owner explicitly authorizes it**
(handoff gate 2).

## 1. Data recipe (Phase J executes this)

Rouge 1 (general/reasoning) needs two corpus classes:

1. **General corpus** — broad, license-clean natural-language text.
2. **Reasoning traces** — license-clean step-by-step problem/solution material
   whose final answers are verifiable.

Binding rules (Phase J contracts, `ai-lab/contracts/dataset.ts`):

- **License-clean sources only.** Every source records `source`, `license`,
  and `provenanceUri`, with license evidence retained. No scraping without
  license filtering and opt-out respect.
- **The DeepSeek 2T-token corpus does not exist for us** — it was never
  released and must never appear as a provenance source (reuse doc § 2).
  Reusable public candidates and methodology references are listed in
  `docs/AI_LAB_DEEPSEEK_REUSE.md` §§ 3–4.
- **Dedup** (exact + MinHash-style near-duplicate) with the method id recorded
  in `Dataset.dedupMethod`.
- **Decontamination** against every eval suite in `EVALUATION.md`
  (`rouge1-mmlu-like`, `rouge1-gsm8k-like`, procedural holdouts), recorded in
  `Dataset.decontaminatedAgainst`. Eval-set isolation is non-negotiable.
- Corpus mix ratios are hypotheses to be validated by ablation, not copied
  from any third-party recipe (reuse doc § 3).
- Planning placeholders live in `ROUGE1_DATASET_PLAN` (`model.config.ts`);
  they become real registry entries only after Phase J selection and license
  review.

## 2. Stage plan (from docs/ROUGE_RESEARCH_HANDOFF.md)

- **Stage A — Corpus contracts.** Provenance + licensing rules,
  decontamination tooling, eval-set isolation. No training.
- **Stage B — Local smoke.** The SCP `model/` seed stack trains a tiny model
  end-to-end on a free-tier/CPU-adjacent budget; checkpoint + resume proven;
  eval spine wired. No scale claims.
- **Stage C — Eval first.** The suites in `EVALUATION.md` run against the
  configured baselines; results recorded honestly, including failures.
- **Stage D — Scale decision point.** Written proposal (data, budget, expected
  metrics, rollback) → owner sign-off → only then any GPU provisioning. The
  PLANNED architecture values in `model.config.ts` are fixed here.
- **Stage E — Training.** Under the approved proposal; every checkpoint is
  registered with `parentId` lineage and a `metricsRef` to measured results
  only.
- **Stage F — Distillation / refinement.** Own gate per proposal.
- **Stage G — Publication.** Only measured results, with the full
  model/seed/config record.

## 3. Gate reminder

Current state: **TRAINING_READY=FALSE** (billing absent by owner deferral,
observability PARTIAL — `docs/PRODUCTION_CERTIFICATION.md` § 5). The Phase L
18-checkbox gate plus explicit owner authorization come before Stage E. This
scaffold contains no training code, no data downloads, and no GPU calls.

## 4. Artifact discipline

- No fabricated runs, benchmarks, or capability claims (handoff gate 3).
- No chain-of-thought storage anywhere in training or eval artifacts.
- Foreign weights used as teachers or baselines keep their honest identifiers
  and `selfTrained: false` (reuse doc § 6).
