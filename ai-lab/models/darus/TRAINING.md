# Darus — training plan (draft)

Date: 2026-10-02 · Status: **plan only — TRAINING_READY=FALSE. Nothing trains
before the Phase L gate passes and the owner explicitly authorizes it**
(handoff gate 2).

## 1. Data recipe (Phase J executes this)

Darus (broad expert) needs corpus classes that cover wide domain knowledge:

1. **Broad knowledge corpus** — license-clean natural-language text spanning
   many domains (science, humanities, professional/technical fields).
2. **Domain reference corpus** — license-clean encyclopedic/reference and
   technical-documentation material with verifiable sources.
3. **Distillation teacher outputs (later option)** — see § 2.

Binding rules (Phase J contracts, `ai-lab/contracts/dataset.ts`):

- **License-clean sources only.** Every source records `source`, `license`,
  and `provenanceUri`, with license evidence retained. No scraping without
  license filtering and opt-out respect.
- **The DeepSeek 2T-token corpus does not exist for us** — it was never
  released and must never appear as a provenance source (reuse doc § 2).
  Reusable public candidates and methodology references are listed in
  `docs/AI_LAB_DEEPSEEK_REUSE.md` §§ 3–4.
- **Dedup** (exact + MinHash-style near-duplicate) with the method id
  recorded in `Dataset.dedupMethod`.
- **Decontamination** against every eval suite in `EVALUATION.md`
  (`darus-mmlu-like`, `darus-arc-like`, `darus-domain-suites`, procedural
  holdouts), recorded in `Dataset.decontaminatedAgainst`. Eval-set isolation
  is non-negotiable.
- Corpus mix ratios across domains are hypotheses to be validated by
  ablation, not copied from any third-party recipe (reuse doc § 3).
- Planning placeholders live in `DARUS_DATASET_PLAN` (`model.config.ts`);
  they become real registry entries only after Phase J selection and license
  review.

## 2. Distillation as a later option (Stage F, gated separately)

Darus is the planned distillation target of the program, and distillation
from a strong teacher is a later **option** — not a committed path. The
honesty rules are fixed now:

- **Teacher outputs are data.** If a teacher model's outputs are ever used as
  training data, they are a dataset like any other: a `Dataset` registry
  entry with the teacher's honest `modelId`, its license terms, and the
  generation config recorded as provenance. The placeholder entry
  `ds_darus1_distillation_teacher_outputs_PLANNED` in `model.config.ts`
  encodes this duty up front.
- **License first.** The teacher's license/terms must explicitly permit
  using its outputs for training; evidence is recorded before any generation
  (see `DARUS_BASELINE_LICENSES`, all `pending` in this scaffold).
- **No relabeling.** The teacher keeps its honest identifier and
  `selfTrained: false`; distilled students are registered as their own
  checkpoints with `parentId` lineage — never presented as the teacher, and
  the teacher never as a Darus result (reuse doc § 6).
- **Decontamination applies to teacher generations too**, against the same
  eval suites, before they enter any corpus.

## 3. Stage plan (from docs/ROUGE_RESEARCH_HANDOFF.md)

- **Stage A — Corpus contracts.** Provenance + licensing rules,
  decontamination tooling, eval-set isolation. No training.
- **Stage B — Local smoke.** The SCP `model/` seed stack trains a tiny model
  end-to-end on a free-tier/CPU-adjacent budget; checkpoint + resume proven;
  eval spine wired. No scale claims.
- **Stage C — Eval first.** The suites in `EVALUATION.md` run against the
  configured baselines; results recorded honestly, including failures.
- **Stage D — Scale decision point.** Written proposal (data, budget,
  expected metrics, rollback) → owner sign-off → only then any GPU
  provisioning. The PLANNED architecture values in `model.config.ts` are
  fixed here — including the dense-vs-MoE decision (the MoE option is
  documented in `model.config.ts` as a comment, decided on Stage B/C
  evidence, not in advance).
- **Stage E — Training.** Under the approved proposal; every checkpoint is
  registered with `parentId` lineage and a `metricsRef` to measured results
  only.
- **Stage F — Distillation / refinement.** Own gate per proposal; § 2 rules
  apply.
- **Stage G — Publication.** Only measured results, with the full
  model/seed/config record.

## 4. Gate reminder

Current state: **TRAINING_READY=FALSE** (billing absent by owner deferral,
observability PARTIAL — `docs/PRODUCTION_CERTIFICATION.md` § 5). The Phase L
18-checkbox gate plus explicit owner authorization come before Stage E. This
scaffold contains no training code, no data downloads, and no GPU calls.

## 5. Artifact discipline

- No fabricated runs, benchmarks, or capability claims (handoff gate 3).
- No chain-of-thought storage anywhere in training or eval artifacts.
- Foreign weights used as teachers or baselines keep their honest identifiers
  and `selfTrained: false` (reuse doc § 6).
