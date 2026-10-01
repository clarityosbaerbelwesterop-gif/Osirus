# AI Lab — DeepSeek-Coder Reuse Analysis (owner directive 2026-10-02)

Date: 2026-10-02 · Status: **Analysis only — no training, TRAINING_READY=FALSE.**
Input: owner directive (with screenshots of the `deepseek-ai/DeepSeek-Coder` README):
"Viel Trainingsdaten und Infrastruktur können wir vom Deepseek Coder Repo nehmen und
optimieren." This document records what is actually reusable, what is not, and where it
lands in the phase plan (spec § 33). Every claim here is verifiable against the cited
public artifacts.

## 1. What DeepSeek-Coder v1 is (verified facts)

From the project README/paper (arXiv:2401.14196) and Hugging Face model cards:

- Trained **from scratch** on **2T tokens**: **87% code / 13% natural language** (EN+ZH).
- Sizes: 1B / 5.7B / 6.7B / 33B; window 16K; **fill-in-the-middle (FIM)** objective.
- Corpus built **project-level**: whole repositories parsed, files ordered by dependency,
  not isolated file shuffling; 80+ programming languages.
- Published benchmarks (Base-33B): HumanEval 56.1 (Python) / 50.3 (multilingual),
  MBPP 66.0, DS-1000 40.2; Instruct-33B HumanEval 79.3.
- Repo license: code MIT. **Model weights: DeepSeek license** — commercial use permitted,
  redistribution/derivative conditions apply. Verify current terms at integration time.

## 2. Critical correction: the training data is NOT in the repo

The 2T-token corpus was **never released**. The repository contains inference code,
fine-tuning scripts, the evaluation harness, and tokenizer configs — not the data.
"Take the training data from the repo" is therefore not possible; what we can take is
the **methodology** (which the paper documents in enough detail to re-implement) plus
publicly available corpora. This distinction matters for Phase J data contracts: we must
not record "DeepSeek corpus" as a provenance source, because we cannot obtain or license
it. Honest alternatives exist (§ 4).

## 3. Reuse matrix

| Component                                               | What we take                                                      | Lands in             | Caveat                                                                                     |
| ------------------------------------------------------- | ----------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------ |
| Data mix (87% code / 13% NL)                            | Starting hypothesis for Quesnir corpus ratios                     | Phase J contract     | Ratios to be validated by ablation, not copied blindly                                     |
| Repo-level parsing + dependency-ordered file sequencing | Concrete algorithm for corpus construction                        | Phase J pipeline     | Re-implement; the original code is not public                                              |
| FIM objective (PSM/SPM modes)                           | Training objective for Quesnir completion tasks                   | Phase I config       | Requires tokenizer-level support                                                           |
| Dedup + benchmark decontamination                       | Mandatory contract rules (near-dup filtering, eval-set isolation) | Phase J              | Non-negotiable per spec § 27                                                               |
| Eval harness (HumanEval/MBPP/DS-1000/MultiPL-E)         | Benchmark suite + pass@1 protocol with model/seed/config recorded | Phase J / eval spine | Wire into Osirus verification engine                                                       |
| Open checkpoints (1B–33B)                               | Baselines under `ModelBackend` (LocalInference / RemoteInference) | Phase I scaffold     | **Never labeled as self-trained** Rouge/Quesnir/Darus models; DeepSeek license terms apply |
| Fine-tune scripts                                       | Reference for Phase I fine-tune path                              | Phase I              | Adapt to our stack; SCP `model/` remains the seed scaffold                                 |

## 4. Public corpora that actually exist (Phase J candidates)

- **The Stack v1/v2** (BigCode): permissively licensed code, opt-out honored, governance
  documented — primary candidate.
- **StarCoder2 training data** (Software Heritage-derived): documented pipeline.
- **CodeSearchNet**, commit/diff datasets for instruction tuning.
- Web-derived code/math text per the DeepSeek-Coder-V2 approach (arXiv:2406.11931):
  fastText-recalled Common Crawl slices — only with license filtering.
- All ingestion goes through Phase J contracts: provenance, license, dedup,
  decontamination against every eval set we run. No exceptions.

## 5. Base-model landscape check (October 2026)

DeepSeek-Coder v1 (2023) is no longer the strongest open starting point. Current
candidates, to be re-measured on our own eval spine before any decision:

| Model                      | Params                | License         | HumanEval (instruct, reported) | Note                            |
| -------------------------- | --------------------- | --------------- | ------------------------------ | ------------------------------- |
| Qwen2.5-Coder-7B-Instruct  | 7B                    | Apache-2.0      | ~88.4                          | Strong small default            |
| Qwen2.5-Coder-32B-Instruct | 32B                   | Apache-2.0      | ~92.7                          | Best documented open code model |
| DeepSeek-Coder-V2-Lite     | 16B MoE (2.4B active) | DeepSeek custom | ~81.1 (Python)                 | FIM-capable, 338 languages      |
| DeepSeek-Coder-V2          | 236B MoE (21B active) | DeepSeek custom | ~96 (reported)                 | Serving cost high               |

Qwen3-Coder and newer releases must be surveyed at Phase I time; this table is a
snapshot, not a decision. All benchmark numbers above are third-party-reported and must
be re-measured on our harness before they appear in any Osirus artifact.

## 6. What we explicitly do NOT take

- No assumption that the DeepSeek 2T corpus exists for us — it does not.
- No scraping of GitHub/Common Crawl without license filtering and opt-out respect.
- No use of DeepSeek weights relabeled as Osirus/Rouge/Quesnir/Darus self-trained models.
- No training runs, no GPU spend — TRAINING_READY=FALSE; the 18-checkbox gate (Phase L)
  and explicit owner authorization come first.

## 7. Integration into the phase plan

- **Phase H**: this analysis becomes the external-reuse section alongside
  `docs/SCP_REUSE_MATRIX.md`.
- **Phase I**: Quesnir scaffold lists the § 5 models as `APIProvider`/`LocalInference`
  fallback baselines; FIM support recorded in the model config.
- **Phase J**: §§ 3–4 become binding dataset-contract clauses (mix targets, repo-level
  ordering, dedup, decontamination, licensing evidence per source).
- Gate status unchanged: documentation only, zero spend, zero training.
