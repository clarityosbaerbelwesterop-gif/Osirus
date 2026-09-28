"""Loading the base, attaching LoRA, and a memory-lean causal-LM loss."""

from __future__ import annotations

import re

import torch
from torch.utils.checkpoint import checkpoint

from .config import RunConfig


def torch_dtype(name: str):
    return {"bfloat16": torch.bfloat16, "float32": torch.float32}[name]


def load_base(config: RunConfig, *, for_training: bool = True):
    """The pinned base (or the CI smoke model) through the same code path."""
    from transformers import AutoConfig, AutoModelForImageTextToText

    model_config = AutoConfig.from_pretrained(config.base_path)
    kwargs = {"dtype": torch_dtype(config.dtype)}
    if config.quantization == "4bit":
        if not torch.cuda.is_available():
            raise RuntimeError("QLoRA (4bit) needs a CUDA GPU with bitsandbytes")
        from transformers import BitsAndBytesConfig

        kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=torch.bfloat16,
            # The vision tower and the output head stay in BF16.
            llm_int8_skip_modules=["visual", "lm_head"],
        )
        kwargs["device_map"] = {"": 0}
    model = AutoModelForImageTextToText.from_pretrained(
        config.base_path, config=model_config, **kwargs
    )
    if config.quantization == "4bit" and for_training:
        from peft import prepare_model_for_kbit_training

        model = prepare_model_for_kbit_training(
            model, use_gradient_checkpointing=config.gradient_checkpointing
        )
    elif config.gradient_checkpointing and for_training:
        model.gradient_checkpointing_enable(
            gradient_checkpointing_kwargs={"use_reentrant": False}
        )
        model.enable_input_require_grads()
    if torch.cuda.is_available() and config.quantization == "none":
        model = model.to("cuda")
    return model


def lora_targets(model, pattern: str) -> list[str]:
    compiled = re.compile(pattern)
    # bitsandbytes' Linear4bit subclasses nn.Linear, so QLoRA matches too.
    names = [
        name
        for name, module in model.named_modules()
        if compiled.fullmatch(name) and isinstance(module, torch.nn.Linear)
    ]
    if not names:
        raise ValueError(f"no module matches the LoRA target pattern {pattern!r}")
    return names


def attach_lora(model, config: RunConfig):
    from peft import LoraConfig, get_peft_model

    targets = lora_targets(model, config.lora.target_modules)
    peft_config = LoraConfig(
        r=config.lora.rank,
        lora_alpha=config.lora.alpha,
        lora_dropout=config.lora.dropout,
        target_modules=targets,
        bias="none",
        task_type="CAUSAL_LM",
    )
    return get_peft_model(model, peft_config), targets


def language_model_parts(model):
    """(decoder, lm_head) of a Qwen3.5 conditional-generation model, PEFT or not."""
    base = model.get_base_model() if hasattr(model, "get_base_model") else model
    return base.model.language_model, base.lm_head


def causal_lm_loss(model, input_ids, labels, attention_mask, chunk_tokens: int):
    """Mean next-token loss over labelled tokens, computed in chunks.

    The output head over a 248k vocabulary would otherwise hold fp32 logits
    for every position (8k tokens -> ~8 GB). Each chunk is recomputed in
    the backward pass, so at most one chunk of logits is alive at a time.
    """
    decoder, head = language_model_parts(model)
    hidden = decoder(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state
    hidden = hidden[:, :-1, :]
    targets = labels[:, 1:]
    count = (targets != -100).sum()
    if count == 0:
        return hidden.sum() * 0.0, 0

    def chunk_loss(states, chunk_targets):
        logits = head(states).float()
        return torch.nn.functional.cross_entropy(
            logits.reshape(-1, logits.size(-1)),
            chunk_targets.reshape(-1),
            ignore_index=-100,
            reduction="sum",
        )

    total = hidden.new_zeros((), dtype=torch.float32)
    for start in range(0, hidden.size(1), chunk_tokens):
        states = hidden[:, start : start + chunk_tokens, :]
        chunk_targets = targets[:, start : start + chunk_tokens]
        if (chunk_targets != -100).any():
            total = total + checkpoint(chunk_loss, states, chunk_targets, use_reentrant=False)
    return total / count, int(count)


def trainable_parameters(model) -> tuple[int, int]:
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    return trainable, total
