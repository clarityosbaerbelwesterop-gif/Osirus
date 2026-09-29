"""R1.25-R1.29: structured, shared, generated and low-bit weights.

Every class is a drop-in for nn.Linear(n_in, n_out) inside the Transformer
MLP (`StructuredTransformer`), so the only difference between runs is how
the MLP weights are represented. Each reports `stored_bytes()`: the bytes
that must be kept on disk / in memory for its weights (fp32, or the
packed low-bit size for the ternary layer).

| kind      | W                                                   | milestone | prior art                        |
| --------- | --------------------------------------------------- | --------- | -------------------------------- |
| dense     | full matrix                                         | baseline  | -                                |
| lowrank   | U V, rank r                                         | R1.26     | ALBERT 1909.11942, LoRA 2106.09685 |
| kron      | A (x) B (Kronecker)                                 | R1.26     | KronA 2212.10650                 |
| tt        | 2-core tensor-train (TT-matrix)                     | R1.26     | Tensorizing NNs 1509.06569       |
| bank      | sum_i alpha_i B_i, bank shared by all layers        | R1.27     | Savarese & Maire 1902.09701      |
| ternary   | {-1, 0, +1} x scale, trained from the start (STE)   | R1.29     | BitNet b1.58 2402.17764          |
| hyper     | W0 + U(x) V(x): low-rank delta generated per input  | R1.25     | HyperNetworks 1609.09106         |
| field     | W[o, i] = f(phi(o), phi(i)), implicit weight field  | R1.28     | SIREN 2006.09661, HyperNetworks  |
"""

from __future__ import annotations

import math

import torch
import torch.nn as nn
import torch.nn.functional as F

from prototypes.transformer_baseline import rope


class LowRank(nn.Module):
    def __init__(self, n_in, n_out, rank):
        super().__init__()
        self.u = nn.Linear(n_in, rank, bias=False)
        self.v = nn.Linear(rank, n_out)

    def forward(self, x):
        return self.v(self.u(x))

    def stored_bytes(self):
        return 4 * sum(p.numel() for p in self.parameters())


class Kronecker(nn.Module):
    """W = A (x) B with A: (o1, i1), B: (o2, i2), n_in = i1 i2, n_out = o1 o2; y = A X B^T on the reshaped input."""

    def __init__(self, n_in, n_out, i1=8, o1=8):
        super().__init__()
        self.i1, self.i2, self.o1, self.o2 = i1, n_in // i1, o1, n_out // o1
        self.a = nn.Parameter(torch.randn(self.o1, self.i1) / math.sqrt(self.i1))
        self.b = nn.Parameter(torch.randn(self.o2, self.i2) / math.sqrt(self.i2))
        self.bias = nn.Parameter(torch.zeros(n_out))

    def forward(self, x):
        shape = x.shape[:-1]
        xm = x.reshape(-1, self.i1, self.i2)
        y = torch.einsum("oi,nij,pj->nop", self.a, xm, self.b)
        return y.reshape(*shape, self.o1 * self.o2) + self.bias

    def stored_bytes(self):
        return 4 * sum(p.numel() for p in self.parameters())


class TensorTrain(nn.Module):
    """TT-matrix with two cores: W[(o1 o2), (i1 i2)] = sum_r G1[o1, i1, r] G2[r, o2, i2]."""

    def __init__(self, n_in, n_out, i1=8, o1=8, rank=8):
        super().__init__()
        self.i1, self.i2, self.o1, self.o2 = i1, n_in // i1, o1, n_out // o1
        self.g1 = nn.Parameter(torch.randn(self.o1, self.i1, rank) / math.sqrt(self.i1 * rank))
        self.g2 = nn.Parameter(torch.randn(rank, self.o2, self.i2) / math.sqrt(self.i2))
        self.bias = nn.Parameter(torch.zeros(n_out))

    def forward(self, x):
        shape = x.shape[:-1]
        xm = x.reshape(-1, self.i1, self.i2)
        t = torch.einsum("nij,rpj->nirp", xm, self.g2)            # contract i2
        y = torch.einsum("nirp,oir->nop", t, self.g1)               # contract i1 and rank
        return y.reshape(*shape, self.o1 * self.o2) + self.bias

    def stored_bytes(self):
        return 4 * sum(p.numel() for p in self.parameters())


class BasisBank(nn.Module):
    """W_layer = sum_i alpha_layer,i B_i. The bank tensor is shared by every
    layer that receives the same `bank` object; each layer owns only alpha."""

    def __init__(self, n_in, n_out, bank: nn.Parameter):
        super().__init__()
        self.bank = bank                                             # (n, n_out, n_in), shared
        self.alpha = nn.Parameter(torch.randn(bank.shape[0]) / math.sqrt(bank.shape[0]))
        self.bias = nn.Parameter(torch.zeros(n_out))

    def forward(self, x):
        return F.linear(x, torch.einsum("i,ioj->oj", self.alpha, self.bank), self.bias)

    def stored_bytes(self):
        return 4 * (self.alpha.numel() + self.bias.numel())         # the shared bank is counted once by the model


class Ternary(nn.Module):
    """BitNet b1.58-style: latent fp32 weights, forward uses round(W / mean|W|) clipped to {-1, 0, 1} times
    the scale, straight-through gradient. Stored: 1.58 bits per weight (packed, 2 bits in practice) + scale."""

    def __init__(self, n_in, n_out):
        super().__init__()
        self.weight = nn.Parameter(torch.randn(n_out, n_in) / math.sqrt(n_in))
        self.bias = nn.Parameter(torch.zeros(n_out))

    def forward(self, x):
        scale = self.weight.abs().mean().clamp_min(1e-8)
        q = (self.weight / scale).round().clamp(-1, 1) * scale
        w = self.weight + (q - self.weight).detach()                 # straight-through estimator
        return F.linear(x, w, self.bias)

    def stored_bytes(self):
        return math.ceil(self.weight.numel() * 2 / 8) + 4 * (1 + self.bias.numel())


class HyperLoRA(nn.Module):
    """y = W0 x + U(c) (V(c) x): a rank-r delta generated per example from the
    mean input c of the sequence (task/state-conditioned weights, R1.25).
    The generator goes through a small bottleneck h, so it stores
    h x (n_out r + r n_in) instead of n_in x (n_out r + r n_in) numbers."""

    def __init__(self, n_in, n_out, rank=2, bottleneck=16):
        super().__init__()
        self.base = nn.Linear(n_in, n_out)
        self.squeeze = nn.Linear(n_in, bottleneck)
        self.gen_u = nn.Linear(bottleneck, n_out * rank)
        self.gen_v = nn.Linear(bottleneck, rank * n_in)
        nn.init.zeros_(self.gen_u.weight)
        nn.init.zeros_(self.gen_u.bias)
        self.rank, self.n_in, self.n_out = rank, n_in, n_out

    def forward(self, x):                                            # x: (B, T, n_in)
        h = torch.tanh(self.squeeze(x.mean(1)))
        u = self.gen_u(h).view(-1, self.n_out, self.rank)
        v = self.gen_v(h).view(-1, self.rank, self.n_in)
        return self.base(x) + torch.einsum("bor,brt->bto", u, torch.einsum("bri,bti->brt", v, x))

    def stored_bytes(self):
        return 4 * sum(p.numel() for p in self.parameters())


class WeightField(nn.Module):
    """Implicit weights (R1.28): W[o, i] = f(phi(o), phi(i)) with a small MLP f
    over sinusoidal coordinate features. Stores only f; decodes W every
    forward pass (the decoding FLOPs are reported, not hidden)."""

    def __init__(self, n_in, n_out, width=32, freqs=8):
        super().__init__()
        def feats(n):
            pos = torch.arange(n, dtype=torch.float32)[:, None] / n
            k = torch.arange(1, freqs + 1, dtype=torch.float32)[None, :] * math.pi
            return torch.cat([torch.sin(pos * k), torch.cos(pos * k)], -1)
        self.register_buffer("fo", feats(n_out), persistent=False)
        self.register_buffer("fi", feats(n_in), persistent=False)
        self.f = nn.Sequential(nn.Linear(4 * freqs, width), nn.GELU(), nn.Linear(width, width), nn.GELU(), nn.Linear(width, 1))
        self.scale = nn.Parameter(torch.tensor(1.0 / math.sqrt(n_in)))
        self.bias = nn.Parameter(torch.zeros(n_out))

    def forward(self, x):
        n_out, n_in = self.fo.shape[0], self.fi.shape[0]
        coords = torch.cat([self.fo[:, None, :].expand(n_out, n_in, -1), self.fi[None, :, :].expand(n_out, n_in, -1)], -1)
        w = self.f(coords).squeeze(-1) * self.scale
        return F.linear(x, w, self.bias)

    def stored_bytes(self):
        return 4 * sum(p.numel() for p in self.parameters())


def make_linear(kind: str, n_in: int, n_out: int, shared: dict, **kw) -> nn.Module:
    if kind == "dense":
        return nn.Linear(n_in, n_out)
    if kind == "lowrank":
        return LowRank(n_in, n_out, kw.get("rank", 16))
    if kind == "kron":
        return Kronecker(n_in, n_out, kw.get("i1", 8), kw.get("o1", 8))
    if kind == "tt":
        return TensorTrain(n_in, n_out, kw.get("i1", 8), kw.get("o1", 8), kw.get("rank", 8))
    if kind == "bank":
        key = (n_out, n_in)
        if key not in shared:
            shared[key] = nn.Parameter(torch.randn(kw.get("bank_size", 2), n_out, n_in) / math.sqrt(n_in))
        return BasisBank(n_in, n_out, shared[key])
    if kind == "ternary":
        return Ternary(n_in, n_out)
    if kind == "hyper":
        return HyperLoRA(n_in, n_out, kw.get("rank", 2), kw.get("bottleneck", 16))
    if kind == "field":
        return WeightField(n_in, n_out, kw.get("width", 32))
    raise ValueError(kind)


class SBlock(nn.Module):
    def __init__(self, d, heads, mlp_kind, shared, ff_mult=4, **kw):
        super().__init__()
        self.heads = heads
        self.ln1, self.ln2 = nn.LayerNorm(d), nn.LayerNorm(d)
        self.qkv, self.out = nn.Linear(d, 3 * d), nn.Linear(d, d)
        self.fc1 = make_linear(mlp_kind, d, ff_mult * d, shared, **kw)
        self.fc2 = make_linear(mlp_kind, ff_mult * d, d, shared, **kw)

    def forward(self, x):
        b, t, d = x.shape
        q, k, v = self.qkv(self.ln1(x)).view(b, t, 3, self.heads, d // self.heads).permute(2, 0, 3, 1, 4)
        y = F.scaled_dot_product_attention(rope(q), rope(k), v, is_causal=True)
        x = x + self.out(y.transpose(1, 2).reshape(b, t, d))
        return x + self.fc2(F.gelu(self.fc1(self.ln2(x))))


class StructuredTransformer(nn.Module):
    """The R1.01 Transformer with a pluggable MLP weight representation."""

    def __init__(self, vocab, d=64, layers=4, heads=4, mlp_kind="dense", ff_mult=4, **kw):
        super().__init__()
        self.shared: dict = {}
        self.embed = nn.Embedding(vocab, d)
        self.blocks = nn.ModuleList(SBlock(d, heads, mlp_kind, self.shared, ff_mult, **kw) for _ in range(layers))
        self.banks = nn.ParameterList(list(self.shared.values()))   # register shared banks once
        self.ln = nn.LayerNorm(d)
        self.head = nn.Linear(d, vocab)
        self.d, self.layers = d, layers

    def forward(self, ids, lengths):
        x = self.embed(ids)
        for block in self.blocks:
            x = block(x)
        return self.head(self.ln(x[torch.arange(ids.shape[0]), lengths - 1])), {}

    def stored_bytes(self) -> int:
        """Bytes needed to store every weight (low-bit layers packed, shared banks once)."""
        total, seen = 0, set()
        for m in self.modules():
            if m is self:
                continue
            if hasattr(m, "stored_bytes") and not isinstance(m, StructuredTransformer):
                total += m.stored_bytes()
                seen.update(id(p) for p in m.parameters(recurse=True))
        seen.update(id(p) for p in self.banks)
        total += 4 * sum(p.numel() for p in self.banks)
        total += 4 * sum(p.numel() for p in self.parameters() if id(p) not in seen)
        return total

    def memory_bytes(self, tokens):
        return {"state": 0, "kv": 2 * self.layers * tokens * self.d * 4}
