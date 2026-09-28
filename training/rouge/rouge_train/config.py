"""Run configuration: one JSON file describes a training run completely."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

# LoRA targets for Qwen3.5 (dense): every projection in the language model --
# gated attention (16 layers), Gated DeltaNet in/out projections (48 layers)
# and the MLP. The vision tower is not adapted in SFT.
QWEN35_LM_TARGETS = (
    r"model\.language_model\.layers\.\d+\."
    r"(self_attn\.(q_proj|k_proj|v_proj|o_proj)"
    r"|linear_attn\.(in_proj_qkv|in_proj_z|out_proj)"
    r"|mlp\.(gate_proj|up_proj|down_proj))"
)


@dataclass
class LoraSettings:
    rank: int = 16
    alpha: int = 32
    dropout: float = 0.05
    target_modules: str = QWEN35_LM_TARGETS


@dataclass
class RunConfig:
    name: str
    base_path: str
    tokenizer_path: str
    train_file: str
    output_dir: str
    eval_file: str | None = None
    seed: int = 20260928
    lora: LoraSettings = field(default_factory=LoraSettings)
    # "none" trains LoRA on a BF16 base; "4bit" is QLoRA (NF4, double
    # quantisation, BF16 compute) and needs CUDA + bitsandbytes.
    quantization: str = "none"
    dtype: str = "bfloat16"
    gradient_checkpointing: bool = True
    max_seq_len: int = 4096
    micro_batch_size: int = 1
    grad_accum: int = 16
    learning_rate: float = 1e-4
    warmup_ratio: float = 0.03
    weight_decay: float = 0.0
    max_grad_norm: float = 1.0
    epochs: int = 1
    max_steps: int | None = None
    optimizer: str = "adamw"  # or "paged_adamw_8bit" (bitsandbytes, CUDA)
    loss_chunk_tokens: int = 1024
    save_every: int = 100
    log_every: int = 10
    keep_checkpoints: int = 2
    # Stop after this many optimizer steps in this process (tests resume).
    stop_after: int | None = None

    @classmethod
    def load(cls, path: str | Path) -> "RunConfig":
        raw = json.loads(Path(path).read_text())
        lora = LoraSettings(**raw.pop("lora", {}))
        known = {f for f in cls.__dataclass_fields__}
        unknown = set(raw) - known
        if unknown:
            raise ValueError(f"unknown run config keys: {sorted(unknown)}")
        config = cls(lora=lora, **raw)
        config.validate()
        return config

    def validate(self) -> None:
        if self.quantization not in ("none", "4bit"):
            raise ValueError("quantization must be 'none' or '4bit'")
        if self.dtype not in ("bfloat16", "float32"):
            raise ValueError("dtype must be bfloat16 or float32")
        if self.optimizer not in ("adamw", "paged_adamw_8bit"):
            raise ValueError("optimizer must be adamw or paged_adamw_8bit")
        if self.max_seq_len < 16 or self.micro_batch_size < 1 or self.grad_accum < 1:
            raise ValueError("invalid batch or sequence settings")

    def to_dict(self) -> dict:
        return asdict(self)
