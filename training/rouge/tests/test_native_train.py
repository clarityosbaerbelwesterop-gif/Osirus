"""Native trainer, data pipeline and spec calculator (CPU, synthetic data, < 1 min)."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    import numpy  # noqa: F401
    import tokenizers  # noqa: F401
    import torch

    from native import RougeConfig, RougeModel, spec
except ImportError:
    torch = None


def run(*args, check=True):
    return subprocess.run([sys.executable, "-m", *args], cwd=ROOT, capture_output=True, text=True, check=check)


@unittest.skipIf(torch is None, "torch/tokenizers not installed")
class TestNativeTraining(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        run("native.data.build", "--out", str(cls.tmp / "data"), "--tokens", "4e5", "--vocab", "1024",
            "--only", "math_synth", "algo_synth")
        cfg = {"name": "t", "vocab_size": 1024, "d_model": 32, "n_layers": 2, "n_heads": 2, "n_kv_heads": 2,
               "max_seq": 64, "attention": "hybrid", "window": 16, "global_every": 2}
        (cls.tmp / "cfg.json").write_text(json.dumps(cfg))

    def train(self, out, *extra, check=True):
        return run("native.train", "--config", str(self.tmp / "cfg.json"), "--data", str(self.tmp / "data"), "--out", str(out),
                   "--steps", "24", "--batch", "4", "--seq", "64", "--warmup", "4", "--eval-every", "0", "--ckpt-every", "0",
                   "--final-eval", "none", *extra, check=check)

    def test_rebuild_reproduces_hashes(self):
        out = run("native.data.build", "--out", str(self.tmp / "data2"), "--tokens", "4e5", "--vocab", "1024",
                  "--only", "math_synth", "algo_synth", "--tokenizer", str(self.tmp / "data" / "tokenizer.json"),
                  "--expect", str(self.tmp / "data" / "manifest.json"))
        self.assertIn("reproduces every expected shard hash", out.stdout)

    def test_resume_is_exact(self):
        self.train(self.tmp / "straight")
        stopped = self.train(self.tmp / "resumed", "--stop-after", "10", check=False)
        self.assertEqual(stopped.returncode, 75)
        self.train(self.tmp / "resumed")
        a = torch.load(self.tmp / "straight/checkpoints/step_0000024/model.pt")
        b = torch.load(self.tmp / "resumed/checkpoints/step_0000024/model.pt")
        self.assertEqual(max((a[k].float() - b[k].float()).abs().max().item() for k in a), 0.0)

    def test_corrupt_checkpoint_is_not_resumed(self):
        from native import checkpoint

        self.train(self.tmp / "corrupt", "--stop-after", "8", check=False)
        path = next((self.tmp / "corrupt/checkpoints").glob("step_*"))
        with open(path / "model.pt", "ab") as f:
            f.write(b"x")
        self.assertIsNone(checkpoint.latest(self.tmp / "corrupt"))

    def test_spec_matches_measured(self):
        for kw in ({}, {"attention": "hybrid"}, {"lowbit": "ternary"}, {"lowbit": "int8"}, {"moe_experts": 4, "moe_topk": 2},
                   {"structured": "monarch", "lowbit": "ternary", "moe_experts": 4}):
            cfg = RougeConfig(vocab_size=512, d_model=64, n_layers=4, n_heads=4, n_kv_heads=2, max_seq=128, window=32, **kw)
            m, s = RougeModel(cfg), spec.summary(cfg)
            self.assertEqual(s["params_physical"], m.num_params(), kw)
            self.assertEqual(s["kv_bytes"]["4k"], m.kv_bytes(4096), kw)
            self.assertAlmostEqual(s["stored_bytes"] / m.stored_bytes(), 1.0, delta=0.02, msg=str(kw))
            # matmul FLOPs against torch's counter (SDPA attention is not counted on CPU; it is analytic)
            from torch.utils.flop_counter import FlopCounterMode

            counter = FlopCounterMode(display=False)
            with counter, torch.no_grad():
                m(torch.randint(0, 512, (1, 128)))
            measured = counter.get_total_flops() / 128
            self.assertAlmostEqual(measured / s["flops_per_token_matmul"], 1.0, delta=0.02, msg=str(kw))


if __name__ == "__main__":
    unittest.main()
