"""Rouge native model configuration (Rouge Architecture v1 candidates).

One dataclass describes every tournament candidate and, once frozen, the
production architecture. The configuration is the architecture: its
canonical JSON is hashed into `architecture_sha`, which every run, checkpoint
and registry entry records.

Candidates (docs/rouge/architecture-v1-candidates.md):
- A: attention="full"                              dense SwiGLU, bf16 weights
- B: attention="hybrid"  (local window + global every k-th layer)
- C: B + lowbit="ternary"                           BitNet b1.58 linear layers
- D: C + moe_experts>0                              shared + routed experts, bias balancing
- E: D + structured="monarch"                       block-diagonal x permutation x block-diagonal
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path

ATTENTION = ("full", "hybrid")
LOWBIT = ("none", "ternary", "int8")
LOWBIT_SCOPE = ("ffn", "all")
STRUCTURED = ("none", "monarch")


@dataclass(frozen=True)
class RougeConfig:
    name: str = "rouge-v1"
    vocab_size: int = 32768
    d_model: int = 512
    n_layers: int = 8
    n_heads: int = 8
    n_kv_heads: int = 8                  # grouped-query attention when < n_heads
    ffn_hidden: int = 0                  # 0: 8/3 * d_model rounded up to a multiple of 64 (SwiGLU)
    max_seq: int = 1024
    rope_theta: float = 10000.0
    norm_eps: float = 1e-5
    tie_embeddings: bool = True
    # sequence mechanism
    attention: str = "full"
    window: int = 256                    # local layers see the last `window` tokens
    global_every: int = 4                # hybrid: layer i is global when (i + 1) % global_every == 0
    # low-bit (weights only; activations stay in the compute dtype unless act_bits=8)
    lowbit: str = "none"
    lowbit_scope: str = "ffn"
    act_bits: int = 16
    # sparse FFN
    moe_experts: int = 0                 # 0: dense FFN
    moe_topk: int = 2
    moe_shared: int = 1                  # always-on shared experts
    moe_expert_hidden: int = 0           # 0: ffn_hidden // 4
    moe_bias_rate: float = 1e-3          # auxiliary-loss-free balancing (DeepSeek-V3): per-step bias update
    # structured projections
    structured: str = "none"
    structured_blocks: int = 4
    # extension points (not trained in v1)
    vision_patch: int = 0                # >0 reserves an image-patch encoder into the embedding stream
    extra: dict = field(default_factory=dict)

    def __post_init__(self):
        assert self.attention in ATTENTION, self.attention
        assert self.lowbit in LOWBIT, self.lowbit
        assert self.lowbit_scope in LOWBIT_SCOPE, self.lowbit_scope
        assert self.structured in STRUCTURED, self.structured
        assert self.d_model % self.n_heads == 0 and (self.d_model // self.n_heads) % 2 == 0, "even head dim (RoPE)"
        assert self.n_heads % self.n_kv_heads == 0
        assert self.act_bits in (8, 16)
        assert not (self.structured == "monarch" and self.lowbit == "int8"), "monarch supports ternary or full precision"

    @property
    def head_dim(self) -> int:
        return self.d_model // self.n_heads

    @property
    def hidden(self) -> int:
        if self.ffn_hidden:
            return self.ffn_hidden
        return 64 * -(-int(8 * self.d_model / 3) // 64)

    @property
    def expert_hidden(self) -> int:
        return self.moe_expert_hidden or max(64, self.hidden // 4)

    def is_global(self, layer: int) -> bool:
        return self.attention == "full" or (layer + 1) % self.global_every == 0

    def to_json(self) -> str:
        return json.dumps(dataclasses.asdict(self), sort_keys=True, separators=(",", ":"))

    @property
    def architecture_sha(self) -> str:
        """Hash of everything that defines the architecture (the name is excluded)."""
        body = {k: v for k, v in dataclasses.asdict(self).items() if k != "name"}
        return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

    @classmethod
    def load(cls, path: str | Path) -> "RougeConfig":
        return cls(**json.loads(Path(path).read_text()))

    def replace(self, **changes) -> "RougeConfig":
        return dataclasses.replace(self, **changes)
