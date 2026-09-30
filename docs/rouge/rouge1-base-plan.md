# Rouge 1 on the best trainable open model (owner decision 2026-09-30)

## Decision

- **What Rouge 1 is:** a derivative of **Qwen/Qwen3.6-27B**, trained further by us.
  - Licence: Apache-2.0. The base is pinned at revision `6a9e13bd6fc8f0983b9b99948120bc37f49c13e9` (15 shards, 55.6 GB, every sha256 recorded). Details are in `models/rouge-1/base.json`.
  - Pin run: GitHub Actions 36765841051.
  - The earlier base, Qwen3.5-27B, is recorded under `supersedes`.
  - The owner decided not to start from scratch. Our infrastructure, data pipeline, evaluation and research results stay.
  - Rouge never claims to be pretrained from scratch. Its identity data names the pinned base.
- **Why this base:**
  - It is the strongest open model we can fully train on one 8-GPU machine and run locally.
  - It is dense: 27B parameters, 64 layers (48 Gated DeltaNet, 16 gated attention), 262k context, with a vision tower.
  - Secondary sources report it above Qwen's own 397B MoE on agentic coding. Rouge claims only what our own evaluation measures.
  - It is the same architecture class as the M58 pipeline (`Qwen3_5ForConditionalGeneration`), so training, merge, evaluation and edge code apply unchanged.
- **Why not the largest open models:** Kimi K3 (2.8T), DeepSeek V4-Pro (1.6T), GLM-5.3 (753B) and MiMo-V2.6-Pro (about 1T) do not fit the budget or the device.
  - Their bf16 weights alone take 1.5–5.6 TB.
  - Full training needs about 16 bytes per parameter.
  - They cannot run on a Mac.
  - Closed models (Opus 5.5, GPT-6 Astra, Gemini) have no downloadable weights.
- **No base variant:** `Qwen/Qwen3.6-27B-Base` does not exist (the pin run failed with not found). Training therefore continues from the post-trained model.

## Frontier open models measured (Hub metadata, 2026-09-30)

Source: `rouge-base-manifest.yml` runs 36770848733, 36770852627 and 36770856392. The byte counts come from the Hub's own LFS metadata. One B200 has 180 GB of GPU memory; B200_X_8 has 1.44 TB; H200_X_8 has 1.13 TB.

| Model | Weights on the Hub | Parameters | Stored as | Licence | Fits 1 × B200 | Fits the largest Lightning machine | Full training memory (about 16 B per parameter) | Local (Mac) |
|---|---|---|---|---|---|---|---|---|
| DeepSeek-V4-Pro @ b5968e9 | 864.7 GB (64 shards) | 1.60 T (61 layers, 384 experts, top-6) | FP4 experts, FP8 rest | MIT | no (4.8×) | inference only (B200_X_8) | about 26 TB (about 145 B200) | no |
| Kimi-K3 @ f831ab6 | 1,560.9 GB (96 shards) | 2.78 T (93 layers, 896 experts) | MXFP4 experts | custom "kimi-k3" licence: revenue and branding conditions, not open source | no (8.7×) | no (above 1.44 TB) | about 44 TB | no |
| DeepSeek-V4-Flash @ 60d8d70 | 159.6 GB (46 shards) | 291 B (43 layers, 256 experts, top-6) | FP4 experts, FP8 rest | MIT | inference, tight | yes; adapters or partial training | about 4.7 TB | Mac Studio with 192 GB or more |
| Qwen3.6-27B @ 6a9e13b (pinned) | 55.6 GB | 27.8 B dense | BF16 | Apache-2.0 | yes | full training on H200_X_8 | about 0.44 TB | Mac with 32 GB or more |

## Method: one RSI iteration per paid session

Recipe: ReST-EM style self-training (Singh et al. 2023, "Beyond Human Data"), trained full-parameter.

| Step | What happens | Where |
|---|---|---|
| Base | Download the pinned revision from the Hub onto the GPU machine and check every sha256 | `rouge1_job.sh` BASE |
| Data | Built dataset from the private Lightning registry, checked against its committed manifest | DATA |
| Baseline | Pre-registered eval set, one vLLM engine per GPU, thinking on, temperature 0 | EVAL_BASE |
| Sample | The model answers 3,200 verifiable math prompts 4 times each (temperature 1.0, up to 6,144 tokens) | SAMPLE (`rouge_train.rft`) |
| Select | Code-verified answers only (see the selection rules below) | SELECT |
| Train | Every language-model weight (vision frozen), FSDP2 over 8 × H200. Selected answers plus in-house and human-written German data. 2 epochs, lr 5e-6 | TRAIN (`rouge_train.full`) |
| Verdict | Same items, same settings. PASS needs the primary suite to improve (McNemar p < 0.05) and no guard to drop 5 points (or significantly) | EVAL_ROUGE, VERDICT |
| Save | Checkpoint manifest, model in the private registry, GGUF Q4_K_M after a PASS | SAVE, EDGE |

**Selection rules:**
- A prompt the model solves only sometimes contributes up to 2 correct answers.
- A prompt it always solves contributes 1 answer, for a fixed 25% of such prompts.
- A prompt it never solves contributes nothing.

**Evaluation suites:**
- **Primary:** 300 held-out verifiable problems from the same sources as the prompts, never among them.
- **Guards:** MGSM en/de, MBPP (unit tests executed) and IFEval.
- **Report-only:** generated format, German and identity items.

**Why self-generated data:**
- Older teacher traces (DeepSeek-R1 era) are weaker than the base, and training them in risks regression. Their problems serve as prompts only.
- Training on the model's own verified answers keeps it close to its own distribution (little forgetting) and moves pass@1 toward pass@k on the target domain.
- Each passed iteration becomes the parent of the next (`--parent`). That is the self-improvement loop.
- The evaluation sets, gates and budget stay outside the model's reach.

## Money (live prices 2026-09-30)

- **Machine:** H200_X_8 at 36.00 USD/h: 8 × 141 GB with NVLink, 7.9 PFLOPS bf16.
  - Per dollar it matches B200 (220 vs 228 TFLOPS/USD).
  - Lightning offers B200 only as a single GPU or as an 8-GPU machine. Three single B200 machines have no NVLink between them.
- **The owner's figure:** "2–3 B200 × 10 h" would cost 197–296 USD. 125 credits buy about 3.3 h of H200_X_8.

| Phase | Hours | USD |
|---|---|---|
| Setup, download, verification | 0.25 | 9 |
| Baseline evaluation | 0.15 | 6 |
| Sampling (3,200 × 4) | 0.5 | 18 |
| Training (budget check at 1.0 h) | ≤ 1.0 | ≤ 36 |
| Evaluation, verdict, upload, GGUF | 0.4 | 15 |
| **One iteration** | **≈ 2.3** | **≈ 84** |

- **Budget:** 125 credits cover one iteration with margin, or two shorter ones. The launcher refuses a worst case (max hours × live price × 1.05) above the ceiling or the balance.
- **Approval:** every run waits for the owner in the protected environment `rouge-gpu`.

## Local use without a server

- The weights are never in the public repository.
- `training/rouge/serve/install.py --run <checkpoint>` does the following:
  1. Downloads the checkpoint's GGUF (Q4_K_M, about 17 GB) from the private registry with the owner's key.
  2. Checks every sha256.
  3. Refuses machines that cannot hold it.
- With `--serve` it starts llama.cpp's `llama-server` on 127.0.0.1.
- **Devices:** a Mac with 32 GB or more runs Q4_K_M. 24 GB needs a smaller quantisation. An iPad or iPhone needs a distilled Rouge Edge Mobile (planned, not built).

## Sequence

1. **Free:** build the `rft-v1` dataset on a runner (`rouge-data.yml`). It is stored in the registry and its manifest is committed.
2. **Free:** fill the eval hash into `experiments/rouge-1-rl-001.json` and set its status to `pre-registered`.
3. **Owner:** add credits and approve `rouge-train.yml task=rouge1 run=rouge-1-rl-001 machine=H200_X_8 max_hours=2.5`.
4. **Result:**
   - PASS: `rouge-1-rl-001` becomes the parent of `rouge-1-rl-002`, and its GGUF is installable.
   - FAIL: the base stays Rouge 1 v0 and a changed recipe is registered as `rouge-1-rl-002`.

## What happens to the native model work

It stays as research for Rouge 2 and a small edge model. These parts carry over to Rouge 1:
- the corpus pipeline and decontamination rules;
- the eval harness;
- the Lightning launcher, cost guards and ledger;
- the CRI control plane.

The 2B native MoE run on B200 (`docs/rouge/b200-plan.md`) is superseded. Its credits go to Rouge 1.
