"""Rouge R1.01 prototype: persistent latent state + adaptive recurrent compute.

    tokens --embed--> u_t
    read:   S_t = N(S_{t-1} + Cell([S_{t-1}; u_t]))        one step per token
    think:  S^(n+1) = N(S^(n) + Cell([S^(n); think]))       n = 1..N, N learned
    halt:   p_n = sigmoid(w . mean(S^(n)) + b); stop when sum p >= 1 - eps (ACT)
    answer: logits = W_out LN(mean_slots(sum_n w_n S^(n)))

S is a fixed-size set of M latent slots (the persistent state: memory does
not grow with the input). Cell is ONE shared pre-LN attention+MLP block
over the M slots plus the current input vector, used both to read and to
think, so capacity is not bought with depth-specific weights. Halting is
Adaptive Computation Time (Graves, 2016) with ponder cost tau * (N + R);
thinking happens once, after the query token, before the answer.

Fixed-iteration ablation: halting=False runs exactly `think_steps`
iterations, isolating the effect of *adaptive* compute from recurrence.
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


class Cell(nn.Module):
    def __init__(self, d: int, heads: int):
        super().__init__()
        self.heads = heads
        self.ln1, self.ln2 = nn.LayerNorm(d), nn.LayerNorm(d)
        self.qkv, self.out = nn.Linear(d, 3 * d), nn.Linear(d, d)
        self.mlp = nn.Sequential(nn.Linear(d, 4 * d), nn.GELU(), nn.Linear(4 * d, d))

    def forward(self, state: torch.Tensor, inp: torch.Tensor) -> torch.Tensor:
        z = torch.cat([state, inp[:, None, :]], dim=1)  # (B, M+1, d)
        b, t, d = z.shape
        q, k, v = self.qkv(self.ln1(z)).view(b, t, 3, self.heads, d // self.heads).permute(2, 0, 3, 1, 4)
        y = F.scaled_dot_product_attention(q, k, v)  # slots are a set: no mask, no positions
        z = z + self.out(y.transpose(1, 2).reshape(b, t, d))
        z = z + self.mlp(self.ln2(z))
        return z[:, :-1] - state  # the update to the slots


class Rouge(nn.Module):
    def __init__(self, vocab: int, d: int = 128, slots: int = 8, heads: int = 4, max_think: int = 8,
                 halting: bool = True, think_steps: int = 4, tau: float = 0.01):
        super().__init__()
        self.embed = nn.Embedding(vocab, d)
        self.init_state = nn.Parameter(torch.randn(slots, d) * 0.02)
        self.think_token = nn.Parameter(torch.zeros(d))
        self.cell = Cell(d, heads)
        self.norm = nn.LayerNorm(d)  # keeps the persistent state bounded
        self.halt = nn.Linear(d, 1)
        nn.init.constant_(self.halt.bias, -1.0)  # start by thinking a few steps
        self.ln = nn.LayerNorm(d)
        self.head = nn.Linear(d, vocab)
        self.d, self.slots = d, slots
        self.max_think, self.halting, self.think_steps, self.tau = max_think, halting, think_steps, tau

    def step(self, state: torch.Tensor, inp: torch.Tensor) -> torch.Tensor:
        return self.norm(state + self.cell(state, inp))

    def forward(self, ids: torch.Tensor, lengths: torch.Tensor, max_think: int | None = None) -> tuple[torch.Tensor, dict]:
        b, t = ids.shape
        u = self.embed(ids)
        state = self.init_state.expand(b, -1, -1)
        for i in range(t):  # read: the state persists, pads do not change it
            live = (i < lengths)[:, None, None]
            state = torch.where(live, self.step(state, u[:, i]), state)
        think = self.think_token.expand(b, -1)
        if not self.halting:
            for _ in range(self.think_steps):
                state = self.step(state, think)
            pooled = state.mean(1)
            return self.head(self.ln(pooled)), {"ponder": torch.full((b,), float(self.think_steps))}
        limit = max_think or self.max_think
        acc = torch.zeros(b)
        running = torch.ones(b, dtype=torch.bool)
        steps = torch.zeros(b)
        remainder = torch.zeros(b)
        mixed = torch.zeros_like(state)
        for n in range(limit):
            state = self.step(state, think)
            p = torch.sigmoid(self.halt(state.mean(1))).squeeze(-1)
            if n == limit - 1:
                p = torch.ones_like(p)
            stop = running & (acc + p >= 0.99)
            weight = torch.where(stop, 1 - acc, torch.where(running, p, torch.zeros_like(p)))
            mixed = mixed + weight[:, None, None] * state
            steps = steps + running.float()
            remainder = torch.where(stop, 1 - acc, remainder)
            acc = torch.where(running, acc + p, acc)
            running = running & ~stop
        ponder = steps + remainder
        return self.head(self.ln(mixed.mean(1))), {"ponder": ponder, "steps": steps}

    def extra_loss(self, info: dict) -> torch.Tensor:
        return self.tau * info["ponder"].mean() if self.halting else torch.zeros(())

    def state_bytes(self, tokens: int) -> int:
        """Inference memory that grows with the input: none -- M slots (fp32)."""
        return self.slots * self.d * 4
