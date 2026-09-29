from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from benchmarks import microbench as mb1  # noqa: E402
from benchmarks import microbench2 as mb  # noqa: E402

# Recall's floor is not 10%: guessing a value that occurs in the context
# (e.g. the most common one) scores ~0.3 ID with 2-10 facts. R1.03 reports
# that floor next to recall accuracy; a model near it is not recalling.
GUESS = {"hops": 0.5, "state": 0.1, "recall": 0.3}


class MicroBench2Test(unittest.TestCase):
    def test_answers(self):
        for split in ("id", "ood"):
            self.assertTrue(all(mb.solve(t) == a for t, a, _, _ in mb.fixed_set("t", 50, split)))

    def test_no_cue_beats_guessing(self):
        for split in ("id", "ood"):
            hits = {}
            for tokens, answer, task, _ in mb.fixed_set("audit", 300, split):
                for name, guess in mb.shortcuts(tokens, task).items():
                    hits.setdefault((task, name), []).append(guess == answer)
            for (task, name), h in hits.items():
                self.assertLess(sum(h) / len(h), GUESS[task] + 0.12, (split, task, name))

    def test_v1_hops_had_the_length_cue(self):
        # Record of why hops changed: in v1 the longest chain's digit was the answer.
        hits = [mb.shortcuts(t, "hops")["longest_chain_digit"] == a
                for t, a, task, _ in mb1.fixed_set("r1.01", 300, "ood") if task == "hops"]
        self.assertGreater(sum(hits) / len(hits), 0.95)


if __name__ == "__main__":
    unittest.main()
