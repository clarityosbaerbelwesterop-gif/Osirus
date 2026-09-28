# Rouge 1 — compute plan (M58, single GPU)

Rouge 1 v1 is trained from **Qwen/Qwen3.5-27B**, pinned at
`fc05daec18b0a78c049392ed2e771dde82bdf654`. The pin lives in
`models/rouge-1/base.json`.

**Scope.**

- **No datacenter, no cluster, no recurring GPU infrastructure.** The first
  Rouge checkpoint is one QLoRA job on **one** GPU.
- **Nothing is rented without explicit owner approval.**
- The earlier 397B / multi-node plan is withdrawn (owner correction,
  2026-09-28). It remains in git history only.

**How to read the numbers.**

- **Exact:** the architecture and the parameter counts. They come from the
  pinned config, and the parameters are counted by instantiating the model
  on the meta device (`training/rouge/scripts/size_qlora.py`).
- **Estimates:** memory and time. Nothing has run on a GPU yet. The first
  run records the real peak memory and throughput next to these estimates.
- **Planning prices:** public list prices from September 2026 (sources at
  the end). They are re-checked on the day of rental.

## 1. The base

| Property  | Value                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------- |
| Licence   | Apache-2.0 (LICENSE sha256 `50cbab8a…`), not gated                                                 |
| Weights   | 11 BF16 safetensors shards, 55.6 GB, every shard's sha256 pinned                                   |
| Model     | `Qwen3_5ForConditionalGeneration`: dense 27B language model plus a 27-layer vision encoder         |
| Layers    | 64 = 16 × (3 × Gated DeltaNet → FFN, 1 × Gated Attention → FFN); hidden 5120, FFN 17408            |
| Attention | 24 query heads, 4 KV heads, head dim 256 (16 layers); DeltaNet with 16 QK / 48 V heads (48 layers) |
| Context   | 262,144 native; the model card says it extends to ~1,010,000 with YaRN at inference                |

**Parameter counts (exact, as loaded):**

- 27,356,728,560 in total;
- 24.33B in the LoRA-target linear layers;
- embedding and output head 1.27B each;
- vision 0.46B.

The multi-token-prediction head is not loaded for training. The merge
carries it over unchanged (see `rouge_train/merge.py`).

## 2. Single-GPU QLoRA memory

**Setup.**

- 4-bit NF4 with double quantisation for every language-model linear layer.
- Embedding, output head, norms and vision stay BF16.
- Gradient checkpointing.
- Chunked output-head loss: at most 1,024 positions of FP32 logits at once,
  instead of the full 248k × sequence.
- Micro-batch 1, paged 8-bit AdamW for the adapter.

| Item                                | Size                                    |
| ----------------------------------- | --------------------------------------- |
| Quantised weights (NF4 + BF16 rest) | **18.6 GB**                             |
| LoRA r = 16, trainable              | 109M parameters, ~1.1 GB with optimiser |
| LoRA r = 64, trainable              | 435M parameters, ~4.4 GB with optimiser |

**Estimated peak memory, including about 3 GB of CUDA and allocator
overhead:**

| Sequence length | r = 16  | r = 64  |
| --------------- | ------- | ------- |
| 2,048           | 26.8 GB | 30.0 GB |
| 4,096           | 28.8 GB | 32.0 GB |
| 8,192           | 32.8 GB | 36.1 GB |
| 16,384          | 40.9 GB | 44.2 GB |

**Conclusions** (calculated, not yet measured):

- **24 GB GPUs are not enough.**
- **One 48 GB GPU** (L40S, RTX 6000 Ada, A6000) fits 4k–8k sequences with
  margin. At 16k it fits only r ≤ 32.
- **One 80 GB GPU** (A100 / H100) fits everything up to 16k comfortably.
  It is also the smallest single GPU that can evaluate the model in
  unquantised BF16 (55 GB of weights).

## 3. Time and cost of `rouge-1-sft-001`

**Workload.** About 20k examples (the owner's 10k–50k range), capped at 8k
tokens each, averaging about 1.5k tokens. That is **~30M tokens, 1 epoch**.

**Compute.** QLoRA with gradient checkpointing costs about 6 × 27.4B ≈
**164 GFLOP per token**: forward, recomputed forward, and backward through
the activations. NF4 dequantisation lowers the achieved throughput.
Throughput assumes the fused DeltaNet kernels (`flash-linear-attention`)
are installed; without them it is several times slower.

| GPU (1×)   | Dense BF16 peak | Assumed utilisation | ≈ tokens/s | Training 30M tokens | Price / h (Sep 2026)                                                |
| ---------- | --------------- | ------------------- | ---------- | ------------------- | ------------------------------------------------------------------- |
| H100 80 GB | ~989 TFLOPS     | 25%                 | ~1,500     | **~5.6 h**          | $1.99 (RunPod community) – $2.99 (RunPod secure, SXM); Lambda $3.29 |
| A100 80 GB | ~312 TFLOPS     | 30%                 | ~570       | ~14.6 h             | $1.39 – 1.59 (RunPod)                                               |
| L40S 48 GB | ~181 TFLOPS     | 30%                 | ~330       | ~25 h               | $0.79 (RunPod community)                                            |

**Whole job on one GPU**, including:

- the 55.6 GB download and sha256 check (~15 min);
- training;
- the adapter merge into BF16 (~20–30 min, needs ≥ 128 GB host RAM);
- base-versus-Rouge evaluation with vLLM (~1 h for both models);
- a 20% margin for setup and a restart.

| Option                          | Node time | **Expected cost**            |
| ------------------------------- | --------- | ---------------------------- |
| **1× H100 80 GB (recommended)** | ~8–9 h    | **$16 – 27** ($1.99–2.99/h)  |
| 1× A100 80 GB                   | ~18–20 h  | $25 – 32                     |
| 1× L40S 48 GB                   | ~28–30 h  | ~$23 + eval on FP8, not BF16 |

**Recommendation: one H100 80 GB for about $16–27 in total.**

- It is the fastest route.
- It gives headroom for 16k sequences.
- It can evaluate base and Rouge both in unquantised BF16 on the same
  hardware.

**Storage.**

- The merged checkpoint is 55.6 GB, the adapter about 0.2–1 GB.
- The checkpoint goes to a dedicated Rouge model repository on the Hugging
  Face Hub (Xet-backed): a private repo at no cost within the free storage
  tier, or on the owner's plan.
- Only the manifest (hashes, lineage, config, evaluations) enters the Osirus
  repository.

**Before rental, all of these are needed:**

1. The CI smoke run is green: the real tokenizer and training path on a
   tiny model.
2. The SFT dataset is built and its manifest reviewed.
3. The owner approves the exact provider, GPU and cost.
4. A Hugging Face token with write access to the Rouge model repository is
   available as a secret on the GPU host. It is never committed.

## 4. Later stages (not now)

**Sequence length.**

- SFT starts at 4k–8k.
- 16k is the next step on the same GPU.
- 32k and 64k need an 80 GB GPU with context-parallel-free tricks (smaller
  loss chunks, CPU offload). They are measured before they are claimed.
- 128k–262k training and anything towards 512k / 1M / 2M is research after
  Rouge training itself works. The base already handles 262k natively.

**Bigger runs.** Reasoning post-training, preference training and RL are
each costed separately when their data exists. Each is a separate approval.

## Sources

- [Runpod pricing vs Thunder Compute (2026)](https://www.thundercompute.com/blog/runpod-pricing-vs-thunder-compute)
- [H100 rental prices across 15+ providers (2026)](https://intuitionlabs.ai/articles/h100-rental-prices-cloud-comparison)
- [Runpod H100 pricing 2026 (Spheron)](https://www.spheron.network/blog/runpod-h100-pricing-2026/)
- [Lambda Labs GPU pricing 2026](https://www.synpixcloud.com/blog/lambda-labs-gpu-pricing-2026)
- [RunPod pricing in 2026 (Flexprice)](https://flexprice.io/blog/runprod-pricing-guide-with-gpu-costs)
- [Runpod L40S](https://www.runpod.io/gpu-models/l40s)
- [Runpod pricing](https://www.runpod.io/pricing)
