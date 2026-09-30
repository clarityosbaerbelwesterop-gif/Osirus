"""Rouge native model (Architecture v1 candidates): correctness tests."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

try:
    import torch

    from native import RougeConfig, RougeModel
    from native.layers import MonarchLinear, pack_ternary, quantize_ternary, unpack_ternary
except ImportError:  # the stdlib-only unit job has no torch
    torch = None

TINY = dict(vocab_size=97, d_model=32, n_layers=4, n_heads=4, n_kv_heads=2, max_seq=64, window=8, global_every=2)
CANDIDATES = {
    "A": dict(attention="full"),
    "B": dict(attention="hybrid"),
    "C": dict(attention="hybrid", lowbit="ternary"),
    "D": dict(attention="hybrid", lowbit="ternary", moe_experts=4, moe_topk=2),
    "E": dict(attention="hybrid", lowbit="ternary", moe_experts=4, moe_topk=2, structured="monarch", structured_blocks=4),
}


def model(**kw):
    torch.manual_seed(0)
    return RougeModel(RougeConfig(**{**TINY, **kw}))


@unittest.skipIf(torch is None, "torch not installed")
class TestNativeModel(unittest.TestCase):
    def test_candidates_train_step(self):
        for name, kw in CANDIDATES.items():
            m = model(**kw)
            x = torch.randint(0, 97, (2, 33))
            loss = m(x[:, :-1], x[:, 1:])
            self.assertTrue(torch.isfinite(loss), name)
            self.assertAlmostEqual(loss.item(), 4.57, delta=0.6, msg=name)          # ~ln(97) at init
            loss.backward()
            self.assertTrue(all(p.grad is not None for p in m.parameters() if p.requires_grad), name)

    def test_causal(self):
        for name, kw in CANDIDATES.items():
            m = model(**kw).eval()
            x = torch.randint(0, 97, (1, 40))
            y = x.clone()
            y[0, 30] = (y[0, 30] + 1) % 97
            with torch.no_grad():
                a, _ = m(x)
                b, _ = m(y)
            self.assertLess((a[0, :30] - b[0, :30]).abs().max().item(), 1e-5, name)
            self.assertGreater((a[0, 30:] - b[0, 30:]).abs().max().item(), 0, name)

    def test_cache_equals_full_forward(self):
        for name, kw in CANDIDATES.items():
            m = model(**kw).eval()
            x = torch.randint(0, 97, (2, 40))
            with torch.no_grad():
                full, _ = m(x)
                cache, parts, start = m.init_cache(), [], 0
                for size in (13, 1, 1, 25):
                    out, cache = m(x[:, start:start + size], cache=cache, start=start)
                    parts.append(out)
                    start += size
            self.assertLess((full - torch.cat(parts, 1)).abs().max().item(), 1e-4, name)

    def test_local_layers_have_a_bounded_receptive_field(self):
        m = model(attention="hybrid", global_every=99, n_layers=2, window=4).eval()   # every layer local
        x = torch.randint(0, 97, (1, 20))
        y = x.clone()
        y[0, 0] = (y[0, 0] + 1) % 97
        with torch.no_grad():
            a, _ = m(x)
            b, _ = m(y)
        self.assertGreater((a[0, :7] - b[0, :7]).abs().max().item(), 0)            # 2 layers x (4 - 1) = 6 back
        self.assertLess((a[0, 7:] - b[0, 7:]).abs().max().item(), 1e-5)
        self.assertLess(m.kv_bytes(4096), model(attention="full").kv_bytes(4096))

    def test_ternary_pack_roundtrip_and_bytes(self):
        w = torch.randn(33, 17)
        q, _ = quantize_ternary(w)
        self.assertTrue(torch.equal(unpack_ternary(pack_ternary(q), q.numel()).view_as(q).to(q.dtype), q))
        self.assertLess(model(**CANDIDATES["C"]).stored_bytes(), 0.8 * model(**CANDIDATES["B"]).stored_bytes())

    def test_monarch_is_a_linear_map(self):
        torch.manual_seed(1)
        lin = MonarchLinear(16, 24, blocks=4)
        dense = lin(torch.eye(16))                                                   # rows = images of basis vectors
        x = torch.randn(5, 16)
        self.assertLess((lin(x) - x @ dense).abs().max().item(), 1e-5)
        self.assertLess(sum(p.numel() for p in lin.parameters()), 16 * 24)

    def test_moe_bias_balances_load(self):
        """All tokens prefer expert 0; the selection bias must spread the load (no auxiliary loss)."""
        from native.model import MoE

        torch.manual_seed(0)
        cfg = RougeConfig(**{**TINY, "moe_experts": 4, "moe_topk": 1, "moe_bias_rate": 0.01})
        moe = MoE(cfg).train()
        u = torch.nn.functional.normalize(torch.randn(cfg.d_model), dim=0)
        x = torch.randn(256, cfg.d_model) + 2 * u
        with torch.no_grad():
            moe.router.weight.normal_(0, 0.3)
            moe.router.weight[0] = 3 * u
            moe(x)
            first = moe.load.clone()
            loads = []
            for step in range(300):
                moe(x)
                if step >= 250:
                    loads.append(moe.load.clone())
        late = torch.stack(loads).mean(0)
        self.assertGreater(first[0].item(), 0.8)                                      # expert 0 takes most tokens at first
        self.assertLess((late - 0.25).abs().max().item(), 0.1)                        # balanced after the bias adapts
        self.assertGreater(late.min().item(), 0.1)                                    # no dead expert
        m = model(**CANDIDATES["D"])
        self.assertLess(m.active_params(), m.num_params())

    def test_architecture_sha_ignores_name(self):
        a, b = RougeConfig(**TINY), RougeConfig(**{**TINY, "name": "other"})
        self.assertEqual(a.architecture_sha, b.architecture_sha)
        self.assertNotEqual(a.architecture_sha, RougeConfig(**{**TINY, "window": 16}).architecture_sha)


if __name__ == "__main__":
    unittest.main()
