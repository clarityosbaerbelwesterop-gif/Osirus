"""R1.04 prototype: sparse conditional circuits (a router picks K of E MLP
modules per token) inside the R1.01 Transformer baseline.

This is a Mixture-of-Experts MLP (Shazeer et al. 2017; Switch Transformer,
Fedus et al. 2021) — prior art, no novelty claim. R1.04 asks whether
conditional execution buys accuracy per *active* FLOP on the Rouge
micro-benchmark, and whether the router specialises by task.

Dispatch is genuinely sparse: each expert runs only on the tokens routed to
it (gather, compute, scatter-add), so measured FLOPs are the active FLOPs.
Load balance: the Switch auxiliary loss E * sum_i f_i P_i.
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F

from prototypes.transformer_baseline import rope


class MoE(nn.Module):
    def __init__(self, d: int, experts: int, hidden: int, top_k: int, router_input: str = "token"):
        super().__init__()
        # R1.19: "context" routes on the token plus the causal mean of the sequence so far
        # (a task representation), so the circuit can depend on what the input is about.
        self.router_input = router_input
        self.router = nn.Linear(2 * d if router_input == "context" else d, experts, bias=False)
        self.w1 = nn.Parameter(torch.randn(experts, d, hidden) * d ** -0.5)
        self.b1 = nn.Parameter(torch.zeros(experts, hidden))
        self.w2 = nn.Parameter(torch.randn(experts, hidden, d) * hidden ** -0.5)
        self.b2 = nn.Parameter(torch.zeros(experts, d))
        self.experts, self.top_k = experts, top_k
        self.last = {}

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        shape = x.shape
        flat = x.reshape(-1, shape[-1])
        if self.router_input == "context":
            ctx = x.cumsum(1) / torch.arange(1, x.shape[1] + 1)[None, :, None]   # causal mean of the sequence so far
            feats = torch.cat([x, ctx], -1).reshape(-1, 2 * shape[-1])
        else:
            feats = flat
        probs = F.softmax(self.router(feats), dim=-1)                 # (N, E)
        weight, chosen = probs.topk(self.top_k, dim=-1)               # (N, K)
        weight = weight / weight.sum(-1, keepdim=True)
        out = torch.zeros_like(flat)
        for e in range(self.experts):
            rows, slot = (chosen == e).nonzero(as_tuple=True)
            if rows.numel() == 0:
                continue
            h = F.gelu(flat[rows] @ self.w1[e] + self.b1[e]) @ self.w2[e] + self.b2[e]
            out.index_add_(0, rows, h * weight[rows, slot, None])
        load = F.one_hot(chosen[:, 0], self.experts).float().mean(0)  # f_i: share of first choices
        self.last = {"probs": probs, "chosen": chosen, "aux": self.experts * (load * probs.mean(0)).sum()}
        return out.view(shape)


class SparseBlock(nn.Module):
    def __init__(self, d: int, heads: int, experts: int, hidden: int, top_k: int, router_input: str = "token"):
        super().__init__()
        self.heads = heads
        self.ln1, self.ln2 = nn.LayerNorm(d), nn.LayerNorm(d)
        self.qkv, self.out = nn.Linear(d, 3 * d), nn.Linear(d, d)
        self.moe = MoE(d, experts, hidden, top_k, router_input)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        b, t, d = x.shape
        q, k, v = self.qkv(self.ln1(x)).view(b, t, 3, self.heads, d // self.heads).permute(2, 0, 3, 1, 4)
        y = F.scaled_dot_product_attention(rope(q), rope(k), v, is_causal=True)
        x = x + self.out(y.transpose(1, 2).reshape(b, t, d))
        return x + self.moe(self.ln2(x))


class SparseTransformer(nn.Module):
    def __init__(self, vocab: int, d: int = 64, layers: int = 4, heads: int = 4, experts: int = 8,
                 hidden: int = 128, top_k: int = 2, balance: float = 0.01, router_input: str = "token"):
        super().__init__()
        self.embed = nn.Embedding(vocab, d)
        self.blocks = nn.ModuleList(SparseBlock(d, heads, experts, hidden, top_k, router_input) for _ in range(layers))
        self.ln = nn.LayerNorm(d)
        self.head = nn.Linear(d, vocab)
        self.d, self.layers, self.balance = d, layers, balance
        self.experts, self.hidden, self.top_k = experts, hidden, top_k

    def forward(self, ids: torch.Tensor, lengths: torch.Tensor) -> tuple[torch.Tensor, dict]:
        x = self.embed(ids)
        for block in self.blocks:
            x = block(x)
        last = x[torch.arange(ids.shape[0]), lengths - 1]
        aux = sum(block.moe.last["aux"] for block in self.blocks) / self.layers
        return self.head(self.ln(last)), {"aux": aux}

    def extra_loss(self, info: dict) -> torch.Tensor:
        return self.balance * info["aux"]

    def active_parameters(self) -> int:
        """Parameters used per token: everything except the unchosen experts."""
        total = sum(p.numel() for p in self.parameters())
        per_expert = self.d * self.hidden + self.hidden + self.hidden * self.d + self.d
        return total - self.layers * (self.experts - self.top_k) * per_expert

    def state_bytes(self, tokens: int) -> int:
        return 2 * self.layers * tokens * self.d * 4
