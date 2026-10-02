# Quasnir — Training Plan (data recipe)

Date: 2026-10-02 · Status: **plan only — TRAINING_READY=FALSE. Nothing trains
before the Phase L 18-checkbox gate and explicit owner authorization.**

Source methodology: `docs/AI_LAB_DEEPSEEK_REUSE.md` (DeepSeek-Coder reuse
analysis). What we reuse is **methodology, not data** — the DeepSeek 2T-token
corpus was never released and must never appear as a provenance source
(reuse doc § 2).

## 1. Data mix — starting hypothesis

- **87% code / 13% natural language** (EN), following the DeepSeek-Coder v1
  recipe (reuse doc § 1).
- This is a **hypothesis, to be validated by ablation**, not a copied truth
  (reuse doc § 3). Ablation candidates: 87/13 vs. 70/30 vs. 95/5, measured on
  the EVALUATION.md suites at small scale before any scale decision.

## 2. Corpus construction (Phase J pipeline)

Per `ai-lab/ARCHITECTURE.md` § 1, stages are pure transforms with recorded
manifests:

1. **ingest** — only from public corpora with recorded `source`, `license`,
   `provenanceUri` (§ 4 below).
2. **license-filter** — drop anything without a permissive license or with a
   recorded opt-out. No unfiltered GitHub/Common Crawl scraping.
3. **dedup (near-dup)** — exact + near-duplicate filtering (MinHash-style
   fingerprinting); method identifier recorded in `Dataset.dedupMethod`.
4. **decontamination** — remove any overlap with every eval suite we run
   (EVALUATION.md §§ 2–3, including adopted security suites); recorded in
   `Dataset.decontaminatedAgainst`. **Eval-set isolation is non-negotiable.**
5. **tokenize** — SCP BPE tokenizer, extended with FIM special tokens.
6. **pack** — **repo-level parsing with dependency-ordered file sequencing**:
   whole repositories are parsed and files ordered by dependency, not shuffled
   as isolated files (DeepSeek-Coder methodology, reuse doc § 3). The original
   implementation is not public; we re-implement the algorithm from the paper.

## 3. FIM objective

- Fill-in-the-middle training with **PSM** or **SPM** layout; configured in
  `model.config.ts` (`fim: { enabled, format, rate }`, starting hypothesis
  PSM @ 0.5).
- Requires tokenizer-level support (FIM special tokens in the SCP BPE stack)
  **before** any training run — this is a Phase I prerequisite, not an
  afterthought.

## 4. Public corpora candidates (Phase J)

Per reuse doc § 4:

- **The Stack v1/v2** (BigCode) — permissively licensed code, opt-out honored;
  primary candidate.
- **StarCoder2 training data** (Software Heritage-derived) — documented
  pipeline.
- **CodeSearchNet**, commit/diff datasets — instruction-tuning candidates.
- Web-derived code text per the DeepSeek-Coder-V2 approach — **only** with
  license filtering and opt-out respect.

Every source records license + provenance in the dataset contract. No
exceptions.

## 5. Binding Phase-J clauses (non-negotiable)

These carry over from reuse doc § 3 as contract rules, not aspirations:

1. Near-duplicate dedup is mandatory; the method is recorded per dataset.
2. Decontamination against every eval set is mandatory; the eval sets are
   recorded per dataset.
3. No source without licensing evidence enters the corpus.
4. "DeepSeek 2T corpus" never appears as a provenance source — it does not
   exist for us.

## 6. Gate

**TRAINING_READY = FALSE.** Before any training run:

1. Stage B smoke (tiny end-to-end run proving checkpoint + resume and eval
   wiring) on free-tier/single-GPU budget.
2. Written scale proposal (data, budget, expected metrics, rollback) → owner
   sign-off (Stage D decision point).
3. Phase L 18-checkbox gate passes.
4. Explicit owner authorization.

No GPU spend, no training code, and no data downloads exist in this scaffold.
