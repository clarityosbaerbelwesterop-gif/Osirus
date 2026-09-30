"""Muon for matrix weights, AdamW for the rest, in one optimizer (one lr schedule, one state dict).

Muon (Jordan et al. 2024; "Muon is Scalable for LLM Training", Moonshot 2025) orthogonalises the
momentum of each weight matrix with a quintic Newton-Schulz iteration. With the Moonshot scaling
(update x 0.2 x sqrt(max(rows, cols))) its update RMS matches AdamW's, so both share the learning rate
and weight decay. Reported gain: about 2x compute efficiency over AdamW at equal quality.

Muon groups take matrices (2-D; stacked matrices with more dimensions are orthogonalised per matrix);
embeddings, the output head, MoE routers, norms and biases stay on AdamW. Muon needs whole matrices,
so it runs single-process or with DDP, not with FSDP shards.
"""

from __future__ import annotations

import torch

NS_COEFFS = (3.4445, -4.7750, 2.0315)


def orthogonalize(g: torch.Tensor, steps: int = 5) -> torch.Tensor:
    """Approximate U V^T of g = U S V^T (per matrix over the last two dimensions)."""
    a, b, c = NS_COEFFS
    x = g.to(torch.bfloat16 if g.is_cuda else torch.float32)
    tall = x.size(-2) > x.size(-1)
    if tall:
        x = x.mT
    x = x / (x.norm(dim=(-2, -1), keepdim=True) + 1e-7)
    for _ in range(steps):
        s = x @ x.mT
        x = a * x + (b * s + c * s @ s) @ x
    if tall:
        x = x.mT
    return x.to(g.dtype)


def muon_param(name: str, p: torch.nn.Parameter) -> bool:
    return p.dim() >= 2 and not any(k in name for k in ("embed", "head", "router"))


class MuonAdamW(torch.optim.Optimizer):
    def __init__(self, groups, lr: float, betas=(0.9, 0.95), eps: float = 1e-8, momentum: float = 0.95,
                 ns_steps: int = 5):
        super().__init__(groups, dict(lr=lr, betas=betas, eps=eps, momentum=momentum, ns_steps=ns_steps,
                                      weight_decay=0.0, muon=False))

    @torch.no_grad()
    def step(self, closure=None):
        for group in self.param_groups:
            lr, wd = group["lr"], group["weight_decay"]
            for p in group["params"]:
                if p.grad is None:
                    continue
                g, state = p.grad, self.state[p]
                if wd:
                    p.mul_(1 - lr * wd)
                if group["muon"]:
                    buf = state.setdefault("momentum_buffer", torch.zeros_like(g))
                    buf.mul_(group["momentum"]).add_(g)
                    u = g.add(buf, alpha=group["momentum"])        # Nesterov
                    u = orthogonalize(u, group["ns_steps"]) * (0.2 * max(p.size(-2), p.size(-1)) ** 0.5)
                    p.add_(u, alpha=-lr)
                else:
                    b1, b2 = group["betas"]
                    if "step" not in state:
                        state["step"] = torch.zeros((), dtype=torch.float32)
                        state["exp_avg"] = torch.zeros_like(g)
                        state["exp_avg_sq"] = torch.zeros_like(g)
                    state["step"] += 1
                    t = state["step"].item()
                    state["exp_avg"].mul_(b1).add_(g, alpha=1 - b1)
                    state["exp_avg_sq"].mul_(b2).addcmul_(g, g, value=1 - b2)
                    denom = (state["exp_avg_sq"] / (1 - b2 ** t)).sqrt_().add_(group["eps"])
                    p.addcdiv_(state["exp_avg"], denom, value=-lr / (1 - b1 ** t))
        return None


def build(model, lr: float, weight_decay: float) -> MuonAdamW:
    named = list(model.named_parameters())
    muon = [p for n, p in named if muon_param(n, p)]
    adam_decay = [p for n, p in named if not muon_param(n, p) and p.dim() >= 2]
    adam_plain = [p for n, p in named if p.dim() < 2]
    return MuonAdamW([{"params": muon, "muon": True, "weight_decay": weight_decay},
                      {"params": adam_decay, "weight_decay": weight_decay},
                      {"params": adam_plain, "weight_decay": 0.0}], lr=lr)
