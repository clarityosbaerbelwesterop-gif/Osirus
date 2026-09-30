"""Muon + AdamW optimizer: orthogonalisation, parameter split, learning, exact resume."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

try:
    import torch

    from native import RougeConfig, RougeModel
    from native.optim import build, muon_param, orthogonalize
except ImportError:  # the stdlib-only unit job has no torch
    torch = None

TINY = dict(vocab_size=97, d_model=32, n_layers=2, n_heads=4, n_kv_heads=2, max_seq=64, attention="full")


@unittest.skipIf(torch is None, "torch not installed")
class TestMuon(unittest.TestCase):
    def test_orthogonalize_flattens_the_spectrum(self):
        torch.manual_seed(0)
        g = torch.randn(48, 32) @ torch.diag(torch.logspace(-1, 1, 32))   # condition number about 100
        before = torch.linalg.svdvals(g)
        s = torch.linalg.svdvals(orthogonalize(g))
        self.assertLess(s.max().item(), 1.3)
        self.assertLess((s.max() / s.min()).item(), (before.max() / before.min()).item() / 10)   # far flatter
        stacked = orthogonalize(torch.randn(3, 16, 24))                      # per matrix
        self.assertEqual(stacked.shape, (3, 16, 24))

    def test_embeddings_router_and_norms_stay_on_adamw(self):
        m = RougeModel(RougeConfig(**{**TINY, "moe_experts": 4, "moe_topk": 2}))
        names = {n for n, p in m.named_parameters() if muon_param(n, p)}
        self.assertTrue(names)
        self.assertFalse(any("embed" in n or "router" in n or "norm" in n for n in names))

    def train(self, steps, opt_state=None, model_state=None):
        torch.manual_seed(1)
        m = RougeModel(RougeConfig(**TINY))
        opt = build(m, 3e-3, 0.1)
        if model_state:
            m.load_state_dict(model_state)
            opt.load_state_dict(opt_state)
        data = torch.randint(0, 97, (8, 33), generator=torch.Generator().manual_seed(2))
        losses = []
        for _ in range(steps):
            loss = m(data[:, :-1], data[:, 1:])
            opt.zero_grad()
            loss.backward()
            opt.step()
            losses.append(loss.item())
        return m, opt, losses

    def test_it_learns_and_resumes_exactly(self):
        _, _, straight = self.train(12)
        m, opt, first = self.train(6)
        _, _, rest = self.train(6, opt.state_dict(), m.state_dict())
        self.assertEqual(first + rest, straight)
        self.assertLess(straight[-1], straight[0] - 0.3)   # measured in CI: 4.58 -> 4.02 in 12 steps


if __name__ == "__main__":
    unittest.main()
