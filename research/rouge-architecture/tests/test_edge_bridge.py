"""Export integrity and output parity for native ternary C/D models."""

import sys
import tempfile
import unittest
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "training/rouge"))
from native import packed
from native.config import RougeConfig
from native.model import RougeModel


class ExportTests(unittest.TestCase):
    def test_dense_and_sparse_roundtrip(self):
        torch.set_num_threads(2)
        for experts in (0, 4):
            with self.subTest(experts=experts), tempfile.TemporaryDirectory() as tmp:
                torch.manual_seed(11)
                cfg = RougeConfig(vocab_size=256, d_model=32, n_layers=2, n_heads=2, n_kv_heads=2,
                                  lowbit="ternary", moe_experts=experts, ffn_hidden=128, moe_expert_hidden=32)
                model = RougeModel(cfg).eval()
                x = torch.randint(0, 256, (1, 32))
                path = Path(tmp) / "model.pt"
                packed.save(model, path)
                restored = packed.load(path)
                with torch.no_grad():
                    self.assertTrue(torch.allclose(model(x)[0], restored(x)[0], atol=1e-5, rtol=1e-5))
                self.assertEqual(restored.cfg.architecture_sha, cfg.architecture_sha)
                self.assertTrue(any(isinstance(m, packed.PackedLinear) for m in restored.modules()))
                self.assertFalse(any(k.endswith('.ffn.gate.weight') for k in restored.state_dict()))

    def test_invalid_format_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.pt"
            torch.save({"format": "unknown"}, path)
            with self.assertRaisesRegex(ValueError, "unknown"):
                packed.load(path)

    def test_structured_or_full_precision_is_rejected(self):
        cfg = RougeConfig(vocab_size=256, d_model=32, n_layers=1, n_heads=2, n_kv_heads=2)
        with tempfile.TemporaryDirectory() as tmp, self.assertRaisesRegex(ValueError, "C/D"):
            packed.save(RougeModel(cfg), Path(tmp) / "bad.pt")
