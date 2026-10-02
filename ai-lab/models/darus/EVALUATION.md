# Darus — evaluation suite definition (draft)

Date: 2026-10-02 · Status: **definition only — nothing has been run or measured.**

This document defines how Darus (broad expert) will be evaluated once the
eval spine is wired (Stage C). It fixes protocol and grading rules in advance
so results, when they exist, are attributable and comparable.

## 1. Candidate benchmark suites

Candidates, not commitments. Each entry requires license review and a
decontamination record before use (Phase J contracts; see `TRAINING.md`).

| Suite id (registry)   | Kind                                       | Candidate source                                                             | License / decontamination notes                                                                                                                                                 |
| --------------------- | ------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `darus-mmlu-like`     | Broad multi-task academic knowledge        | MMLU-style multiple-choice benchmarks across many subjects                   | License terms of the chosen source must be verified; every training corpus is decontaminated against the exact eval items used (ids recorded in `Dataset.decontaminatedAgainst`). |
| `darus-arc-like`      | Grade-school science reasoning             | ARC-style multiple-choice science question sets                              | Same rules: license evidence per source; near-duplicate filtering against eval items is mandatory; the challenge/easy split used is recorded in the run config.                   |
| `darus-domain-suites` | Domain-specific professional/technical QA  | Per-domain suites (e.g. law-, medicine-, engineering-flavored QA sets)       | Each domain suite gets its own license review and its own decontamination record; domains are added one at a time, never in bulk without review.                                |
| `darus-procedural`    | Procedurally generated knowledge-reasoning | Teacher-written, code-checked generators (pattern: the Osirus M57 benchmark) | Generated from recorded seeds, answers computed by code, blind holdout seeds rotated — inherently decontamination-friendly.                                                     |

Third-party-reported numbers for these suites are never imported as evidence;
baselines are re-measured on this spine (reuse doc § 5).

## 2. Protocol: pass@1 with full recording

Every eval run records, per task:

- **model** — the honest `ModelBackend.modelId`;
- **seed** — the mandatory `GenerateRequest.seed` (the contract makes it
  non-optional for exactly this reason);
- **config** — the resolved backend config plus the experiment `configHash`
  (code revision, prompts, decoding parameters);
- decoding parameters (`temperature`, `maxTokens`, stop sequences);
- final answer text, token usage, latency, backend version string.

pass@1 means: one sample per task, no majority voting, no self-consistency, no
retries counted into the score. Multi-sample methods, if ever run, are
reported as separate, clearly named protocols.

## 3. Deterministic grading — verification engine first

Grading order (per ai-lab/ARCHITECTURE.md § 3):

1. **Deterministic checks decide first.** The Osirus verification engine
   (`src/lib/verification/engine.ts`, reused by interface — never imported
   into `ai-lab/`) grades structure, exact/numeric answer match, and
   executable checks. Model judgment cannot overturn a deterministic verdict.
2. **Model-based grading** is a fallback for free-form answers only, is run
   by a model other than the one under test where feasible, and is always
   flagged as such in the artifact.
3. **No chain-of-thought is persisted.** Artifacts contain final answers,
   scores, and the model/seed/config record — never reasoning traces.
4. **Honest failure recording.** Refusals, timeouts, and parse failures are
   recorded as failures, not dropped.

## 4. Distillation evaluation concept (plan, not a result)

Darus is the planned distillation target of the program. The corresponding
evaluation concept — honest as a plan, nothing here has run:

- **Teacher-vs-student comparison.** If Stage F distillation is authorized,
  the student is evaluated against its teacher on **identical suites, tasks,
  and seeds**, both graded by the verification engine. The draft experiment
  `exp_darus1_distillation_eval_PLANNED` (see `model.config.ts`) reserves this
  comparison.
- **Parity-per-parameter evidence.** The interesting quantity is how much of
  the teacher's measured pass@1 the student retains at its parameter count —
  reported as a measured ratio, never as an assumed win.
- **Teacher honesty.** The teacher keeps its honest upstream `modelId` and
  `selfTrained: false`; teacher outputs used as training data carry full
  provenance (see `TRAINING.md` § 2). A teacher is never presented as a Darus
  result.
- **Contamination guard.** Teacher generations are decontaminated against the
  same eval suites before they may enter any training corpus.

## 5. Baselines and claims

- The draft experiment `exp_darus1_baseline_eval_PLANNED` (see
  `model.config.ts`) re-measures the configured foreign baselines on these
  suites before any Darus comparison.
- A Darus capability claim requires: measured result on this spine + the
  Darus-vs-baseline comparison on identical tasks, seeds recorded, and the
  verification engine as grader.
- Holdout seeds are used once; if the model or prompts change, the next run
  uses a fresh seed (pattern: M57 gate in `docs/rouge/architecture.md`).
