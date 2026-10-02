# Quasnir — Evaluation Plan

Date: 2026-10-02 · Status: **plan only — no eval has been run; no results exist.**

This document defines the evaluation suite for Quasnir (coding + security).
It wires the DeepSeek-Coder eval methodology (reuse doc § 3, eval-harness row)
into the Osirus eval spine (`ai-lab/ARCHITECTURE.md` § 3).

## 1. Protocol

- **Metric:** pass@1, deterministic decoding (temperature 0) unless a suite
  requires sampling — in which case the sampling parameters are part of the
  recorded config.
- **Recording:** every run records the full **model / seed / config** triple.
  `GenerateRequest.seed` is mandatory in the backend contract for exactly this
  reason; a pass@1 number without a seed is not acceptable evidence.
- **Arbitration:** deterministic checks (compilation, test execution) outrank
  model judgment, via the Osirus verification engine, wrapped — not forked.
- **Artifacts:** final answers, scores, and the model/seed/config record only.
  No chain-of-thought is persisted.

## 2. General coding suites (starting set, per reuse doc § 3)

| Suite     | Scope                                  | Notes                                  |
| --------- | -------------------------------------- | -------------------------------------- |
| HumanEval | Python function synthesis              | 164 tasks; canonical pass@1 benchmark  |
| MBPP      | Python crowd-sourced problems          | Use the sanitized split where possible |
| DS-1000   | Data-science Python (numpy/pandas/…)   | Execution-based grading                |
| MultiPL-E | HumanEval/MBPP translated to 18+ langs | Cross-language generalization check    |

## 3. Security-coding suites (candidates — pending license + decontamination review)

Quasnir's security specialization needs security-coding evaluation beyond the
general suites. Candidates, **not yet adopted**:

| Candidate                                  | What it measures                                        | Open questions before adoption                                              |
| ------------------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------- |
| SecurityEval-style suite (Siddiq & Santos) | Vulnerable-code generation (CWE-mapped prompts)         | License must be verified at integration time; scope is Python-heavy         |
| Meta CyberSecEval-style suite              | Insecure-code suggestion rate, exploit-ish task framing | License terms per release must be checked; overlap with training data audit |
| CWE-tagged secure-coding tasks (own)       | Secure vs. insecure completion on curated CWE prompts   | Must be built fresh; no public equivalent with clean licensing assumed      |

Rules for adopting any security suite:

1. **License check first.** A suite enters the config only after its license
   and redistribution terms are verified and recorded (same discipline as
   dataset contracts: license + provenance mandatory).
2. **Decontamination cuts both ways.** Once a suite is adopted, every Phase J
   dataset is decontaminated against it and records it in
   `Dataset.decontaminatedAgainst` — eval-set isolation is non-negotiable.
3. **Honest scoring.** "Insecure suggestion rate" is reported alongside pass@1;
   neither is cherry-picked.

## 4. Honest baseline policy

- Third-party-reported numbers (reuse doc § 5 table, e.g. Qwen2.5-Coder-32B
  HumanEval ~92.7) are marked **"reported"** and never presented as our
  measurements.
- A baseline number becomes an Osirus artifact only after **re-measurement on
  this spine** with a recorded model/seed/config triple.
- Failures are recorded with the same fidelity as successes.
- The scaffold ships zero results. The first real numbers appear only after a
  gated run exists (TRAINING.md, gate section).

## 5. Result record shape (planned)

Each eval artifact records, at minimum:

```
{
  suite, suiteVersion,
  modelId, seed, configHash, backendVersion,
  passAt1, taskCount, failures: [...],
  createdAt
}
```

This mirrors the checkpoint contract (`metricsRef` links measured results —
never projections).
