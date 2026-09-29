"""R1.07 baseline zoo: conventional sequence models with the interface every
Rouge runner uses:

    model(ids, lengths) -> (logits at the last real position, info dict)
    model.memory_bytes(tokens) -> {"state": bytes, "kv": bytes}   (inference memory, fp32)

- LSTM / GRU (torch.nn), causal, answer read at the last real position.
- SSM: a small selective state-space model in the style of Mamba
  (Gu & Dao 2023, arXiv 2312.00752): input-dependent step size and
  input/output projections, diagonal state matrix, gated output. A plain
  sequential scan: correct, not fast.
- Looped: one causal Transformer block applied `steps` times with input
  injection (Universal-Transformer-style, fixed depth).
- build(kind, vocab, **config) also returns the existing Transformer,
  sparse-MoE Transformer and Rouge models, so one runner can train any of them.
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F

from prototypes.transformer_baseline import Block, Transformer


def _last(x: torch.Tensor, lengths: torch.Tensor) -> torch.Tensor:
    return x[torch.arange(x.shape[0]), lengths - 1]


class RNN(nn.Module):
    def __init__(self, vocab: int, d: int = 112, layers: int = 2, cell: str = "lstm"):
        super().__init__()
        self.embed = nn.Embedding(vocab, d)
        self.rnn = (nn.LSTM if cell == "lstm" else nn.GRU)(d, d, num_layers=layers, batch_first=True)
        self.ln = nn.LayerNorm(d)
        self.head = nn.Linear(d, vocab)
        self.d, self.layers, self.cell = d, layers, cell

    def forward(self, ids, lengths):
        y, _ = self.rnn(self.embed(ids))
        return self.head(self.ln(_last(y, lengths))), {}

    def memory_bytes(self, tokens: int) -> dict:
        per_layer = (2 if self.cell == "lstm" else 1) * self.d
        return {"state": self.layers * per_layer * 4, "kv": 0}

    def analytic_flops(self, tokens: int) -> float:
        """FLOPs the counter misses: the fused LSTM kernel is invisible to torch's
        FLOP counter, so it is added analytically (2 x 4 gates x (d_in + d) x d per token and layer)."""
        if self.cell != "lstm":
            return 0.0  # the GRU path is decomposed into ops the counter already sees
        return tokens * self.layers * 2 * 4 * (2 * self.d) * self.d


class SelectiveSSM(nn.Module):
    """One Mamba-style layer: x -> (u, z); h_t = exp(dt*A) h_{t-1} + dt*B_t u_t; y = C_t h_t + D u; out = W(y * silu(z))."""

    def __init__(self, d: int, n: int):
        super().__init__()
        self.ln = nn.LayerNorm(d)
        self.inp = nn.Linear(d, 2 * d)
        self.dt = nn.Linear(d, d)
        self.bc = nn.Linear(d, 2 * n, bias=False)
        self.a_log = nn.Parameter(torch.log(torch.arange(1, n + 1, dtype=torch.float32)).repeat(d, 1))
        self.d_skip = nn.Parameter(torch.ones(d))
        self.out = nn.Linear(d, d)
        self.n = n

    def forward(self, x):
        b, t, d = x.shape
        u, z = self.inp(self.ln(x)).chunk(2, -1)
        dt = F.softplus(self.dt(u))                      # (B, T, d)
        bmat, cmat = self.bc(u).chunk(2, -1)             # (B, T, n)
        a = -torch.exp(self.a_log)                       # (d, n)
        h = x.new_zeros(b, d, self.n)
        ys = []
        for i in range(t):
            h = torch.exp(dt[:, i, :, None] * a) * h + (dt[:, i, :, None] * bmat[:, i, None, :]) * u[:, i, :, None]
            ys.append((h * cmat[:, i, None, :]).sum(-1))
        y = torch.stack(ys, 1) + self.d_skip * u
        return x + self.out(y * F.silu(z))


class SSM(nn.Module):
    def __init__(self, vocab: int, d: int = 104, layers: int = 4, n: int = 16):
        super().__init__()
        self.embed = nn.Embedding(vocab, d)
        self.layers_ = nn.ModuleList(SelectiveSSM(d, n) for _ in range(layers))
        self.ln = nn.LayerNorm(d)
        self.head = nn.Linear(d, vocab)
        self.d, self.layers, self.n = d, layers, n

    def forward(self, ids, lengths):
        x = self.embed(ids)
        for layer in self.layers_:
            x = layer(x)
        return self.head(self.ln(_last(x, lengths))), {}

    def memory_bytes(self, tokens: int) -> dict:
        return {"state": self.layers * self.d * self.n * 4, "kv": 0}


class Looped(nn.Module):
    """A shared causal block applied `steps` times: h <- Block(h + e)."""

    def __init__(self, vocab: int, d: int = 128, heads: int = 4, steps: int = 4):
        super().__init__()
        self.embed = nn.Embedding(vocab, d)
        self.block = Block(d, heads, causal=True)
        self.norm = nn.LayerNorm(d)
        self.ln = nn.LayerNorm(d)
        self.head = nn.Linear(d, vocab)
        self.d, self.steps = d, steps

    def forward(self, ids, lengths):
        e = self.embed(ids)
        h = e
        for _ in range(self.steps):
            h = self.norm(self.block(h + e))
        return self.head(self.ln(_last(h, lengths))), {}

    def memory_bytes(self, tokens: int) -> dict:
        return {"state": 0, "kv": 2 * self.steps * tokens * self.d * 4}


def build(kind: str, vocab: int, **config) -> nn.Module:
    if kind == "transformer":
        return Transformer(vocab, **config)
    if kind in ("lstm", "gru"):
        return RNN(vocab, cell=kind, **config)
    if kind == "ssm":
        return SSM(vocab, **config)
    if kind == "looped":
        return Looped(vocab, **config)
    if kind == "moe":
        from prototypes.sparse_circuits import SparseTransformer
        return SparseTransformer(vocab, **config)
    if kind in ("mod", "knob", "early"):
        from prototypes import dynamic
        return {"mod": dynamic.MoDTransformer, "knob": dynamic.KnobLooped, "early": dynamic.EarlyExit}[kind](vocab, **config)
    if kind == "structured":
        from prototypes.structured import StructuredTransformer
        return StructuredTransformer(vocab, **config)
    if kind == "rouge":
        from prototypes.rouge_r101 import Rouge
        return Rouge(vocab, **config)
    if kind == "rouge-mem":
        from prototypes.rouge_mem import RougeMem
        return RougeMem(vocab, **config)
    raise ValueError(kind)


def memory_bytes(model: nn.Module, tokens: int) -> dict:
    """Inference memory that the model keeps for one input of `tokens` tokens."""
    if hasattr(model, "memory_bytes"):
        return model.memory_bytes(tokens)
    kind = type(model).__name__
    if kind in ("Transformer", "SparseTransformer"):
        return {"state": 0, "kv": model.state_bytes(tokens)}
    return {"state": model.state_bytes(tokens), "kv": 0}  # Rouge: constant slots (+ memory slots)


def active_parameters(model: nn.Module) -> int:
    return model.active_parameters() if hasattr(model, "active_parameters") else sum(p.numel() for p in model.parameters())
