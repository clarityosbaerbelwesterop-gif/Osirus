"""R1.03 prototype: Rouge with a two-level memory.

    active state   S  in R^{M x d}   small, updated by the Rouge cell per token (as in R1.01b)
    exact memory   E  in R^{K x d}   K slots; each token writes ONE slot, each think step reads top-k

Write (per token t): content c_t = W_c [u_{t-1}; u_t] (the token and its
predecessor, so a key and its value land together); address = hard top-1
over K slot logits W_a c_t (straight-through softmax gradient); gate
g_t = sigmoid(w_g . c_t); E[slot] <- E[slot] + g_t (c_t - E[slot]).
Content addressing lets the same key overwrite its own slot (a variable
update) instead of consuming a new one.

Read (per think step): query r = W_q (think input + mean(S)); scores E r;
only the top-k slots are read (softmax over those k); the read vector is
added to the think input. Memory stays constant in the input length:
(M + K) x d numbers, against a KV cache that grows with every token.

Prior art: slot memories with content addressing (NTM, Graves et al. 2014;
DNC 2016; Memory Networks), top-k sparse reads, test-time memory (Titans,
arXiv 2501.00663). No novelty claim; R1.03 asks whether this fixes the
recall loss measured in R1.01 at a fraction of the KV cache.
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F

from prototypes.rouge_r101 import Rouge


class RougeMem(Rouge):
    def __init__(self, vocab: int, memory_slots: int = 32, read_k: int = 2, **kwargs):
        super().__init__(vocab, **kwargs)
        d = self.d
        self.content = nn.Linear(2 * d, d)
        self.address = nn.Linear(d, memory_slots)
        self.gate = nn.Linear(d, 1)
        self.query = nn.Linear(d, d)
        self.read_out = nn.Linear(d, d)
        self.memory_slots, self.read_k = memory_slots, read_k

    def write(self, memory, prev, cur, live):
        c = self.content(torch.cat([prev, cur], -1))
        soft = F.softmax(self.address(c), -1)
        hard = F.one_hot(soft.argmax(-1), self.memory_slots).float()
        w = hard + soft - soft.detach()                      # straight-through top-1
        g = torch.sigmoid(self.gate(c)) * live[:, None].float()
        return memory + (g * w)[:, :, None] * (c[:, None, :] - memory)

    def read(self, memory, x):
        r = self.query(x)
        scores = (memory @ r[:, :, None]).squeeze(-1) / self.d ** 0.5
        top, idx = scores.topk(self.read_k, -1)              # only k slots are read
        alpha = F.softmax(top, -1)
        picked = memory.gather(1, idx[:, :, None].expand(-1, -1, self.d))
        return self.read_out((alpha[:, :, None] * picked).sum(1))

    def forward(self, ids: torch.Tensor, lengths: torch.Tensor, max_think: int | None = None, return_state: bool = False):
        b, t = ids.shape
        u = self.embed(ids)
        state = self.init_state.expand(b, -1, -1)
        memory = torch.zeros(b, self.memory_slots, self.d)
        prev = torch.zeros(b, self.d)
        for i in range(t):
            live = i < lengths
            state = torch.where(live[:, None, None], self.step(state, u[:, i]), state)
            memory = self.write(memory, prev, u[:, i], live)
            prev = torch.where(live[:, None], u[:, i], prev)
        read_state = state
        think = self.think_token.expand(b, -1)
        if self.inject:
            think = think + u[torch.arange(b), lengths - 1]
        limit = max_think or self.max_think
        acc, running = torch.zeros(b), torch.ones(b, dtype=torch.bool)
        steps, remainder, mixed = torch.zeros(b), torch.zeros(b), torch.zeros_like(state)
        for n in range(limit if self.halting else self.think_steps):
            x = think + self.read(memory, think + state.mean(1))
            state = self.step(state, x)
            if not self.halting:
                continue
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
        if not self.halting:
            mixed, steps = state, torch.full((b,), float(self.think_steps))
            remainder = torch.zeros(b)
        info = {"ponder": steps + remainder, "steps": steps}
        if return_state:
            info["read_state"] = read_state
        return self.head(self.ln(mixed.mean(1))), info

    def state_bytes(self, tokens: int) -> int:
        """Constant in the input length: active slots plus memory slots (fp32)."""
        return (self.slots + self.memory_slots) * self.d * 4
