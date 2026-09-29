"""Baseline: a standard modern decoder-only Transformer.

Pre-LayerNorm, rotary position embeddings (RoPE, the usual choice for length
generalisation), causal self-attention, GELU MLP (4x), no weight sharing.
The answer is read at the last real position of each sequence.
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


def rope(x: torch.Tensor) -> torch.Tensor:
    """Rotary embedding over the last dimension of (B, H, T, Dh)."""
    t, dh = x.shape[-2], x.shape[-1]
    inv = 1.0 / (10000 ** (torch.arange(0, dh, 2, device=x.device, dtype=torch.float32) / dh))
    ang = torch.arange(t, device=x.device, dtype=torch.float32)[:, None] * inv[None, :]
    cos, sin = ang.cos(), ang.sin()
    x1, x2 = x[..., ::2], x[..., 1::2]
    return torch.stack((x1 * cos - x2 * sin, x1 * sin + x2 * cos), dim=-1).flatten(-2)


class Block(nn.Module):
    def __init__(self, d: int, heads: int, causal: bool = True, ff: int | None = None):
        super().__init__()
        self.heads, self.causal = heads, causal
        self.ln1, self.ln2 = nn.LayerNorm(d), nn.LayerNorm(d)
        self.qkv, self.out = nn.Linear(d, 3 * d), nn.Linear(d, d)
        self.mlp = nn.Sequential(nn.Linear(d, ff or 4 * d), nn.GELU(), nn.Linear(ff or 4 * d, d))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        b, t, d = x.shape
        q, k, v = self.qkv(self.ln1(x)).view(b, t, 3, self.heads, d // self.heads).permute(2, 0, 3, 1, 4)
        y = F.scaled_dot_product_attention(rope(q), rope(k), v, is_causal=self.causal)
        x = x + self.out(y.transpose(1, 2).reshape(b, t, d))
        return x + self.mlp(self.ln2(x))


class Transformer(nn.Module):
    def __init__(self, vocab: int, d: int = 64, layers: int = 4, heads: int = 4, causal: bool = True, ff: int | None = None):
        super().__init__()
        self.embed = nn.Embedding(vocab, d)
        self.blocks = nn.ModuleList(Block(d, heads, causal, ff) for _ in range(layers))
        self.ln = nn.LayerNorm(d)
        self.head = nn.Linear(d, vocab)
        self.d, self.layers = d, layers

    def forward(self, ids: torch.Tensor, lengths: torch.Tensor) -> tuple[torch.Tensor, dict]:
        x = self.embed(ids)
        for block in self.blocks:
            x = block(x)
        last = x[torch.arange(ids.shape[0]), lengths - 1]
        return self.head(self.ln(last)), {}

    def state_bytes(self, tokens: int) -> int:
        """Inference memory that grows with the input: the KV cache (fp32)."""
        return 2 * self.layers * tokens * self.d * 4
