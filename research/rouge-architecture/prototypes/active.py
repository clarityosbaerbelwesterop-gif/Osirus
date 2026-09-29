"""R1.36: active test selection inside the model.

The model reads the candidate table, then chooses k attribute queries one
at a time; each query returns the target's value for that attribute (from
the `oracle` tensor, which the model can only read through its chosen
queries). After k queries it answers.

policy:
- "learned": the next query is chosen by a learned head from the table
  encoding and the answers so far (straight-through Gumbel-softmax);
- "random":  queries drawn uniformly without repetition (ablation);
- "eig":     exact expected-information-gain choice over the candidates
             still consistent with the answers (a hand-computed reference
             policy, not a learned model: the upper bound to compare with).
The answer head is learned in every case.
"""

from __future__ import annotations

import math

import torch
import torch.nn as nn
import torch.nn.functional as F

from benchmarks import clues
from prototypes.transformer_baseline import Block


class ActiveSelector(nn.Module):
    uses_oracle = True

    def __init__(self, vocab, d=64, layers=2, heads=4, queries=2, policy="learned", tau=1.0):
        super().__init__()
        self.embed = nn.Embedding(vocab, d)
        self.blocks = nn.ModuleList(Block(d, heads, causal=False) for _ in range(layers))
        self.q_head = nn.Linear(2 * d, clues.A)
        self.ans_embed = nn.Embedding(clues.A * 2, d)
        self.cand = nn.Linear(d, d)
        self.d, self.queries, self.policy, self.tau = d, queries, policy, tau
        # each policy is trained as its own model (the answer head must match its query distribution)

    def _eig_choice(self, ids, asked, answers_so_far):
        out = []
        for b in range(ids.shape[0]):
            rows = [row for _, row in clues.table(ids[b].tolist())]
            alive = [r for r in rows if all(r[a] == v for a, v in answers_so_far[b])]
            best, best_h = 0, -1.0
            for a in range(clues.A):
                if asked[b, a]:
                    continue
                ones = sum(r[a] for r in alive) / max(1, len(alive))
                h = 0.0 if ones in (0.0, 1.0) else -(ones * math.log(ones) + (1 - ones) * math.log(1 - ones))
                if h > best_h:
                    best, best_h = a, h
            out.append(best)
        return torch.tensor(out)

    def forward(self, ids, lengths, oracle=None, policy=None):
        policy = policy or self.policy
        b = ids.shape[0]
        x = self.embed(ids)
        for block in self.blocks:
            x = block(x)
        rows = x[:, 1:1 + clues.N * (clues.A + 2):clues.A + 2]      # the candidate-name positions, (B, N, d)
        summary = x.mean(1)
        evidence = torch.zeros(b, self.d)
        asked = torch.zeros(b, clues.A, dtype=torch.bool)
        answers_so_far = [[] for _ in range(b)]
        for _ in range(self.queries):
            logits = self.q_head(torch.cat([summary, evidence], -1)).masked_fill(asked, -1e9)
            if policy == "learned":
                onehot = F.gumbel_softmax(logits, tau=self.tau, hard=True) if self.training else F.one_hot(logits.argmax(-1), clues.A).float()
            elif policy == "random":
                onehot = F.one_hot(torch.multinomial((~asked).float(), 1).squeeze(-1), clues.A).float()
            else:
                onehot = F.one_hot(self._eig_choice(ids, asked, answers_so_far), clues.A).float()
            a = onehot.argmax(-1)
            value = (oracle * onehot).sum(-1)                         # the answer to the chosen question only
            # evidence = embedding of (chosen attribute, its value); the one-hot selects it, so in the
            # forward pass unchosen attributes contribute nothing (straight-through gradient in training)
            every = self.ans_embed(torch.arange(clues.A)[None, :] * 2 + oracle.long())   # (B, A, d)
            evidence = evidence + (onehot[:, :, None] * every).sum(1)
            asked = asked | onehot.bool()
            for i in range(b):
                answers_so_far[i].append((int(a[i]), int(value[i])))
        scores = (self.cand(rows) * (summary + evidence)[:, None, :]).sum(-1)   # (B, N)
        names = ids[:, 1:1 + clues.N * (clues.A + 2):clues.A + 2]               # token ids of the candidates
        logits = torch.full((b, self.embed.num_embeddings), -1e9).scatter(1, names, scores)
        return logits, {"steps": torch.full((b,), float(self.queries))}

    def memory_bytes(self, tokens):
        return {"state": 0, "kv": 2 * len(self.blocks) * tokens * self.d * 4}
