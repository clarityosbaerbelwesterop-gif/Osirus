from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lab import gate  # noqa: E402

try:
    import torch
except ImportError:
    torch = None


class GateTest(unittest.TestCase):
    table = {"a": {"metrics": {"x": {"mean": 0.6, "values": [0.5, 0.6, 0.7]}, "f": 10}},
             "b": {"metrics": {"x": {"mean": 0.4, "values": [0.45, 0.4, 0.35]}, "f": 30}}}

    def test_checks_and_rules(self):
        g = {"checks": {"C1": {"left": "a:x", "op": ">=", "right": "b:x", "plus": 0.1},
                        "C2": {"left": "a:x", "op": ">", "right": "b:x", "every_seed": True},
                        "C3": {"left": "a:f", "op": "<=", "right": "b:f", "times": 0.25},
                        "C4": {"left_any": ["a:x", "b:x"], "op": ">=", "value": 0.55}},
             "decision": [{"result": "PASS", "all": ["C1", "C2", "C3"]}, {"result": "PARTIAL", "at_least": {"n": 2, "of": ["C1", "C2", "C3"]}},
                          {"result": "FAIL"}]}
        d = gate.decide(self.table, g)
        self.assertEqual(d["checks"], {"C1": True, "C2": True, "C3": False, "C4": True})
        self.assertEqual(d["result"], "PARTIAL")

    def test_missing_model_is_incomplete(self):
        d = gate.decide(self.table, {"checks": {"C": {"left": "z:x", "op": ">=", "value": 0}}, "decision": [{"result": "PASS"}]})
        self.assertFalse(d["complete"])


@unittest.skipIf(torch is None, "torch not installed")
class ZooTest(unittest.TestCase):
    def test_every_kind_is_causal_and_trainable(self):
        from benchmarks import suite3 as bench
        from prototypes import zoo
        ids = torch.tensor([[1, 20, 21, 22, 2, 0, 0], [1, 23, 24, 25, 26, 27, 2]])
        lengths = torch.tensor([5, 7])
        for kind, cfg in (("lstm", {"d": 16}), ("gru", {"d": 16}), ("ssm", {"d": 16, "layers": 2, "n": 4}), ("looped", {"d": 16, "steps": 2})):
            torch.manual_seed(0)
            m = zoo.build(kind, len(bench.VOCAB), **cfg).eval()
            logits, _ = m(ids, lengths)
            logits.sum().backward()
            # padding after the last real token does not change the answer (causal models)
            longer = torch.cat([ids, torch.zeros(2, 3, dtype=torch.long)], 1)
            self.assertTrue(torch.allclose(logits, m(longer, lengths)[0], atol=1e-5), kind)
            self.assertIn("state", zoo.memory_bytes(m, 50))


if __name__ == "__main__":
    unittest.main()


@unittest.skipIf(torch is None, "torch not installed")
class ScanTest(unittest.TestCase):
    def test_chunked_scan_equals_the_recurrence_and_is_pad_invariant(self):
        from benchmarks import suite3 as bench
        from prototypes.rouge_mem import RougeMem
        torch.manual_seed(0)
        a, b, x0 = torch.rand(2, 70, 3, 4), torch.randn(2, 70, 3, 4), torch.randn(2, 3, 4)
        x = x0.clone()
        for t in range(70):
            x = a[:, t] * x + b[:, t]
        self.assertTrue(torch.allclose(RougeMem.linear_scan(x0, a, b, 16), x, atol=1e-5))
        m = RougeMem(len(bench.VOCAB), d=32, slots=2, heads=4, max_think=3, inject=True, rezero=True,
                     memory_slots=8, context=3, read_mode="scan").eval()
        ids = torch.tensor([[1, 20, 21, 22, 2, 0], [1, 23, 24, 25, 26, 2]])
        lengths = torch.tensor([5, 6])
        padded = torch.cat([ids, torch.zeros(2, 4, dtype=torch.long)], 1)
        self.assertTrue(torch.allclose(m(ids, lengths)[0], m(padded, lengths)[0], atol=1e-5))
