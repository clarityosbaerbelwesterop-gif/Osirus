#!/usr/bin/env python3
"""Memory budget for single-GPU QLoRA on the pinned base (no weights needed).

Instantiates the base architecture from models/rouge-1/base.json on the
meta device, counts parameters exactly by group, and estimates peak GPU
memory for 4-bit NF4 QLoRA with gradient checkpointing, the chunked loss
and micro-batch 1 at several sequence lengths. Estimates, not
measurements: the first GPU run records the real peak
(torch.cuda.max_memory_allocated) next to these numbers.

    python training/rouge/scripts/size_qlora.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import torch  # noqa: E402
from transformers import AutoConfig, AutoModelForImageTextToText  # noqa: E402

from rouge_train.config import QWEN35_LM_TARGETS  # noqa: E402
from rouge_train.manifest import load_base  # noqa: E402

GB = 1e9


def main() -> None:
    base = load_base()
    config = AutoConfig.for_model(**base["config"])
    with torch.device("meta"):
        model = AutoModelForImageTextToText.from_config(config)
    text = base["config"]["text_config"]
    target = re.compile(QWEN35_LM_TARGETS)

    groups = {"lm_linear_targets": 0, "lm_other": 0, "embed": 0, "lm_head": 0, "vision": 0}
    lora = {8: 0, 16: 0, 32: 0, 64: 0}
    for name, module in model.named_modules():
        if isinstance(module, torch.nn.Linear) and target.fullmatch(name):
            groups["lm_linear_targets"] += module.weight.numel()
            for r in lora:
                lora[r] += r * (module.in_features + module.out_features)
    for name, param in model.named_parameters():
        if name.startswith("model.visual"):
            groups["vision"] += param.numel()
        elif name == "lm_head.weight":
            groups["lm_head"] += param.numel()
        elif "embed_tokens" in name:
            groups["embed"] += param.numel()
        elif not any(name.startswith(n) and n for n in ()):
            pass
    total = sum(p.numel() for p in model.parameters())
    groups["lm_other"] = total - sum(v for k, v in groups.items() if k != "lm_other")

    # 4-bit NF4 with double quantisation: 4 bits + ~0.127 bits of scales per
    # weight. Embeddings, lm_head, norms and the vision tower stay BF16.
    nf4 = groups["lm_linear_targets"] * (4 + 0.127) / 8
    bf16_rest = (groups["embed"] + groups["lm_head"] + groups["vision"] + groups["lm_other"]) * 2
    weights = nf4 + bf16_rest

    hidden, layers, inter, vocab = (
        text["hidden_size"],
        text["num_hidden_layers"],
        text["intermediate_size"],
        text["vocab_size"],
    )
    rows = []
    for rank in (16, 64):
        adapter = lora[rank]
        # LoRA weights fp32 + grads fp32 + paged 8-bit AdamW (2 B/param).
        adapter_bytes = adapter * (4 + 4 + 2)
        for seq in (2048, 4096, 8192, 16384):
            # Gradient checkpointing keeps one BF16 hidden state per layer
            # boundary; one layer is recomputed at a time (MLP up/gate/act
            # intermediates dominate), plus one loss chunk of fp32 logits.
            boundaries = layers * seq * hidden * 2
            layer_peak = seq * (3 * inter + 6 * hidden) * 2 * 2
            loss_chunk = 1024 * vocab * 4 * 2
            overhead = 3.0 * GB  # CUDA context, allocator fragmentation, kernels
            peak = weights + adapter_bytes + boundaries + layer_peak + loss_chunk + overhead
            rows.append(
                {
                    "lora_rank": rank,
                    "seq_len": seq,
                    "weights_gb": round(weights / GB, 1),
                    "adapter_and_optimizer_gb": round(adapter_bytes / GB, 2),
                    "activations_gb": round((boundaries + layer_peak + loss_chunk) / GB, 1),
                    "estimated_peak_gb": round(peak / GB, 1),
                    "fits_24gb": peak < 22 * GB,
                    "fits_48gb": peak < 45 * GB,
                    "fits_80gb": peak < 76 * GB,
                }
            )
    report = {
        "base": f"{base['source']['repo']}@{base['source']['revision']}",
        "parameters": {k: v for k, v in groups.items()} | {"total": total},
        "lora_trainable": lora,
        "bf16_full_weights_gb": round(total * 2 / GB, 1),
        "nf4_weights_gb": round(weights / GB, 1),
        "rows": rows,
    }
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
