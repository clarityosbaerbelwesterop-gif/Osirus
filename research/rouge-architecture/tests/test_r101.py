"""R1.01 checks: the benchmark is correct and the models do what they claim."""

from __future__ import annotations

import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from benchmarks import microbench as mb  # noqa: E402


class BenchmarkTest(unittest.TestCase):
    def test_answers_are_correct_and_splits_differ(self):
        r = random.Random(0)
        for split in ("id", "ood"):
            for tokens, answer, task, level in mb.batch(r, 600, split):
                self.assertEqual(mb.solve(tokens), answer)
                lo, hi = mb.RANGES[task][split]
                self.assertTrue(lo <= level <= hi)
        for task in mb.TASKS:  # ID and OOD difficulty ranges never overlap
            self.assertLess(mb.RANGES[task]["id"][1], mb.RANGES[task]["ood"][0])

    def test_eval_sets_are_frozen(self):
        self.assertEqual(mb.fixed_set("x", 5, "ood"), mb.fixed_set("x", 5, "ood"))


try:
    import torch
except ImportError:  # the stdlib-only job skips the model checks
    torch = None


@unittest.skipIf(torch is None, "needs torch")
class ModelTest(unittest.TestCase):
    def setUp(self):
        from prototypes.rouge_r101 import Rouge
        from prototypes.transformer_baseline import Transformer

        torch.manual_seed(0)
        self.ids = torch.randint(1, len(mb.VOCAB), (3, 12))
        self.lengths = torch.tensor([12, 7, 3])
        self.rouge, self.transformer = Rouge(len(mb.VOCAB), 32, 4, 4, max_think=5), Transformer(len(mb.VOCAB), 32, 2, 4)

    def test_padding_does_not_change_answers(self):
        for model in (self.rouge, self.transformer):
            model.eval()
            full, _ = model(self.ids, self.lengths)
            short, _ = model(self.ids[2:3, :3], self.lengths[2:3])
            self.assertTrue(torch.allclose(full[2], short[0], atol=1e-5), type(model).__name__)

    def test_halting_is_bounded_and_differentiable(self):
        logits, info = self.rouge(self.ids, self.lengths)
        self.assertTrue(((info["steps"] >= 1) & (info["steps"] <= 5)).all())
        (logits.sum() + self.rouge.extra_loss(info)).backward()
        self.assertIsNotNone(self.rouge.halt.weight.grad)

    def test_state_memory_does_not_grow(self):
        self.assertEqual(self.rouge.state_bytes(10), self.rouge.state_bytes(10_000))
        self.assertGreater(self.transformer.state_bytes(10_000), self.transformer.state_bytes(10))


if __name__ == "__main__":
    unittest.main()
