"""Router statistics for sparse models (R1.04, R1.19), benchmark-agnostic."""

from __future__ import annotations

import math

import torch


def _nmi(joint):
    joint = joint / joint.sum()
    pt, pe = joint.sum(1, keepdim=True), joint.sum(0, keepdim=True)
    mi = float((joint * (joint.clamp_min(1e-12) / (pt @ pe).clamp_min(1e-12)).log()).sum())
    ht = float(-(pt * pt.clamp_min(1e-12).log()).sum())
    return mi, ht


@torch.no_grad()
def routing(model, examples, tasks, collate) -> dict:
    """Load, entropy, task-expert NMI and token-conditioned NMI, averaged over layers."""
    if not hasattr(model, "blocks") or not hasattr(model.blocks[0], "moe"):
        return {}
    model.eval()
    ids, lengths, _ = collate(examples)
    model(ids, lengths)
    real = (torch.arange(ids.shape[1])[None, :] < lengths[:, None]).flatten()
    task = torch.tensor([tasks.index(e[2]) for e in examples])[:, None].expand(ids.shape).flatten()[real]
    tokens = ids.flatten()[real]
    out = []
    for block in model.blocks:
        probs, chosen = block.moe.last["probs"][real], block.moe.last["chosen"][real, 0]
        e = probs.shape[-1]
        load = torch.bincount(chosen, minlength=e).float() / len(chosen)
        joint = torch.zeros(len(tasks), e)
        joint.index_put_((task, chosen), torch.ones(len(chosen)), accumulate=True)
        mi, ht = _nmi(joint)
        cmi, ch = 0.0, 0.0
        for tok in tokens.unique():
            sel = tokens == tok
            j = torch.zeros(len(tasks), e)
            j.index_put_((task[sel], chosen[sel]), torch.ones(int(sel.sum())), accumulate=True)
            m_, h_ = _nmi(j)
            w = float(sel.sum()) / len(tokens)
            cmi, ch = cmi + w * m_, ch + w * h_
        out.append({"min_load": float(load.min()), "token_entropy": float(-(probs * probs.clamp_min(1e-9).log()).sum(-1).mean() / math.log(e)),
                    "task_expert_nmi": mi / ht if ht else 0.0, "nmi_given_token": cmi / ch if ch else 0.0})
    model.train()
    return {k: sum(x[k] for x in out) / len(out) if k != "min_load" else min(x[k] for x in out) for k in out[0]}
