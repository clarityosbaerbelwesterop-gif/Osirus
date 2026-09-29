"""R1.17 / R1.20 / R1.21: dynamic compute inside the model (not prompts).

- MoDTransformer (R1.17, per-token adaptive depth; Mixture-of-Depths,
  Raposo et al. 2024, arXiv 2404.02258): in every block after the first, a
  router picks the top `capacity` fraction of positions; only those pass
  through attention + MLP (attending among themselves), the rest skip via
  the residual. The last position (where the answer is read) is always
  processed. Routing looks at the whole input, which is fine for this
  answer-at-the-end benchmark and noted as a limitation for generation.
- KnobLooped (R1.20, "think harder"): one shared causal block iterated n
  times; trained with n drawn at random from [1, max_steps] so that at
  inference the depth knob FAST/NORMAL/DEEP/ULTRA = 1/2/4/8 iterations
  is meaningful (recurrent-depth training, Geiping et al. 2025).
- EarlyExit (R1.21): a Transformer with an answer head after every layer,
  all trained (deep supervision); at inference the model stops at the
  first layer whose answer confidence exceeds a threshold (CALM
  2207.07061, DeeBERT 2004.12993).

Every model exposes `variants`: named inference settings that the suite
runner evaluates separately (accuracy, FLOPs and, for early exit, the
exit layer and the false-exit rate).
"""

from __future__ import annotations

import math

import torch
import torch.nn as nn
import torch.nn.functional as F

from prototypes.transformer_baseline import Block, rope


def _last(x, lengths):
    return x[torch.arange(x.shape[0]), lengths - 1]


class MoDBlock(Block):
    def forward_routed(self, x, lengths, capacity, router):
        b, t, d = x.shape
        # per-example budget ceil(capacity * length): padding never changes what a sequence gets
        k_i = torch.clamp(torch.ceil(capacity * lengths.float()).long(), min=1)
        k = int(k_i.max())
        raw = router(x).squeeze(-1)                                   # (B, T)
        pad = torch.arange(t)[None, :] >= lengths[:, None]
        scores = raw.masked_fill(pad, float("-inf"))
        scores[torch.arange(b), lengths - 1] = float("inf")          # the answer position is always processed
        top = scores.topk(k, -1)
        chosen = torch.arange(k)[None, :] < k_i[:, None]             # the i-th example keeps its first k_i picks
        idx = top.indices.masked_fill(~chosen, t - 1) if t > 0 else top.indices
        order = idx.masked_fill(~chosen, t + 1).sort(-1)
        idx, chosen = order.values.clamp(max=t - 1), chosen.gather(1, order.indices)  # causal order, chosen first
        xs = x.gather(1, idx[:, :, None].expand(-1, -1, d))
        q, kk, v = self.qkv(self.ln1(xs)).view(b, k, 3, self.heads, d // self.heads).permute(2, 0, 3, 1, 4)
        # rope with the tokens' original positions
        pos = idx.float()
        def rot(z):
            dh = z.shape[-1]
            inv = 1.0 / (10000 ** (torch.arange(0, dh, 2, dtype=torch.float32) / dh))
            ang = pos[:, None, :, None] * inv[None, None, None, :]
            z1, z2 = z[..., ::2], z[..., 1::2]
            return torch.stack((z1 * ang.cos() - z2 * ang.sin(), z1 * ang.sin() + z2 * ang.cos()), -1).flatten(-2)
        causal = (idx[:, None, :, None] >= idx[:, None, None, :]) & chosen[:, None, None, :]   # (B, 1, k, k)
        causal = causal | torch.eye(k, dtype=torch.bool)[None, None]                           # every row sees itself
        y = F.scaled_dot_product_attention(rot(q), rot(kk), v, attn_mask=causal)
        h = xs + self.out(y.transpose(1, 2).reshape(b, k, d))
        h = h + self.mlp(self.ln2(h))
        gate = torch.sigmoid(raw.gather(1, idx).clamp(-20, 20))     # router gets gradient through the gate
        gate = torch.where(idx == (lengths - 1)[:, None], torch.ones_like(gate), gate) * chosen.float()
        return x.scatter_add(1, idx[:, :, None].expand(-1, -1, d), gate[:, :, None] * (h - xs))


class MoDTransformer(nn.Module):
    def __init__(self, vocab, d=64, layers=4, heads=4, capacity=0.5):
        super().__init__()
        self.embed = nn.Embedding(vocab, d)
        self.blocks = nn.ModuleList(MoDBlock(d, heads) for _ in range(layers))
        self.routers = nn.ModuleList(nn.Linear(d, 1) for _ in range(layers))
        self.ln, self.head = nn.LayerNorm(d), nn.Linear(d, vocab)
        self.d, self.layers, self.capacity = d, layers, capacity
        self.variants = {"full": {"capacity": 1.0}, "routed": {"capacity": capacity}}

    def forward(self, ids, lengths, capacity=None):
        cap = self.capacity if capacity is None else capacity
        x = self.embed(ids)
        for i, (block, router) in enumerate(zip(self.blocks, self.routers)):
            x = block(x) if (i == 0 or cap >= 1.0) else block.forward_routed(x, lengths, cap, router)
        return self.head(self.ln(_last(x, lengths))), {}

    def memory_bytes(self, tokens):
        return {"state": 0, "kv": 2 * tokens * self.d * 4 * (1 + (self.layers - 1) * self.capacity)}


class KnobLooped(nn.Module):
    """h <- LN(Block(h + e)) iterated n times; n random in training."""

    LEVELS = {"fast": 1, "normal": 2, "deep": 4, "ultra": 8}

    def __init__(self, vocab, d=128, heads=4, max_steps=8, random_depth=True, steps=4):
        super().__init__()
        self.embed = nn.Embedding(vocab, d)
        self.block = Block(d, heads, causal=True)
        self.norm, self.ln, self.head = nn.LayerNorm(d), nn.LayerNorm(d), nn.Linear(d, vocab)
        self.d, self.max_steps, self.random_depth, self.steps = d, max_steps, random_depth, steps
        self.variants = {name: {"steps": n} for name, n in self.LEVELS.items()}

    def forward(self, ids, lengths, steps=None):
        if steps is None:
            steps = torch.randint(1, self.max_steps + 1, ()).item() if (self.training and self.random_depth) else self.steps
        e = self.embed(ids)
        h = e
        for _ in range(steps):
            h = self.norm(self.block(h + e))
        return self.head(self.ln(_last(h, lengths))), {"steps": torch.full((ids.shape[0],), float(steps))}

    def memory_bytes(self, tokens):
        return {"state": 0, "kv": 2 * self.steps * tokens * self.d * 4}


class EarlyExit(nn.Module):
    """Answer heads after every layer; loss = mean over heads (deep supervision)."""

    def __init__(self, vocab, d=64, layers=4, heads=4, thresholds=(0.9, 0.8, 0.7)):
        super().__init__()
        self.embed = nn.Embedding(vocab, d)
        self.blocks = nn.ModuleList(Block(d, heads) for _ in range(layers))
        self.lns = nn.ModuleList(nn.LayerNorm(d) for _ in range(layers))
        self.heads_ = nn.ModuleList(nn.Linear(d, vocab) for _ in range(layers))
        self.d, self.layers = d, layers
        self.variants = {"full": {"threshold": 2.0}, **{f"exit{int(100 * t)}": {"threshold": t} for t in thresholds}}

    def forward(self, ids, lengths, threshold=None):
        x = self.embed(ids)
        outs = []
        b = ids.shape[0]
        exit_layer = torch.full((b,), float(self.layers))
        chosen = None
        done = torch.zeros(b, dtype=torch.bool)
        for i, (block, ln, head) in enumerate(zip(self.blocks, self.lns, self.heads_)):
            x = block(x)
            logits = head(ln(_last(x, lengths)))
            outs.append(logits)
            if threshold is not None:
                conf = F.softmax(logits, -1).max(-1).values
                stop = ~done & ((conf >= threshold) | (i == self.layers - 1))
                chosen = logits if chosen is None else torch.where(stop[:, None], logits, chosen)
                exit_layer = torch.where(stop, torch.full_like(exit_layer, i + 1), exit_layer)
                done = done | stop
                if done.all():
                    break
        if threshold is None:
            return outs[-1], {"all_logits": outs}
        return chosen, {"steps": exit_layer, "final": outs[-1] if len(outs) == self.layers else None}

    def extra_loss_logits(self, info, answers):
        return sum(F.cross_entropy(lo, answers) for lo in info["all_logits"][:-1]) / self.layers

    def memory_bytes(self, tokens):
        return {"state": 0, "kv": 2 * self.layers * tokens * self.d * 4}
