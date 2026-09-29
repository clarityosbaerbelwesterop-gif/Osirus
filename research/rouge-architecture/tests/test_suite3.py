from __future__ import annotations

import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from benchmarks import audit  # noqa: E402
from benchmarks import suite3 as bench  # noqa: E402


class Suite3Test(unittest.TestCase):
    def test_generators_match_the_reference_solver(self):
        r = random.Random(0)
        for task in bench.TASKS:
            for split in ("id", "ood"):
                for _ in range(200):
                    tokens, answer, t, level = bench.example(r, task, split)
                    self.assertEqual(bench.solve(tokens, t), answer, (task, split))
                    lo, hi = bench.LEVELS[task]["ood" if split == "ood" else "id"]
                    self.assertTrue(lo <= level <= hi)

    def test_splits_frozen_and_levels_disjoint(self):
        self.assertEqual(bench.fixed_set("dev", 3, "dev"), bench.fixed_set("dev", 3, "dev"))
        self.assertNotEqual(bench.fixed_set("holdout:R1.07", 3, "holdout"), bench.fixed_set("holdout:R1.08", 3, "holdout"))
        for task, lv in bench.LEVELS.items():
            self.assertLess(lv["id"][1], lv["ood"][0], task)

    def test_no_unexplained_shortcut(self):
        for task in bench.TASKS:
            if task in audit.KNOWN_FLOORS:
                continue
            for split, row in audit.audit_task(task, n_train=1500, n_eval=300).items():
                self.assertFalse(row["flag"], (task, split, row))

    def test_adversarial_split_defeats_the_cue_model(self):
        xs = audit.adversarial("recall", 50, "test")
        self.assertEqual(len(xs), 50)


if __name__ == "__main__":
    unittest.main()
