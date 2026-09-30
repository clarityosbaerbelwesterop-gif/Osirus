"""Building blocks: RMSNorm, rotary embeddings, low-bit and structured linear layers.

Low-bit training follows BitNet b1.58 (arXiv 2402.17764): latent full-precision
weights, forward pass with W_q = round(W / mean|W|) clipped to {-1, 0, +1}
times the per-tensor scale, straight-through gradient. Storage is 2 bits per
weight when packed (`pack_ternary`), plus one scale. Optional 8-bit activation
quantisation (per-token absmax) models inference with integer kernels; it is
off by default (act_bits=16): weight storage, activation precision and
optimizer precision are separate decisions.

Structured projections (candidate E): a Monarch-style product (Dao et al.,
arXiv 2204.00595). The input splits into b blocks mapped block-diagonally,
the blocks are interleaved (a fixed permutation), then a second block-
diagonal map mixes across the former blocks. Parameters and FLOPs are
n_in * n_out / b + n_out * b instead of n_in * n_out.
"""

from __future__ import annotations

import math

import torch
import torch.nn as nn
import torch.nn.functional as F


class RMSNorm(nn.Module):
    def __init__(self, d: int, eps: float = 1e-5):
        super().__init__()
        self.eps = eps
        self.weight = nn.Parameter(torch.ones(d))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        dtype = x.dtype
        x = x.float()
        x = x * torch.rsqrt(x.pow(2).mean(-1, keepdim=True) + self.eps)
        return (x * self.weight.float()).to(dtype)


def rope_cache(positions: torch.Tensor, head_dim: int, theta: float) -> tuple[torch.Tensor, torch.Tensor]:
    inv = 1.0 / (theta ** (torch.arange(0, head_dim, 2, device=positions.device, dtype=torch.float32) / head_dim))
    ang = positions.float()[:, None] * inv[None, :]
    return ang.cos(), ang.sin()


def apply_rope(x: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor) -> torch.Tensor:
    """x: (B, H, T, Dh); cos/sin: (T, Dh/2)."""
    x1, x2 = x[..., ::2].float(), x[..., 1::2].float()
    out = torch.stack((x1 * cos - x2 * sin, x1 * sin + x2 * cos), dim=-1).flatten(-2)
    return out.to(x.dtype)


def quantize_ternary(w: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
    scale = w.abs().mean().clamp_min(1e-8)
    return (w / scale).round().clamp(-1, 1), scale


def pack_ternary(q: torch.Tensor) -> torch.Tensor:
    """{-1, 0, 1} -> 2-bit codes, 4 per byte (storage format of checkpoints for inference)."""
    codes = (q.flatten().to(torch.int8) + 1).to(torch.uint8)            # 0, 1, 2
    pad = (-codes.numel()) % 4
    codes = torch.cat([codes, codes.new_zeros(pad)]).view(-1, 4)
    return codes[:, 0] | (codes[:, 1] << 2) | (codes[:, 2] << 4) | (codes[:, 3] << 6)


def unpack_ternary(packed: torch.Tensor, numel: int) -> torch.Tensor:
    codes = torch.stack([(packed >> s) & 3 for s in (0, 2, 4, 6)], 1).flatten()[:numel]
    return codes.to(torch.int8) - 1


class BitLinear(nn.Linear):
    """Linear layer with ternary weights in the forward pass (straight-through estimator)."""

    def __init__(self, n_in: int, n_out: int, bias: bool = False, act_bits: int = 16):
        super().__init__(n_in, n_out, bias=bias)
        self.act_bits = act_bits

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        q, scale = quantize_ternary(self.weight)
        w = self.weight + (q * scale - self.weight).detach()
        if self.act_bits == 8:
            s = x.abs().amax(-1, keepdim=True).clamp_min(1e-5) / 127
            x = x + ((x / s).round().clamp(-128, 127) * s - x).detach()
        return F.linear(x, w.to(x.dtype), None if self.bias is None else self.bias.to(x.dtype))

    def stored_bytes(self) -> int:
        return math.ceil(self.weight.numel() / 4) + 4 + (0 if self.bias is None else 2 * self.bias.numel())


class MonarchLinear(nn.Module):
    """n_in = b * p  ->  block-diagonal (b blocks p -> q) -> permute (b, q) -> (q, b)
    -> block-diagonal (q blocks b -> b) -> n_out = q * b."""

    def __init__(self, n_in: int, n_out: int, blocks: int = 4, lowbit: bool = False):
        super().__init__()
        assert n_in % blocks == 0 and n_out % blocks == 0, (n_in, n_out, blocks)
        self.b, self.p, self.q = blocks, n_in // blocks, n_out // blocks
        self.left = nn.Parameter(torch.randn(self.b, self.p, self.q) / math.sqrt(self.p))
        self.right = nn.Parameter(torch.randn(self.q, self.b, self.b) / math.sqrt(self.b))
        self.lowbit = lowbit

    def _w(self, w: torch.Tensor) -> torch.Tensor:
        if not self.lowbit:
            return w
        q, scale = quantize_ternary(w)
        return w + (q * scale - w).detach()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        shape = x.shape[:-1]
        x = x.reshape(-1, self.b, self.p)                                             # (N, b, p)
        y = torch.einsum("nbp,bpq->nbq", x, self._w(self.left).to(x.dtype))           # (N, b, q)
        y = y.transpose(1, 2)                                                         # (N, q, b)
        y = torch.einsum("nqb,qbc->nqc", y, self._w(self.right).to(x.dtype))          # (N, q, b)
        return y.reshape(*shape, self.q * self.b)

    def stored_bytes(self) -> int:
        n = self.left.numel() + self.right.numel()
        return math.ceil(n / 4) + 8 if self.lowbit else 2 * n


def make_linear(n_in: int, n_out: int, *, lowbit: str, structured: str, blocks: int, act_bits: int) -> nn.Module:
    if structured == "monarch" and n_in % blocks == 0 and n_out % blocks == 0:
        return MonarchLinear(n_in, n_out, blocks, lowbit=lowbit == "ternary")
    if lowbit == "ternary":
        return BitLinear(n_in, n_out, act_bits=act_bits)
    return nn.Linear(n_in, n_out, bias=False)


def stored_bytes(module: nn.Module, dtype_bytes: int = 2) -> int:
    """Checkpoint bytes for inference: low-bit layers packed, everything else in the compute dtype."""
    total, seen = 0, set()
    for m in module.modules():
        if isinstance(m, BitLinear) or (isinstance(m, MonarchLinear) and m.lowbit):
            total += m.stored_bytes()
            seen.update(id(p) for p in m.parameters(recurse=False))
    return total + dtype_bytes * sum(p.numel() for p in module.parameters() if id(p) not in seen)
