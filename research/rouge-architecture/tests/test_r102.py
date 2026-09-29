from __future__ import annotations

import json
import random
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from benchmarks import depthbench as db  # noqa: E402
from lab import compute  # noqa: E402

try:
    import torch
except ImportError:  # the benchmark and router tests run without torch
    torch = None


class DepthBenchTest(unittest.TestCase):
    def test_answers_depths_and_constant_length(self):
        for split in ("id", "ood"):
            xs = db.fixed_set("test", 20, split)
            self.assertTrue(all(db.solve(t) == a for t, a, _, _ in xs))
            self.assertEqual({len(t) for t, *_ in xs}, {1 + 3 * db.NODES + 2})
            self.assertEqual({d for _, _, d, _ in xs}, set(db.EVAL_DEPTHS[split]))

    def test_required_depth_is_exact(self):
        r = random.Random(1)
        for depth in (1, 2, 4, 8, 12, 16):
            tokens, _, d, _ = db.example(r, depth)
            words = [db.VOCAB[t] for t in tokens]
            nxt = {words[i]: words[i + 1] for i in range(1, len(words) - 2, 3)}
            node, hops = words[-1], 0
            while nxt[node] != node:
                node, hops = nxt[node], hops + 1
            self.assertEqual(hops, depth)

    def test_eval_sets_frozen_and_disjoint_from_training_depths(self):
        self.assertEqual(db.fixed_set("a", 5, "ood"), db.fixed_set("a", 5, "ood"))
        self.assertFalse(set(db.DEPTHS["id"]) & set(db.DEPTHS["ood"]))


class RouterTest(unittest.TestCase):
    def test_tiers_and_no_automatic_h200(self):
        prereg = json.loads((ROOT / "experiments" / "r1_02.json").read_text())
        self.assertEqual(compute.route(prereg)["tier"], 0)
        big = {**prereg, "setup": {**prereg["setup"], "parameters": {"x": 1_000_000_000}}}
        self.assertEqual(compute.route(big)["runs_on"], ["self-hosted", "rouge-research"])
        h200 = {**prereg, "compute": {"needs_h200": True}}
        self.assertIsNone(compute.route(h200)["runs_on"])
        self.assertIsNone(compute.route(h200, "github")["runs_on"])  # not even when forced


@unittest.skipIf(torch is None, "torch not installed")
class LoopedTest(unittest.TestCase):
    def test_halting_modes(self):
        from prototypes.looped import Looped
        ids = torch.tensor([t for t, *_ in db.fixed_set("x", 2, "id")])
        answers = torch.tensor([a for _, a, *_ in db.fixed_set("x", 2, "id")])
        for mode in ("fixed", "act", "ponder"):
            torch.manual_seed(0)
            model = Looped(len(db.VOCAB), d=32, heads=4, halting=mode, max_think=6, think_steps=3, floor=2)
            logits, info = model(ids)
            self.assertEqual(logits.shape, (len(ids), len(db.VOCAB)))
            self.assertTrue(((info["steps"] >= 1) & (info["steps"] <= 6)).all())
            loss = model.loss(logits, info, answers)
            loss.backward()
            self.assertTrue(torch.isfinite(loss))
            if mode == "ponder":
                self.assertTrue(torch.allclose(info["p"].sum(1), torch.ones(len(ids)), atol=1e-5))
            if mode == "act":
                self.assertTrue((info["steps"] >= 2).all())  # the floor holds

    def test_bidirectional_transformer_sees_the_whole_input(self):
        from prototypes.transformer_baseline import Transformer
        torch.manual_seed(0)
        model = Transformer(len(db.VOCAB), d=32, layers=2, causal=False).eval()
        ids = torch.tensor([db.fixed_set("x", 1, "id")[0][0]])
        base, _ = model(ids, torch.tensor([ids.shape[1]]))
        changed = ids.clone()
        changed[0, 1] = (changed[0, 1] + 1) % len(db.VOCAB)
        self.assertFalse(torch.allclose(base, model(changed, torch.tensor([ids.shape[1]]))[0]))


if __name__ == "__main__":
    unittest.main()
