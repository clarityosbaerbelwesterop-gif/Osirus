"""R1.02 prototype: one shared block iterated over the input, with learned
halting (the adaptive-recurrence half of Rouge, tested on its own).

    e = embed(tokens)
    h_0 = e;  h_{n+1} = LN(Block(h_n + e))           input injection each step
    halting from the query position q: lambda_n = sigmoid(w . h_n[q] + b)
    answer: head(LN(h_n[q]))

Halting modes (all prior art; the question is which one learns to spend
compute where the task needs it):
- "fixed":  exactly `think_steps` iterations (the fixed-depth ablation).
- "act":    Adaptive Computation Time (Graves 2016): stop when the summed
            halting probabilities reach 1 - eps; the output mixes the
            per-step states; loss + tau * (N + R). `floor` forbids halting
            before that many steps (the runner decays it during warm-up) and
            `tau` can be warmed up from 0 (delayed compute penalty).
- "ponder": PonderNet (Banino et al. 2021): p_n = lambda_n prod_{j<n}(1 -
            lambda_j); loss = sum_n p_n CE(y_n) + beta KL(p || Geometric(
            lambda_p)). Every step's prediction is trained, so there is no
            first-step shortcut. At test the model stops at the first step
            where the halting distribution's cumulative mass reaches 0.5
            (deterministic median).

Attention is bidirectional (an encoder over the whole input; the answer is
read at the last position), and so are the R1.02 Transformer baselines.
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F

from prototypes.transformer_baseline import Block


class Looped(nn.Module):
    def __init__(self, vocab: int, d: int = 96, heads: int = 4, halting: str = "ponder", max_think: int = 12,
                 think_steps: int = 8, tau: float = 0.01, floor: int = 0, lambda_p: float = 0.2, beta: float = 0.01):
        super().__init__()
        self.embed = nn.Embedding(vocab, d)
        self.block = Block(d, heads, causal=False)
        self.norm = nn.LayerNorm(d)
        self.halt = nn.Linear(d, 1)
        nn.init.constant_(self.halt.bias, -2.0)  # starts by thinking several steps
        self.ln = nn.LayerNorm(d)
        self.head = nn.Linear(d, vocab)
        self.d, self.mode, self.max_think, self.think_steps = d, halting, max_think, think_steps
        self.halting = halting != "fixed"
        self.tau = self.tau_base = tau
        self.floor = self.floor_base = floor
        self.lambda_p, self.beta = lambda_p, beta

    def steps_iter(self, ids: torch.Tensor, n: int):
        e = self.embed(ids)
        h = e
        for _ in range(n):
            h = self.norm(self.block(h + e))
            q = h[:, -1]
            yield q, torch.sigmoid(self.halt(q)).squeeze(-1)

    def forward(self, ids: torch.Tensor, lengths: torch.Tensor | None = None, max_think: int | None = None):
        b = ids.shape[0]
        if self.mode == "fixed":
            n = max_think or self.think_steps
            for q, _ in self.steps_iter(ids, n):
                pass
            return self.head(self.ln(q)), {"steps": torch.full((b,), float(n)), "ponder": torch.full((b,), float(n))}
        limit = max_think or self.max_think
        if self.mode == "act":
            return self._act(ids, limit)
        return self._ponder(ids, limit)

    def _act(self, ids, limit):
        b = ids.shape[0]
        acc, running = torch.zeros(b), torch.ones(b, dtype=torch.bool)
        steps, remainder, mixed = torch.zeros(b), torch.zeros(b), 0
        for n, (q, p) in enumerate(self.steps_iter(ids, limit)):
            if n + 1 < self.floor:
                p = torch.zeros_like(p)
            if n == limit - 1:
                p = torch.ones_like(p)
            stop = running & (acc + p >= 0.99)
            weight = torch.where(stop, 1 - acc, torch.where(running, p, torch.zeros_like(p)))
            mixed = mixed + weight[:, None] * q
            steps = steps + running.float()
            remainder = torch.where(stop, 1 - acc, remainder)
            acc = torch.where(running, acc + p, acc)
            running = running & ~stop
            if not running.any():
                break
        return self.head(self.ln(mixed)), {"ponder": steps + remainder, "steps": steps}

    def _ponder(self, ids, limit):
        b = ids.shape[0]
        survive, logits, probs = torch.ones(b), [], []
        for n, (q, lam) in enumerate(self.steps_iter(ids, limit)):
            if n == limit - 1:
                lam = torch.ones_like(lam)
            probs.append(survive * lam)
            survive = survive * (1 - lam)
            logits.append(self.head(self.ln(q)))
        p = torch.stack(probs, 1)                 # (B, N): halting distribution
        y = torch.stack(logits, 1)                # (B, N, V)
        stop = (p.cumsum(1) >= 0.5).float().argmax(1)  # deterministic median step
        chosen = y[torch.arange(b), stop]
        return chosen, {"p": p, "all_logits": y, "steps": stop.float() + 1, "ponder": (p * torch.arange(1, p.shape[1] + 1)).sum(1)}

    def loss(self, logits, info, answers):
        if self.mode == "ponder":
            p, y = info["p"], info["all_logits"]
            ce = F.cross_entropy(y.flatten(0, 1), answers.repeat_interleave(y.shape[1]), reduction="none").view_as(p)
            n = torch.arange(p.shape[1], dtype=torch.float32)
            prior = self.lambda_p * (1 - self.lambda_p) ** n
            prior = prior / prior.sum()
            kl = (p * (torch.log(p.clamp_min(1e-9)) - torch.log(prior))).sum(1)
            return (p * ce).sum(1).mean() + self.beta * kl.mean()
        loss = F.cross_entropy(logits, answers)
        if self.mode == "act":
            loss = loss + self.tau * info["ponder"].mean()
        return loss

    def state_bytes(self, tokens: int) -> int:
        """Inference memory that grows with the input: one layer's activations and K/V, reused every step (fp32)."""
        return 3 * tokens * self.d * 4

