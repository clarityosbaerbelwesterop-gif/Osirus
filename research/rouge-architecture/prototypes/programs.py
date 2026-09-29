"""R1.33 / R1.34: latent program execution.

ExecLooped runs one shared causal block once per program step (the number
of steps is the example's level: "oracle depth"). After every step a hint
head reads the answer position; with `hint_weight` > 0 it is trained to
output the program's state after that step (execution supervision,
CLRS-style hints, arXiv 2205.15659). With `hint_weight` = 0 the model must
discover a step-by-step decomposition by itself (R1.33: latent program
state without supervision of its steps).

The question is whether aligning latent iterations with program steps
makes execution generalise to more steps than seen in training.
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F

from prototypes.transformer_baseline import Block


class ExecLooped(nn.Module):
    uses_levels = True

    def __init__(self, vocab, d=128, heads=4, hint_weight=1.0, fixed_steps=0):
        super().__init__()
        self.embed = nn.Embedding(vocab, d)
        self.block = Block(d, heads, causal=True)
        self.norm, self.ln, self.head = nn.LayerNorm(d), nn.LayerNorm(d), nn.Linear(d, vocab)
        self.d, self.hint_weight, self.fixed_steps = d, hint_weight, fixed_steps

    def forward(self, ids, lengths, levels=None):
        b = ids.shape[0]
        steps = torch.full((b,), self.fixed_steps) if self.fixed_steps else levels
        e = self.embed(ids)
        h = e
        last = torch.arange(b), lengths - 1
        step_logits = []
        for i in range(int(steps.max())):
            new = self.norm(self.block(h + e))
            h = torch.where((i < steps)[:, None, None], new, h)        # an example stops at its own step count
            step_logits.append(self.head(self.ln(h[last])))
        return step_logits[-1] if step_logits else self.head(self.ln(h[last])), {"step_logits": step_logits, "steps": steps.float()}

    def hint_loss(self, info, hints):
        """Mean cross-entropy between the answer read after step j and the program state after step j."""
        losses = []
        for j, logits in enumerate(info["step_logits"]):
            rows = [i for i, h in enumerate(hints) if j < len(h)]
            if rows:
                target = torch.tensor([hints[i][j] for i in rows])
                losses.append(F.cross_entropy(logits[rows], target))
        return sum(losses) / len(losses)

    def memory_bytes(self, tokens):
        return {"state": 0, "kv": 2 * tokens * self.d * 4}
