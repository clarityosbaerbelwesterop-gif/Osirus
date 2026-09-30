"""Rouge native decoder (Architecture v1 candidates A-E, one implementation).

Decoder-only, pre-norm (RMSNorm), rotary positions, SwiGLU feed-forward,
tied embeddings. The configuration selects:
- attention pattern: full causal, or hybrid (sliding-window layers with a
  global layer every `global_every` layers: exact access to any earlier
  token, the fix for R1.16, at a fraction of the KV cache);
- low-bit weights (BitNet b1.58) in the FFN or in every projection;
- sparse FFN: shared experts plus top-k routed experts, balanced without an
  auxiliary loss by a selection bias (DeepSeek-V3), with real dispatch (only
  selected tokens run through an expert, the R1.22 kernel result);
- structured (Monarch) projections.

Training: `model(idx, targets)` returns the mean next-token loss, computed in
chunks with activation checkpointing so the vocabulary logits of a whole
batch never exist at once. Inference: `model(idx, cache=...)` returns logits
and an updated KV cache; local layers keep only their window.
"""

from __future__ import annotations

import math

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.checkpoint import checkpoint

from .config import RougeConfig
from .layers import RMSNorm, apply_rope, make_linear, rope_cache, stored_bytes


def _proj(cfg: RougeConfig, n_in: int, n_out: int, *, ffn: bool) -> nn.Module:
    lowbit = cfg.lowbit if (ffn or cfg.lowbit_scope == "all") else "none"
    return make_linear(n_in, n_out, lowbit=lowbit, structured=cfg.structured, blocks=cfg.structured_blocks, act_bits=cfg.act_bits)


class Attention(nn.Module):
    def __init__(self, cfg: RougeConfig, layer: int):
        super().__init__()
        self.cfg, self.layer = cfg, layer
        self.is_global = cfg.is_global(layer)
        self.window = None if self.is_global else cfg.window
        hd, kv = cfg.head_dim, cfg.n_kv_heads
        self.q = _proj(cfg, cfg.d_model, cfg.n_heads * hd, ffn=False)
        self.k = _proj(cfg, cfg.d_model, kv * hd, ffn=False)
        self.v = _proj(cfg, cfg.d_model, kv * hd, ffn=False)
        self.o = _proj(cfg, cfg.n_heads * hd, cfg.d_model, ffn=False)

    def forward(self, x, cos, sin, positions, cache=None):
        b, t, _ = x.shape
        cfg, hd = self.cfg, self.cfg.head_dim
        q = self.q(x).view(b, t, cfg.n_heads, hd).transpose(1, 2)
        k = self.k(x).view(b, t, cfg.n_kv_heads, hd).transpose(1, 2)
        v = self.v(x).view(b, t, cfg.n_kv_heads, hd).transpose(1, 2)
        q, k = apply_rope(q, cos, sin), apply_rope(k, cos, sin)
        key_pos = positions
        if cache is not None:
            if cache.get("k") is not None:
                k = torch.cat([cache["k"], k], 2)
                v = torch.cat([cache["v"], v], 2)
                key_pos = torch.cat([cache["pos"], positions])
            keep = k.shape[2] if self.window is None else min(k.shape[2], self.window)
            cache = {"k": k[:, :, -keep:], "v": v[:, :, -keep:], "pos": key_pos[-keep:]}
        rep = cfg.n_heads // cfg.n_kv_heads
        if rep > 1:
            k, v = k.repeat_interleave(rep, 1), v.repeat_interleave(rep, 1)
        if self.window is None and key_pos.shape[0] == positions.shape[0]:
            y = F.scaled_dot_product_attention(q, k, v, is_causal=True)
        else:
            allowed = key_pos[None, :] <= positions[:, None]
            if self.window is not None:
                allowed = allowed & (positions[:, None] - key_pos[None, :] < self.window)
            y = F.scaled_dot_product_attention(q, k, v, attn_mask=allowed)
        return self.o(y.transpose(1, 2).reshape(b, t, cfg.n_heads * hd)), cache


class SwiGLU(nn.Module):
    def __init__(self, cfg: RougeConfig, hidden: int):
        super().__init__()
        self.gate = _proj(cfg, cfg.d_model, hidden, ffn=True)
        self.up = _proj(cfg, cfg.d_model, hidden, ffn=True)
        self.down = _proj(cfg, hidden, cfg.d_model, ffn=True)

    def forward(self, x):
        return self.down(F.silu(self.gate(x)) * self.up(x))


class MoE(nn.Module):
    """Shared experts (always on) + top-k routed experts. Routing scores are
    sigmoid affinities; a per-expert bias, updated outside the gradient,
    steers selection towards under-used experts (no auxiliary loss); the
    gate weights use the unbiased scores. Shared hidden = hidden - k * expert
    hidden, so active FFN FLOPs equal the dense FFN's."""

    def __init__(self, cfg: RougeConfig):
        super().__init__()
        self.cfg, self.e, self.k = cfg, cfg.moe_experts, cfg.moe_topk
        self.router = nn.Linear(cfg.d_model, self.e, bias=False)
        self.register_buffer("bias", torch.zeros(self.e))
        self.register_buffer("load", torch.zeros(self.e))                         # last step's load fraction
        self.experts = nn.ModuleList(SwiGLU(cfg, cfg.expert_hidden) for _ in range(self.e))
        shared_hidden = max(cfg.expert_hidden, cfg.hidden - self.k * cfg.expert_hidden)
        self.shared = nn.ModuleList(SwiGLU(cfg, shared_hidden // max(1, cfg.moe_shared)) for _ in range(cfg.moe_shared))

    def forward(self, x):
        shape = x.shape
        flat = x.reshape(-1, shape[-1])
        scores = torch.sigmoid(self.router(flat.float()))                        # (N, E)
        top = torch.topk(scores + self.bias, self.k, dim=-1).indices               # selection uses the bias
        gates = torch.gather(scores, 1, top)
        gates = (gates / gates.sum(-1, keepdim=True)).to(flat.dtype)
        out = sum(s(flat) for s in self.shared) if len(self.shared) else torch.zeros_like(flat)
        counts = torch.zeros(self.e, device=flat.device)
        for e, expert in enumerate(self.experts):                                  # real dispatch: selected tokens only
            rows, slot = (top == e).nonzero(as_tuple=True)
            counts[e] = rows.numel()
            if rows.numel():
                out = out.index_add(0, rows, expert(flat[rows]) * gates[rows, slot, None])
        with torch.no_grad():
            if torch.distributed.is_available() and torch.distributed.is_initialized():
                torch.distributed.all_reduce(counts)                                 # one balance for all ranks
            frac = counts / counts.sum().clamp_min(1)
            self.load.copy_(frac)
            if self.training:
                self.bias += self.cfg.moe_bias_rate * torch.sign(1.0 / self.e - frac)
        return out.reshape(shape)


class Block(nn.Module):
    def __init__(self, cfg: RougeConfig, layer: int):
        super().__init__()
        self.norm1, self.norm2 = RMSNorm(cfg.d_model, cfg.norm_eps), RMSNorm(cfg.d_model, cfg.norm_eps)
        self.attn = Attention(cfg, layer)
        self.ffn = MoE(cfg) if cfg.moe_experts else SwiGLU(cfg, cfg.hidden)

    def forward(self, x, cos, sin, positions, cache=None):
        a, cache = self.attn(self.norm1(x), cos, sin, positions, cache)
        x = x + a
        return x + self.ffn(self.norm2(x)), cache


class RougeModel(nn.Module):
    def __init__(self, cfg: RougeConfig):
        super().__init__()
        self.cfg = cfg
        self.embed = nn.Embedding(cfg.vocab_size, cfg.d_model)
        self.blocks = nn.ModuleList(Block(cfg, i) for i in range(cfg.n_layers))
        self.norm = RMSNorm(cfg.d_model, cfg.norm_eps)
        self.head = None if cfg.tie_embeddings else nn.Linear(cfg.d_model, cfg.vocab_size, bias=False)
        self.gradient_checkpointing = False
        self.apply(self._init)
        for block in self.blocks:  # scaled residual outputs (GPT-2 / Llama practice)
            ffns = [block.ffn] if isinstance(block.ffn, SwiGLU) else [*block.ffn.experts, *block.ffn.shared]
            for m in (block.attn.o, *(f.down for f in ffns)):
                for p in m.parameters():
                    if p.dim() >= 2:
                        nn.init.normal_(p, std=0.02 / math.sqrt(2 * cfg.n_layers))

    @staticmethod
    def _init(m):
        if isinstance(m, (nn.Linear, nn.Embedding)):
            nn.init.normal_(m.weight, std=0.02)

    # --- forward -----------------------------------------------------------------
    def hidden_states(self, idx, cache=None, start: int = 0):
        b, t = idx.shape
        positions = torch.arange(start, start + t, device=idx.device)
        cos, sin = rope_cache(positions, self.cfg.head_dim, self.cfg.rope_theta)
        x = self.embed(idx)
        new_cache = [] if cache is not None else None
        for i, block in enumerate(self.blocks):
            layer_cache = cache[i] if cache is not None else None
            if self.gradient_checkpointing and self.training and cache is None:
                x, _ = checkpoint(block, x, cos, sin, positions, None, use_reentrant=False)
            else:
                x, layer_cache = block(x, cos, sin, positions, layer_cache)
            if new_cache is not None:
                new_cache.append(layer_cache)
        return self.norm(x), new_cache

    def logits(self, h):
        return h @ self.embed.weight.T if self.head is None else self.head(h)

    def forward(self, idx, targets=None, cache=None, start: int = 0, chunk: int = 4096):
        h, new_cache = self.hidden_states(idx, cache, start)
        if targets is None:
            return self.logits(h), new_cache
        flat_h, flat_t = h.reshape(-1, h.shape[-1]), targets.reshape(-1)

        def piece(hh, tt):
            return F.cross_entropy(self.logits(hh).float(), tt, reduction="sum", ignore_index=-100)

        total = 0.0
        for s in range(0, flat_h.shape[0], chunk):
            hh, tt = flat_h[s:s + chunk], flat_t[s:s + chunk]
            total = total + (checkpoint(piece, hh, tt, use_reentrant=False) if self.training else piece(hh, tt))
        return total / (flat_t != -100).sum().clamp_min(1)

    def init_cache(self):
        return [{} for _ in self.blocks]

    # --- accounting --------------------------------------------------------------
    def num_params(self) -> int:
        return sum(p.numel() for p in self.parameters())

    def active_params(self) -> int:
        """Parameters used per token (MoE: shared + top-k experts; embedding lookup excluded, head included)."""
        total = self.num_params() - self.embed.weight.numel()
        if self.head is None:
            total += self.embed.weight.numel()                                    # the tied head is a matmul
        for block in self.blocks:
            if isinstance(block.ffn, MoE):
                per_expert = sum(p.numel() for p in block.ffn.experts[0].parameters())
                total -= per_expert * (block.ffn.e - block.ffn.k)
        return total

    def stored_bytes(self) -> int:
        return stored_bytes(self)

    def kv_bytes(self, context: int, dtype_bytes: int = 2) -> int:
        cfg = self.cfg
        per_token = 2 * cfg.n_kv_heads * cfg.head_dim * dtype_bytes
        return sum(per_token * (context if b.attn.is_global else min(context, cfg.window)) for b in self.blocks)
