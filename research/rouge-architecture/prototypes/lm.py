"""Byte-level language models for R1.14 (10M parameters on enwik8).

Every model maps bytes (B, T) to next-byte logits (B, T, 256) and exposes
`init_state(batch)`, `forward(x, state) -> (logits, state)` and
`memory_bytes(context)`. Recurrent models return a new state; a
Transformer returns None and sees each segment on its own.

- TransformerLM: GPT-style decoder (pre-LayerNorm, RoPE, GELU MLP),
  full causal attention over the segment.
- RougeLM: block-recurrent. The sequence is cut into blocks of W bytes. In
  every layer, each byte attends to (a) the layer's S state slots, (b) the
  previous block and (c) the current block causally. After the block, the
  slots read the block through the same keys and values and update with a
  learned forget gate (biased to keep, the lesson of R1.12/R1.13):
      s <- g * s + (1 - g) * read,  g = sigmoid(W [s; read] + b), b = +2 at init.
  Inference memory is S slots plus one cached block per layer: constant in
  sequence length. With slots=0 it is a pure sliding-window Transformer
  (window W to 2W-1): the ablation that isolates the state.
- LSTMLM: stacked LSTM, the classic recurrent baseline.

Prior art for RougeLM: Block-Recurrent Transformer (2203.07852), Recurrent
Memory Transformer (2207.06881), Transformer-XL segment recurrence
(1901.02860), Griffin local attention + recurrence (2402.19427). What is
tested here is Rouge's variant: a few content-addressed slots with a gated
update, read by every byte, at a fixed parameter and byte budget.
"""

from __future__ import annotations

import math

import torch
import torch.nn as nn
import torch.nn.functional as F

VOCAB = 256


def rope_at(x: torch.Tensor, pos: torch.Tensor) -> torch.Tensor:
    """Rotary embedding of (B, H, T, Dh) at explicit positions (T,)."""
    dh = x.shape[-1]
    inv = 1.0 / (10000 ** (torch.arange(0, dh, 2, dtype=torch.float32) / dh))
    ang = pos.float()[:, None] * inv[None, :]
    cos, sin = ang.cos(), ang.sin()
    x1, x2 = x[..., ::2], x[..., 1::2]
    return torch.stack((x1 * cos - x2 * sin, x1 * sin + x2 * cos), dim=-1).flatten(-2)


class MLP(nn.Module):
    def __init__(self, d: int, ternary: bool = False):
        super().__init__()
        if ternary:
            from prototypes.structured import Ternary
            self.fc1, self.fc2 = Ternary(d, 4 * d), Ternary(4 * d, d)
        else:
            self.fc1, self.fc2 = nn.Linear(d, 4 * d), nn.Linear(4 * d, d)

    def forward(self, x):
        return self.fc2(F.gelu(self.fc1(x)))


class TransformerLM(nn.Module):
    recurrent = False

    def __init__(self, d=320, layers=8, heads=5, ternary=False):
        super().__init__()
        self.d, self.layers, self.heads = d, layers, heads
        self.embed = nn.Embedding(VOCAB, d)
        nn.init.normal_(self.embed.weight, std=0.02)  # tied output: unit-scale init gives logits of std sqrt(d)
        self.ln1 = nn.ModuleList(nn.LayerNorm(d) for _ in range(layers))
        self.ln2 = nn.ModuleList(nn.LayerNorm(d) for _ in range(layers))
        self.qkv = nn.ModuleList(nn.Linear(d, 3 * d) for _ in range(layers))
        self.proj = nn.ModuleList(nn.Linear(d, d) for _ in range(layers))
        self.mlp = nn.ModuleList(MLP(d, ternary) for _ in range(layers))
        self.norm = nn.LayerNorm(d)

    def init_state(self, batch: int):
        return None

    def forward(self, x, state=None):
        b, t = x.shape
        h = self.embed(x)
        pos = torch.arange(t)
        for i in range(self.layers):
            q, k, v = self.qkv[i](self.ln1[i](h)).view(b, t, 3, self.heads, self.d // self.heads).permute(2, 0, 3, 1, 4)
            y = F.scaled_dot_product_attention(rope_at(q, pos), rope_at(k, pos), v, is_causal=True)
            h = h + self.proj[i](y.transpose(1, 2).reshape(b, t, self.d))
            h = h + self.mlp[i](self.ln2[i](h))
        return self.norm(h) @ self.embed.weight.T, None

    def memory_bytes(self, context: int) -> dict:
        return {"state": 0, "kv": 2 * self.layers * context * self.d * 4}


class RougeLM(nn.Module):
    recurrent = True

    def __init__(self, d=272, layers=8, heads=4, slots=16, block=64, ternary=False,
                 memory_layers=(), memory_slots=512, memory_writes=8, memory_topk=8):
        super().__init__()
        self.d, self.layers, self.heads, self.slots, self.block = d, layers, heads, slots, block
        # R1.14b: exact addressable memory (R1.03's second level) in some layers. After each block the
        # layer writes the keys/values of its `memory_writes` highest-scoring bytes into a ring of
        # `memory_slots` entries; every byte reads its top `memory_topk` entries per head, in the same
        # softmax as its local attention. Keys are stored without rotary position: content addressing.
        self.memory_layers = tuple(memory_layers)
        self.memory_slots, self.memory_writes, self.memory_topk = memory_slots, memory_writes, memory_topk
        if self.memory_layers:
            self.m_write = nn.ModuleDict({str(i): nn.Linear(d, 1) for i in self.memory_layers})
        self.embed = nn.Embedding(VOCAB, d)
        nn.init.normal_(self.embed.weight, std=0.02)  # tied output: unit-scale init gives logits of std sqrt(d)
        self.ln1 = nn.ModuleList(nn.LayerNorm(d) for _ in range(layers))
        self.ln2 = nn.ModuleList(nn.LayerNorm(d) for _ in range(layers))
        self.qkv = nn.ModuleList(nn.Linear(d, 3 * d) for _ in range(layers))
        self.proj = nn.ModuleList(nn.Linear(d, d) for _ in range(layers))
        self.mlp = nn.ModuleList(MLP(d, ternary) for _ in range(layers))
        self.norm = nn.LayerNorm(d)
        if slots:
            self.s0 = nn.Parameter(torch.randn(layers, slots, d) * 0.02)
            self.s_ln = nn.ModuleList(nn.LayerNorm(d) for _ in range(layers))
            self.s_kv = nn.ModuleList(nn.Linear(d, 2 * d) for _ in range(layers))   # slots as keys/values for bytes
            self.s_q = nn.ModuleList(nn.Linear(d, d) for _ in range(layers))        # slots as queries over the block
            self.s_gate = nn.ModuleList(nn.Linear(2 * d, d) for _ in range(layers))
            for g in self.s_gate:
                nn.init.constant_(g.bias, 2.0)                                       # start by keeping the state

    def init_state(self, batch: int):
        """Per layer: slots (B, S, d) and the previous block's keys/values (B, H, W', Dh) or None."""
        slots = self.s0[:, None].expand(-1, batch, -1, -1) if self.slots else [None] * self.layers
        # clone: a view of the parameter made under no_grad would carry requires_grad without a grad_fn
        state = {"slots": [None if s is None else s.clone() for s in slots], "prev": [None] * self.layers}
        if self.memory_layers:
            hd = self.d // self.heads
            state["mem"] = [{"k": torch.zeros(batch, self.heads, self.memory_slots, hd), "v": torch.zeros(batch, self.heads, self.memory_slots, hd),
                             "valid": torch.zeros(batch, self.memory_slots, dtype=torch.bool), "ptr": 0}
                            if i in self.memory_layers else None for i in range(self.layers)]
        return state

    def reset(self, state, mask: torch.Tensor):
        """Restart the streams where mask is True (a new region of text)."""
        if not mask.any():
            return state
        keep = (~mask).float()
        slots = [None if s is None else s * keep[:, None, None] + self.s0[i][None] * (1 - keep)[:, None, None]
                 for i, s in enumerate(state["slots"])]
        prev = [None if p is None else tuple(t * keep[:, None, None, None] for t in p) for p in state["prev"]]
        out = {"slots": slots, "prev": prev}
        if "mem" in state:
            out["mem"] = [None if m is None else {**m, "valid": m["valid"] & ~mask[:, None]} for m in state["mem"]]
        return out

    def _layer(self, i, h, slots, prev, mem=None):
        b, w, d = h.shape
        hd = d // self.heads
        q, k, v = self.qkv[i](self.ln1[i](h)).view(b, w, 3, self.heads, hd).permute(2, 0, 3, 1, 4)
        q_raw = q
        p = 0 if prev is None else prev[0].shape[2]
        q = rope_at(q, torch.arange(p, p + w))
        k_cur = rope_at(k, torch.arange(p, p + w))
        keys, vals = [k_cur], [v]
        if prev is not None:
            keys.insert(0, prev[0])
            vals.insert(0, prev[1])
        mask = torch.ones(w, p + w, dtype=torch.bool)
        mask[:, p:] = torch.tril(torch.ones(w, w, dtype=torch.bool))
        if self.slots:
            sk, sv = self.s_kv[i](self.s_ln[i](slots)).view(b, self.slots, 2, self.heads, hd).permute(2, 0, 3, 1, 4)
            keys.insert(0, sk)
            vals.insert(0, sv)
            mask = torch.cat([torch.ones(w, self.slots, dtype=torch.bool), mask], 1)
        if mem is None:
            y = F.scaled_dot_product_attention(q, torch.cat(keys, 2), torch.cat(vals, 2), attn_mask=mask)
        else:
            y = self._attend_with_memory(q, q_raw, torch.cat(keys, 2), torch.cat(vals, 2), mask, mem)
        h = h + self.proj[i](y.transpose(1, 2).reshape(b, w, d))
        h = h + self.mlp[i](self.ln2[i](h))
        if self.slots:  # the slots read this block through the bytes' own keys and values
            sq = self.s_q[i](self.s_ln[i](slots)).view(b, self.slots, self.heads, hd).transpose(1, 2)
            read = F.scaled_dot_product_attention(sq, k_cur, v).transpose(1, 2).reshape(b, self.slots, d)
            gate = torch.sigmoid(self.s_gate[i](torch.cat([slots, read], -1)))
            slots = gate * slots + (1 - gate) * read
        if mem is not None:
            mem = self._write(i, h, k, v, mem)
        # the cache keeps this block's keys at positions 0..w-1 for the next block
        return h, slots, (rope_at(k, torch.arange(w)), v), mem

    def _attend_with_memory(self, q, q_raw, keys, vals, mask, mem):
        """One softmax over local keys (rotary) and the top-k memory entries (content only)."""
        b, heads, w, hd = q.shape
        scale = hd ** -0.5
        local = (q @ keys.transpose(-1, -2) * scale).masked_fill(~mask, float("-inf"))
        scores = (q_raw @ mem["k"].transpose(-1, -2) * scale).masked_fill(~mem["valid"][:, None, None, :], float("-inf"))
        kth = scores.topk(min(self.memory_topk, self.memory_slots), dim=-1).values[..., -1:]          # sparse read: top-k only
        scores = scores.masked_fill(scores < kth, float("-inf"))
        attn = torch.softmax(torch.cat([local, scores], -1), -1)                                       # empty memory: weight 0
        n = keys.shape[2]
        return attn[..., :n] @ vals + attn[..., n:] @ mem["v"]

    def _write(self, i, h, k, v, mem):
        """Write the block's highest-scoring bytes into the ring; the score scales the stored value,
        so the write head learns which bytes are worth keeping."""
        b, heads, w, hd = k.shape
        n = min(self.memory_writes, w)
        score = torch.sigmoid(self.m_write[str(i)](h)).squeeze(-1)                                    # (B, W)
        top, idx = score.topk(n, dim=-1)                                                                # (B, n)
        gather = idx[:, None, :, None].expand(-1, heads, -1, hd)
        k_new = torch.gather(k, 2, gather)
        v_new = torch.gather(v, 2, gather) * top[:, None, :, None]
        pos = (torch.arange(n) + mem["ptr"]) % self.memory_slots
        return {"k": mem["k"].index_copy(2, pos, k_new), "v": mem["v"].index_copy(2, pos, v_new),
                "valid": mem["valid"].index_fill(1, pos, True), "ptr": (mem["ptr"] + n) % self.memory_slots}

    def forward(self, x, state=None):
        b, t = x.shape
        state = state or self.init_state(b)
        slots, prev = list(state["slots"]), list(state["prev"])
        mem = list(state.get("mem", [None] * self.layers))
        outs = []
        for start in range(0, t, self.block):
            h = self.embed(x[:, start:start + self.block])
            for i in range(self.layers):
                h, slots[i], prev[i], mem[i] = self._layer(i, h, slots[i], prev[i], mem[i])
            outs.append(self.norm(h))
        logits = torch.cat(outs, 1) @ self.embed.weight.T
        new = {"slots": slots, "prev": prev}
        if self.memory_layers:
            new["mem"] = mem
        return logits, new

    @staticmethod
    def detach(state):
        out = {"slots": [None if s is None else s.detach() for s in state["slots"]],
               "prev": [None if p is None else (p[0].detach(), p[1].detach()) for p in state["prev"]]}
        if "mem" in state:
            out["mem"] = [None if m is None else {**m, "k": m["k"].detach(), "v": m["v"].detach()} for m in state["mem"]]
        return out

    def memory_bytes(self, context: int) -> dict:
        memory = len(self.memory_layers) * (2 * self.memory_slots * self.d * 4 + self.memory_slots)
        return {"state": 4 * self.layers * self.slots * self.d + memory, "kv": 2 * self.layers * min(context, self.block) * self.d * 4}


class LSTMLM(nn.Module):
    recurrent = True

    def __init__(self, d=784, layers=2):
        super().__init__()
        self.d, self.layers = d, layers
        self.embed = nn.Embedding(VOCAB, d)
        nn.init.normal_(self.embed.weight, std=0.02)  # tied output: unit-scale init gives logits of std sqrt(d)
        self.lstm = nn.LSTM(d, d, layers, batch_first=True)
        self.norm = nn.LayerNorm(d)

    def init_state(self, batch: int):
        return None

    def reset(self, state, mask: torch.Tensor):
        if state is None or not mask.any():
            return state
        keep = (~mask).float()[None, :, None]
        return tuple(s * keep for s in state)

    def forward(self, x, state=None):
        y, state = self.lstm(self.embed(x), state)
        return self.norm(y) @ self.embed.weight.T, state

    @staticmethod
    def detach(state):
        return None if state is None else tuple(s.detach() for s in state)

    def memory_bytes(self, context: int) -> dict:
        return {"state": 2 * self.layers * self.d * 4, "kv": 0}

    def analytic_flops_per_byte(self) -> float:
        return 2 * (8 * self.d * self.d * self.layers) + 2 * self.d * VOCAB  # 4 gates x (input + hidden) + head


def build(kind: str, **config) -> nn.Module:
    return {"transformer": TransformerLM, "rouge": RougeLM, "lstm": LSTMLM}[kind](**config)


def stored_bytes(model: nn.Module) -> int:
    """fp32 bytes, with ternary layers counted at 2 bits per weight plus a scale."""
    from prototypes.structured import Ternary
    total, seen = 0, set()
    for m in model.modules():
        if isinstance(m, Ternary):
            total += math.ceil(m.weight.numel() * 2 / 8) + 4 + 4 * m.bias.numel()
            seen.update({id(m.weight), id(m.bias)})
    return total + 4 * sum(p.numel() for p in model.parameters() if id(p) not in seen)
