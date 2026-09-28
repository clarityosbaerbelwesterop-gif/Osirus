# Rouge 1 — compute plan (M58)

Rouge 1 is a derivative of **Qwen3.5-397B-A17B**, pinned at revision
`8472618112abcbd45acbcdc58436aff4233c23f7`. The pin is in
`training/rouge/manifests/base-qwen3.5-397b-a17b.json`, taken from GitHub
Actions run 36450878053.

This plan estimates what each kind of work needs. **No paid compute is
bought without the owner's approval.** GitHub Actions and Vercel cannot
train or serve this model; every figure below assumes rented datacenter
GPUs.

**How to read the numbers.**

- Architecture figures are **exact**: they come from the pinned
  `config.json` and model card.
- Throughput and cost are **estimates** from first principles, with the
  assumptions stated next to them.
- Prices are **planning ranges**, not quotes. They are re-quoted from the
  chosen provider before any approval request.

## 1. The model, as pinned

| Property             | Value (source: pinned config / model card)                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| Licence              | Apache-2.0 (LICENSE sha256 `bbedc3fd…`), not gated                                                        |
| Parameters           | 397B total, 17B activated (LM); 403.4B in safetensors including the vision encoder and MTP                |
| Weights              | 94 BF16 safetensors shards, 806.8 GB, every shard's sha256 pinned                                         |
| Layers               | 60 = 15 × (3 × Gated DeltaNet → MoE, 1 × Gated Attention → MoE)                                           |
| MoE                  | 512 experts, 10 routed + 1 shared per token, expert FFN 1024 wide                                         |
| Attention            | 15 full-attention layers: 32 query heads, **2 KV heads**, head dim 256; 45 linear (Gated DeltaNet) layers |
| Vision               | 27-layer ViT encoder, early-fusion multimodal                                                             |
| Context              | 262,144 tokens natively; model card: YaRN factor 4 → about 1,010,000 tokens (inference-time scaling)      |
| Serving (model card) | vLLM / SGLang main branch, tensor parallel 8, MTP speculative decoding supported                          |

**What the architecture means for cost.**

- **Cheap to hold long contexts.** Only 15 of the 60 layers keep a KV
  cache, with 2 KV heads each. That is 30 KiB per token:

  | Context | KV cache per sequence |
  | ------- | --------------------- |
  | 262k    | 7.5 GiB               |
  | 1M      | 30 GiB                |
  | 2M      | 60 GiB                |

  The 45 DeltaNet layers keep a fixed 180 MiB state per sequence.

- **Expensive to compute over long contexts.** The full-attention layers
  still cost quadratic FLOPs. At 2M tokens they cost about 15 times the
  parameters' own compute per token. §6 covers this.
- **Heavy to hold the weights.** The weights alone are 807 GB in BF16, so
  one inference or LoRA replica needs a full 8-GPU node of H200 or B200.

## 2. Hardware reference

| GPU      | Memory | Dense BF16 peak | Planning price / GPU-hour |
| -------- | ------ | --------------- | ------------------------- |
| H100 SXM | 80 GB  | ~989 TFLOPS     | $2.0 – 3.0                |
| H200 SXM | 141 GB | ~989 TFLOPS     | $2.5 – 4.0                |
| B200     | 180 GB | ~2,250 TFLOPS   | $4.0 – 6.0                |

**Throughput assumptions.**

- Fine-grained MoE training (512 small experts) runs at low model FLOPs
  utilisation. The plan assumes **15% (conservative) to 30% (well-tuned)
  MFU**.
- Training compute per token is 6 × 17B active parameters for full tuning,
  plus attention.
- For LoRA it is about 4 × 17B, because the frozen weights need no weight
  gradients.

## 3. Inference and evaluation

| Setup                     | Fits?                                    | Notes                                                                                                 |
| ------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 8 × H200 (1,128 GB), BF16 | Yes: 807 GB weights, about 250 GB for KV | The model card's reference setup (TP = 8)                                                             |
| 8 × B200 (1,440 GB), BF16 | Yes, with ample KV headroom              | Needed for many concurrent 1M+ contexts                                                               |
| 8 × H100 (640 GB), BF16   | **No**                                   | —                                                                                                     |
| 8 × H100, FP8 (~404 GB)   | Yes                                      | Only if an official FP8 checkpoint exists (unverified) or we quantise; must be evaluated against BF16 |

- **Evaluation runs** on one node: base versus candidate, about 3–6 hours
  per suite set. That is about **$60–200 per comparison** on 8 × H200.
- **Product serving**, dedicated 24/7 on one 8 × H200 node, costs about
  **$14,600 – 23,400 per month**. That is not justified at launch traffic.

  Cheaper routes, each verified before M71:
  1. A provider that serves this exact base with our own LoRA adapter,
     charging per token. The Rouge weights are then the pinned base plus
     our adapter.
  2. Our own node, reserved only when traffic justifies it.

  Rule for both: no other model's weights ever answer as Rouge 1.

## 4. Parameter-efficient tuning (LoRA / QLoRA)

**LoRA** (BF16 base frozen):

- **Memory.** The 807 GB base plus adapter and optimiser state plus
  activations.
  - One **8 × H200** node fits, with sequence length up to 32k and
    activation checkpointing.
  - 16 × H100 also fits.
- **Targets.**
  - Attention projections in all 60 layers: the Gated Attention layers'
    q/k/v/o and the DeltaNet layers' input and output projections.
  - The shared expert.
  - Not the 512 routed experts: rank-64 LoRA on every routed expert would
    add about 7.5B trainable parameters.
- **Throughput.** The theoretical bound at 15–30% MFU is 15–30k tokens/s
  per node. Small expert matrices and expert-parallel communication will
  cost part of that, so the plan assumes **3–10k tokens/s** until measured.
- **Cost per 100M training tokens:** about 3–9 GPU-node-hours, which is
  **$60–290**. Add the base download of 807 GB (0.5–1 h), merge and
  evaluation.

**QLoRA** (4-bit base, about 212 GB):

- It could fit on 4 × H100.
- Tooling risk is high: 4-bit quantisation of fused MoE expert tensors and
  the DeltaNet kernels must be supported by the pinned library versions.
- QLoRA also trains against a quantised base, so the merged BF16 checkpoint
  must be re-evaluated.
- Kept as a fallback, not the plan.

## 5. Full-parameter tuning and continued pretraining

**Memory.** Mixed-precision AdamW needs about 16 bytes per parameter:
BF16 weights and gradients, plus FP32 master weights and two moments. That
is **6.45 TB**, sharded across GPUs with expert and data parallelism.

- The minimum is about 54 × H200 at 120 GB usable each.
- The plan is **64 × H200 (8 nodes)**, or 128 × H100.
- A resumable checkpoint (weights plus optimiser) is about **7.3 TB**.

**Throughput** (64 × H200, 16k sequences):

| MFU | Tokens/s | Hours per 1B tokens |
| --- | -------- | ------------------- |
| 15% | ~83k     | 3.3                 |
| 30% | ~166k    | 1.7                 |

**Cost.** 64 × H200 at $2.5–4.0 per GPU-hour is $160–256 per hour.

| Work                  | Tokens | Cost        |
| --------------------- | ------ | ----------- |
| Full tuning           | 1B     | ~$270 – 850 |
| Continued pretraining | 20B    | ~$5k – 17k  |
| Continued pretraining | 100B   | ~$27k – 85k |

**When it is justified.** Full tuning is justified only once LoRA
checkpoints plateau on measured weaknesses. Every full-tuning run is a
separate owner approval.

## 6. Long-context training (262k → 512k → 1M → 2M)

**Step 0 costs nothing to train.** Measure first:

- The model card already supports YaRN factor 4 (up to about 1.01M tokens)
  at inference time.
- Test at 128k, 262k, 512k and 1M on one 8 × H200 node:
  - single-needle and multi-needle retrieval;
  - cross-document reasoning;
  - timeline reconstruction;
  - contradictions;
  - long-code navigation;
  - position sweeps (beginning, middle, end).
- Cost: a few node-hours, about **$100–250**.
- Rouge claims only the context length its checkpoint passes.

**Training beyond it.** This needs YaRN factor 8 or re-tuned RoPE, plus
long-context continued pretraining and SFT.

Compute per token at context L: 102 GFLOP for the parameters, plus the
full-attention term (≈ 0.74 MFLOP × L).

| Context | GFLOP / token | Seconds per sequence (64 × H200, 15–30% MFU) | Hours per 1B tokens |
| ------- | ------------- | -------------------------------------------- | ------------------- |
| 262k    | ~295          | —                                            | —                   |
| 1M      | ~875          | 48 – 97                                      | 13 – 26             |
| 2M      | ~1,650        | 182 – 364                                    | 24 – 48             |

**Cost.** Training on 1B tokens of 2M-token sequences costs about
**$3.8k – 12k**. A staged curriculum (512k → 1M → 2M, a few hundred million
tokens per stage) costs about **$5k – 20k** in total.

**Technical requirements:**

- **Context parallelism.** One 2M-token sequence holds about 1 TB of
  checkpointed activations, so it must be split across at least 16 GPUs.
- **Kernels.** Context-parallel support for the Gated DeltaNet
  (chunked-scan state passing) is the main technical risk. It must be
  verified in the chosen framework before any rental.

## 7. Storage

| Item                             | Size      | Planning cost               |
| -------------------------------- | --------- | --------------------------- |
| Pinned base (BF16)               | 807 GB    | ~$16 / month object storage |
| LoRA adapter checkpoint          | ~1 – 5 GB | negligible                  |
| Merged derivative checkpoint     | 807 GB    | ~$16 / month each           |
| Full-tuning resumable checkpoint | ~7.3 TB   | ~$150 / month each          |

- Keep every promoted checkpoint, and only the last two resumable
  checkpoints.
- Egress is charged per provider: prefer training and serving in the
  region where the weights are stored.
- Nothing large goes into Git. The repository keeps manifests only, with
  sha256, parent, run, data version, hyperparameters and evaluations.

## 8. Training stack (to be confirmed on the first GPU day)

Candidates, in order of fit for a hybrid DeltaNet MoE:

1. **Megatron-Core with expert parallelism**, through ms-swift or
   Megatron-Bridge (Hugging Face ↔ Megatron checkpoint conversion). This is
   the natural fit for 512-expert MoE, LoRA and long-context context
   parallelism.
2. **Transformers + PEFT + TRL on FSDP2 / DeepSpeed ZeRO-3.** It is simpler,
   but with no expert parallelism it gathers weights on every step. That is
   acceptable for a first small SFT, poor at scale.
3. **vLLM / SGLang** for evaluation and serving. The model card requires
   their main branches for Qwen3.5.

Library versions are locked on the GPU host (`pip freeze` into the run
manifest, with the lock's sha256 in every checkpoint manifest). Nothing is
pinned here that has not been installed and run.

## 9. Cheapest realistic path to the first Rouge checkpoint

| Step | What                                                                                                                                                                                         | Compute                     | Estimate       | Needs approval |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | -------------- | -------------- |
| A    | Smoke-train a tiny, randomly initialised model of the **same architecture class** through the exact training code path (LoRA targets, save, manifest, merge, reload) on a CI runner          | CPU (GitHub Actions)        | $0             | No             |
| B    | Download the pinned base and verify every sha256 (`scripts/verify_weights.py`). Serve it with vLLM and measure **rouge-1-base** on the Rouge Lab v0 suites, including the YaRN context sweep | 1 × 8 × H200, about 6–8 h   | **$120 – 260** | **Yes**        |
| C    | **rouge-1-sft-001**: LoRA on 50–100M tokens of approved SFT data, 1 epoch. Then merge, evaluate against base on the same held-out suites, and make the promotion decision                    | 1 × 8 × H200, about 10–14 h | **$250 – 560** | **Yes**        |

Steps A–C total about **$400 – 800**. That buys one measured, reproducible
Rouge checkpoint with a full manifest and a base-versus-Rouge comparison on
held-out suites.

**Before B.** The owner chooses a provider, and the price is re-quoted.
Candidates are hourly 8 × H200 or B200 nodes, such as Lambda, RunPod,
CoreWeave or Nebius. Each needs storage in the same region.

**Before C.** At least 50M tokens of registry entries must be `approved`:
licence verified at a pinned revision, and teacher terms checked.
