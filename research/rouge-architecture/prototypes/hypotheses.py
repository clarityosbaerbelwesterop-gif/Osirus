"""R1.35 / R1.37 / R1.38: multiple hypotheses, a self-verification head,
and selection among hypotheses (a minimal latent search).

HypVerify = the R1.01 Transformer encoder with
- H hypothesis heads, each proposing an answer, trained with multiple-choice
  learning (the best head gets the loss; Guzman-Rivera et al. 2012,
  Lee et al. 2016 arXiv 1606.07839), plus a score head that learns which
  hypothesis to trust;
- a verifier head that predicts whether a proposed answer is correct from
  the (detached) representation and the candidate, trained on external
  correctness labels only (never on the generator's own confidence).

Inference settings (`variants`):
- own:      the hypothesis with the highest learned score;
- verifier: the hypothesis the verifier rates most likely correct
            (selection among H candidates under a fixed compute budget);
- single:   hypothesis 0 only (the single-trajectory ablation).
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F

from prototypes.transformer_baseline import Block


class HypVerify(nn.Module):
    def __init__(self, vocab, d=64, layers=4, heads=4, hypotheses=4, eps=0.05):
        super().__init__()
        self.embed = nn.Embedding(vocab, d)
        self.blocks = nn.ModuleList(Block(d, heads) for _ in range(layers))
        self.ln = nn.LayerNorm(d)
        self.hyp = nn.Linear(d, hypotheses * vocab)
        self.score = nn.Linear(d, hypotheses)
        self.cand = nn.Embedding(vocab, d)
        self.verifier = nn.Sequential(nn.Linear(2 * d, d), nn.GELU(), nn.Linear(d, 1))
        self.d, self.layers, self.h, self.v, self.eps = d, layers, hypotheses, vocab, eps
        self.variants = {"own": {"pick": "own"}, "verifier": {"pick": "verifier"}, "single": {"pick": "single"}}

    def forward(self, ids, lengths, pick="own"):
        x = self.embed(ids)
        for block in self.blocks:
            x = block(x)
        z = self.ln(x[torch.arange(ids.shape[0]), lengths - 1])
        logits = self.hyp(z).view(-1, self.h, self.v)                         # (B, H, V)
        scores = self.score(z)                                                # (B, H)
        cand = logits.argmax(-1)                                              # (B, H)
        ver_in = torch.cat([z.detach()[:, None, :].expand(-1, self.h, -1), self.cand(cand)], -1)
        ver = self.verifier(ver_in).squeeze(-1)                               # (B, H) logits of P(correct)
        if pick == "single":
            idx = torch.zeros(ids.shape[0], dtype=torch.long)
        elif pick == "verifier":
            idx = ver.argmax(-1)
        else:
            idx = scores.argmax(-1)
        chosen = logits[torch.arange(ids.shape[0]), idx]
        info = {"all_logits": logits, "scores": scores, "ver": ver, "cand": cand,
                "verifier_prob": torch.sigmoid(ver[torch.arange(ids.shape[0]), idx])}
        return chosen, info

    def extra_loss_logits(self, info, answers):
        logits, scores, ver, cand = info["all_logits"], info["scores"], info["ver"], info["cand"]
        ce = F.cross_entropy(logits.flatten(0, 1), answers.repeat_interleave(self.h), reduction="none").view(-1, self.h)
        best = ce.argmin(-1)
        mcl = ((1 - self.eps) * ce.min(-1).values + self.eps * ce.mean(-1)).mean()
        score_loss = F.cross_entropy(scores, best)
        ver_loss = F.binary_cross_entropy_with_logits(ver, (cand == answers[:, None]).float())
        return mcl + score_loss + ver_loss

    def memory_bytes(self, tokens):
        return {"state": 0, "kv": 2 * self.layers * tokens * self.d * 4}
