from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lab import stats  # noqa: E402


class StatsTest(unittest.TestCase):
    def test_ci_contains_mean_and_widens_with_spread(self):
        tight, wide = stats.summary([0.50, 0.51, 0.49]), stats.summary([0.3, 0.5, 0.7])
        self.assertLess(tight["ci95"][0], 0.5)
        self.assertGreater(tight["ci95"][1], 0.5)
        self.assertGreater(wide["ci95"][1] - wide["ci95"][0], tight["ci95"][1] - tight["ci95"][0])

    def test_spearman_ties_and_order(self):
        self.assertEqual(stats.spearman([1, 2, 3, 4], [5, 5, 5, 5]), 0.0)
        self.assertAlmostEqual(stats.spearman([1, 2, 4, 8, 16], [1.0, 1.5, 3.0, 6.0, 9.0]), 1.0)
        self.assertAlmostEqual(stats.spearman([1, 2, 3], [3, 2, 1]), -1.0)


if __name__ == "__main__":
    unittest.main()
