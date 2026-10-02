# SCP Reuse Matrix (Phase H — gate document)

Date: 2026-10-02 · Status: **documentation only — TRAINING_READY=FALSE, zero spend,
zero training.** Companion documents: `docs/ROUGE_RESEARCH_HANDOFF.md` (hard gates),
`docs/AI_LAB_DEEPSEEK_REUSE.md` (external reuse), `ai-lab/ARCHITECTURE.md` § 4
(registry layer this matrix feeds).

This matrix records what the Osirus/Rouge/Quesnir/Darus program takes from the SCP
repository (`clarityosbaerbelwesterop-gif/swarm-compute-protocol-`, audited in
`docs/OSIRUS_MASTER_AUDIT.md` / `docs/PROJECT_STATE.md` § 6) and from Osirus itself.
Every row is marked with how it was verified; rows that rest on the takeover audit
rather than a fresh file read say so explicitly.

## 1. Source verification (2026-10-02)

The SCP repository **was located and read directly** for this matrix (GitHub API,
branch `main`, head commit `ab2db73f36adff7ceea6130855a990d8e652720e`):

- `model/scp_model/model.py` — decoder-only transformer, Llama/Mythos family:
  RMSNorm, RoPE, grouped-query attention, SwiGLU, optional tied embeddings.
- `model/scp_model/bpe.py` — from-scratch byte-level BPE with GPT-2-style regex
  pre-tokenization, train/save/load, no external tokenizer dependency.
- `model/scp_model/data_pipeline.py` — token-file builder (`.bin` + `.meta.json`),
  `MemmapTokenDataset` (numpy memmap batches), exact-hash dedup, weighted
  multi-corpus mixing with auditable realized mix fractions.
- `model/scp_model/trainer.py` — production loop: bf16/fp16 autocast, gradient
  accumulation + clipping, cosine LR, periodic validation perplexity, and
  checkpoint/resume (`save_ckpt`/`load_ckpt` with optimizer state).
- `model/scp_model/teacher.py` — distillation client (Kimi K2 via NVIDIA's
  OpenAI-compatible API) generating coding + reasoning corpora; injectable
  `complete_fn` makes it testable offline.
- `backend/core/sandbox.py` — see row 8: its own module docstring states it is
  **not** a security boundary ("keine Sicherheits-Sandbox gegen bösartigen Code").
- `backend/core/protocol.py` + `backend/core/compute_share.py` — `SwarmFabric`:
  an in-process simulation of RNG-synthesized nodes with a credit ledger; no
  runners, no GPU orchestration, no distributed execution anywhere in the repo.
- `backend/core/keypool.py` — thread-safe multi-key round-robin with 429 cooldown.

Osirus-side paths were verified against the `main` tree on the same date:
`src/lib/intelligence/`, `src/lib/verification/engine.ts`, `src/lib/arena/`
(gate/harness/metrics/suites), `evals/*.eval.ts`.

## 2. Reuse matrix

Reuse values: **direct** (usable as-is), **adapt** (usable with recorded changes),
**reference** (pattern to re-implement, not to import), **DO-NOT-REUSE**.

| #   | Asset                                                                                      | Source (SCP repo / Osirus)                                    | Reuse            | Target                              | Verification                           | Caveats                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ---------------- | ----------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Transformer core (RMSNorm, RoPE, GQA, SwiGLU, presets tiny→large)                          | SCP `model/scp_model/model.py`, `config.py`                   | direct (seed)    | Rouge/Quesnir (ai-lab Phase I)      | verified — file read 2026-10-02        | Single-process only; no DDP/FSDP. Scales by config, but any scale run waits for the Stage D decision point.                                           |
| 2   | Byte-level BPE tokenizer (GPT-style pre-tokenization, save/load)                           | SCP `model/scp_model/bpe.py`                                  | direct           | Rouge/Quesnir (Phase I/J tokenizer) | verified — file read 2026-10-02        | Vocab must be trained on the real Phase J corpus, not on synthetic bootstrap data.                                                                    |
| 3   | Memmap corpus pipeline (token `.bin` + meta, `MemmapTokenDataset`, clean/dedup/mix)        | SCP `model/scp_model/data_pipeline.py`                        | adapt            | ai-lab Phase J data pipeline        | verified — file read 2026-10-02        | Dedup is exact-hash only; MinHash near-dup (spec § 27) and eval-set decontamination must be added. License/provenance move into the dataset registry. |
| 4   | bf16 trainer with checkpoint + resume (AdamW, cosine LR, grad accum/clip, val perplexity)  | SCP `model/scp_model/trainer.py`                              | direct (seed)    | Rouge/Quesnir (Phase I)             | verified — file read 2026-10-02        | Single GPU. Stage B smoke (tiny run, resume proven, eval spine wired) before any scale discussion.                                                    |
| 5   | Distillation client (teacher-generated coding/reasoning corpora, injectable `complete_fn`) | SCP `model/scp_model/teacher.py`                              | adapt            | Rouge Stage E distillation          | verified — file read 2026-10-02        | Teacher returns text, not compute. Needs API key + network. Teacher output is data, never evidence of self-trained capability.                        |
| 6   | Corpus recipe (Corpora 1–3: named sources, weights, license notes, quality filters)        | SCP `model/scp_model/corpora.py`                              | reference        | ai-lab Phase J dataset contracts    | verified — file read 2026-10-02        | Mix weights are hypotheses to validate by ablation. License notes become binding dataset-contract clauses (registry: license + provenanceUri).        |
| 7   | LLM KeyPool (multi-key round-robin, 429 cooldown)                                          | SCP `backend/core/keypool.py`                                 | reference        | ai-lab model-backend adapters       | verified — file read 2026-10-02        | Pattern only; lab backends program against `contracts/model-backend.ts`, not SCP code.                                                                |
| 8   | `sandbox.py` subprocess check-runner (rlimits, env allowlist, process-group kill)          | SCP `backend/core/sandbox.py`                                 | **DO-NOT-REUSE** | —                                   | verified — file read 2026-10-02        | Forbidden as a security boundary per spec; its own docstring admits it is not one. Osirus uses `@vercel/sandbox` deny-by-default instead.             |
| 9   | Simulated compute swarm (`SwarmFabric`, leases, credit ledger; 10k RNG-synthesized nodes)  | SCP `backend/core/protocol.py`, `compute_share.py`            | **DO-NOT-REUSE** | —                                   | verified — file read 2026-10-02        | Not real compute: no runners, no GPU orchestration (flagged "erfunden" by SCP's own audit). Never presented as training infrastructure.               |
| 10  | SCP commerce/OAuth/webapp/PWA/iOS/Streamlit stack                                          | SCP `backend/core/sepa.py`, `stripe_*`, `tiers.py`, `webapp/` | **DO-NOT-REUSE** | —                                   | audit-verified (PROJECT_STATE § 6)     | Must remain separate; Osirus has its own billing path (Phase E).                                                                                      |
| 11  | Eval spine (eval harness, capability pulse, benchmark/curriculum infrastructure)           | Osirus `src/lib/intelligence/`, `evals/`                      | adapt            | Rouge/Quesnir/Darus eval harness    | verified — `main` tree 2026-10-02      | Reused by documented interface, not by import (ai-lab stays severable). Baselines recorded honestly, including failures.                              |
| 12  | Verification engine (deterministic checks outrank model judgment)                          | Osirus `src/lib/verification/engine.ts`                       | direct (wrap)    | ai-lab run/benchmark grading        | verified — `main` tree 2026-10-02      | Wrap, do not fork. pass@1 with full model/seed/config record per run.                                                                                 |
| 13  | Foundry arenas (gate/harness/metrics/suites + `evals/foundry.eval.ts`)                     | Osirus `src/lib/arena/`, `evals/`                             | adapt            | Rouge/Quesnir/Darus task suites     | verified — `main` tree 2026-10-02      | Rouge-specific suites (M59–M75) are defined on experiment branches, graded by row 12.                                                                 |
| 14  | Migration-ledger pattern (sha256, idempotent)                                              | Osirus `db/` migrations                                       | reference        | ai-lab registries (Phase H)         | audit-verified (OSIRUS_MASTER_AUDIT I) | Pattern for the append-only dataset/checkpoint/experiment stores; no DB dependency in the lab.                                                        |

## 3. Standing rules (from the handoff gates, repeated because they bind every row)

1. No Rouge/Quesnir/Darus/ai-lab code merges into `main`.
2. No GPU spend without `TRAINING_READY=TRUE` **and** explicit owner authorization.
   Current state: **TRAINING_READY=FALSE**.
3. No fabricated training runs, benchmarks, or capability claims. Foreign weights and
   teacher-generated data are never relabeled as self-trained Rouge/Quesnir/Darus
   results.
4. SCP's `sandbox.py` is never a security boundary; SCP's simulated swarm is never
   presented as real compute. Both prohibitions are absolute, not matters of degree.
