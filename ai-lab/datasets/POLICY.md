# AI Lab — Data Policy (Phase J)

Date: 2026-10-02 · Branch: `ai-lab/datasets-evals` · Status: binding data
contract for every corpus that enters the lab. Derived from
`docs/AI_LAB_DEEPSEEK_REUSE.md` §§ 3–4 and `ai-lab/ARCHITECTURE.md` § 1.
Violations block ingestion; there are no exceptions.

## 1. Hard rules

1. **Provenance is mandatory.** Every dataset carries a resolvable
   `provenanceUri` (repo URL + commit, DOI, or archive id) recorded in the
   dataset registry (`contracts/dataset.ts`). No anonymous dumps.
2. **License evidence is mandatory.** Ingestion without license filtering is
   prohibited. Only permissively licensed sources pass
   (`datasets/pipeline.ts` → `licenseFilter`): Apache-2.0, MIT, ISC, BSD
   family, CC-BY family, CC0-1.0, Unlicense and equivalents (see
   `DEFAULT_LICENSE_POLICY`). Copyleft (GPL/AGPL) and non-commercial
   (CC-BY-NC-\*) licenses are excluded.
3. **Opt-outs are honored.** Recorded author opt-outs (e.g. The Stack opt-out
   list) remove data regardless of license. No unfiltered GitHub/Common Crawl
   scraping.
4. **Dedup is mandatory and recorded.** Exact dedup plus near-duplicate
   filtering (`minhash-light-v1`, MinHash banding + Jaccard verification over
   token shingles). The method id lands in `Dataset.dedupMethod`.
5. **Decontamination is non-negotiable** (spec § 27). Every corpus is cleaned
   against every eval set we run — HumanEval, MBPP, DS-1000, MultiPL-E, plus
   future Rouge suites — via 13-gram overlap removal. The cleaned-against set
   lands in `Dataset.decontaminatedAgainst`.
6. **Repo-level ordering.** Packing orders files by intra-repository
   dependency (`repoOrder`: import-edge topological sort, stable fallback on
   cycles), re-implemented from the DeepSeek-Coder paper; the original code
   is not public.
7. **Mix targets are hypotheses.** The 87% code / 13% natural-language ratio
   is a starting hypothesis validated by ablation, not copied blindly.

## 2. The DeepSeek corpus clause

**The DeepSeek 2T-token training corpus is NOT available.** It was never
released; the DeepSeek-Coder repository ships inference code, fine-tuning
scripts, and an eval harness — not data (reuse doc § 2). It must therefore
**never appear as a provenance source** in any dataset registry entry. What
we reuse is the _methodology_ (repo-level parsing, dependency-ordered
sequencing, dedup + decontamination discipline, FIM objective), not the data.

## 3. Candidate sources

Only publicly obtainable, license-checkable corpora qualify:

- **The Stack v1/v2** (BigCode) — permissively licensed code, documented
  governance, opt-out honored. Primary candidate.
- **StarCoder2 training data** (Software Heritage-derived) — documented
  pipeline.
- **CodeSearchNet** — instruction-tuning and code–text pairs.
- Commit/diff datasets for instruction tuning.
- Web-derived code/math slices (DeepSeek-Coder-V2 style, arXiv:2406.11931) —
  only after license filtering and opt-out checks.

Every source is recorded with `source`, `license`, `provenanceUri`,
`dedupMethod`, and `decontaminatedAgainst` before it may feed any training
stage.
