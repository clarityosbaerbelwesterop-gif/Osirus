from __future__ import annotations

import json
import random
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from benchmarks import depthbench as db  # noqa: E402
from benchmarks import depthbench2 as db2  # noqa: E402
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


class DepthBench2Test(unittest.TestCase):
    def test_answers_and_constant_length(self):
        for split in ("id", "ood"):
            xs = db2.fixed_set("test", 20, split)
            self.assertTrue(all(db2.solve(t) == a for t, a, _, _ in xs))
            self.assertEqual({len(t) for t, *_ in xs}, {1 + 3 * db2.NODES + 2})

    def test_no_shortcut_beats_guessing_at_any_depth(self):
        # The lesson of R1.02 (void): cheap cues must stay at the 50% guess level.
        for split in ("id", "ood"):
            by = {}
            for t, a, d, _ in db2.fixed_set("audit", 150, split):
                for name, guess in db2.shortcuts(t).items():
                    if name == "query_target_is_terminal_else_first" and d == 1:
                        continue  # one real hop: that is the task, not a cue
                    by.setdefault((name, d), []).append(guess == a)
            for key, hits in by.items():
                self.assertLess(sum(hits) / len(hits), 0.62, key)

    def test_v1_had_the_length_cue(self):
        # Kept as a record of why R1.02 was void.
        def longest(tokens):
            w = [db.VOCAB[t] for t in tokens]
            nxt = {w[i]: w[i + 1] for i in range(1, len(w) - 2, 3)}

            def run(n):
                k = 0
                while nxt[n] != n:
                    n, k = nxt[n], k + 1
                return n, k
            return db.ID[run(max(nxt, key=lambda n: run(n)[1]))[0]]
        xs = db.fixed_set("r1.02", 100, "ood")
        self.assertGreater(sum(longest(t) == a for t, a, _, _ in xs) / len(xs), 0.95)


class RouterTest(unittest.TestCase):
    def test_tiers_and_no_automatic_h200(self):
        prereg = json.loads((ROOT / "experiments" / "r1_02b.json").read_text())
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
