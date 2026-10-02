# AI Lab — Benchmark Philosophy (Phase J)

Date: 2026-10-02 · Branch: `ai-lab/datasets-evals` · Status: binding for every
eval result that leaves the lab. Implements spec § 27 and
`ai-lab/ARCHITECTURE.md` § 3.

## 1. No unmeasured claims

A capability number exists only if it was measured on our own eval spine and
is backed by an `EvalRecord`. Projections, extrapolations, and vendor claims
are not evidence. If it was not run, it is not reported.

## 2. Reported vs. measured

Third-party-reported numbers (e.g. the base-model landscape table in
`docs/AI_LAB_DEEPSEEK_REUSE.md` § 5) are labeled **reported** and must never
appear in an Osirus artifact as if they were ours. Before a reported number
may inform a decision, it is **re-measured** on this spine with the full
protocol below. Reported and measured figures are stored and shown
separately, always.

## 3. Protocol: model / seed / config

Every run records, per task: `modelId` (the honest upstream identifier,
never a rebrand), `backendKind`, the mandatory RNG `seed`, a `configHash`
over the run configuration, the grader kind, latency, and an ISO timestamp.
pass@1 without a seed is not acceptable evidence — the runner enforces this
by throwing on a missing or non-integer seed. Failures are recorded
alongside passes; cherry-picking is a policy violation.

## 4. Deterministic graders first

Grading order of precedence:

1. **Deterministic graders** (exact match, contains, regex, executable
   checks) are the default. They are reproducible, auditable, and free of
   judge bias.
2. **Model-as-judge** is a gated escape hatch only: the run must enable it
   explicitly and supply a judge function, and every record it touches is
   flagged `modelJudged: true` so judged numbers can never be mixed silently
   into deterministically graded results. Unflagged model judgment is a
   policy violation.

No chain-of-thought is persisted in eval artifacts — only final answers,
scores, and the model/seed/config record.

## 5. Decontamination duty

Eval-set isolation is non-negotiable. Every training corpus is
decontaminated against every eval set we run (HumanEval, MBPP, DS-1000,
MultiPL-E, plus future Rouge suites) via n-gram overlap removal, and the
cleaned-against set is recorded in `Dataset.decontaminatedAgainst`
(see `datasets/POLICY.md`). A benchmark number produced on a contaminated
model is invalid evidence and is discarded, not footnoted.

## 6. Honesty invariants

- Foreign weights (DeepSeek, Qwen, …) are baselines only and are never
  labeled as self-trained Rouge/Quesnir/Darus models.
- Baselines are recorded including failures.
- Suites evolve; when a suite changes, old numbers stay attached to the old
  suite version and are not silently re-labeled.
