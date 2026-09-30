"""Ledger merge: concurrent workflows keep every entry; a finished entry replaces its running copy."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lightning_ai"))

from ledger_merge import merge  # noqa: E402


class TestMerge(unittest.TestCase):
    def test_union_and_finished_wins(self):
        base = {"months": {"2026-09": {"jobs": [{"name": "a", "started": "1", "cost_usd": None, "worst_case_usd": 1.0},
                                                {"name": "b", "started": "2", "cost_usd": 0.5}]}}}
        ours = {"months": {"2026-09": {"jobs": [{"name": "a", "started": "1", "cost_usd": 0.2}]},
                           "2026-10": {"jobs": [{"name": "c", "started": "3", "cost_usd": 0.1}]}}}
        m = merge(base, ours)
        jobs = {j["name"]: j for j in m["months"]["2026-09"]["jobs"]}
        self.assertEqual(set(jobs), {"a", "b"})
        self.assertEqual(jobs["a"]["cost_usd"], 0.2)
        self.assertEqual(m["months"]["2026-10"]["jobs"][0]["name"], "c")
        self.assertEqual(merge(m, base), merge(m, {}))                   # merging stale data never loses the finished cost


if __name__ == "__main__":
    unittest.main()
