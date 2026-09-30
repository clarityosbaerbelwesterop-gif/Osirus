"""RunPod spend ceiling (50 EUR): refusal, ledger accounting, estimates."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "runpod"))

import cost  # noqa: E402


class TestCeiling(unittest.TestCase):
    def test_ceiling_is_50_eur_at_a_conservative_rate(self):
        self.assertAlmostEqual(cost.CEILING_USD, 52.5)

    def test_refuses_a_launch_that_would_exceed_the_ceiling(self):
        ledger = {"entries": []}
        cost.check(ledger, cost.worst_case(4.59, 11))                      # 50.49 USD fits
        with self.assertRaises(SystemExit):
            cost.check(ledger, cost.worst_case(4.59, 12))                  # 55.08 USD does not
        with self.assertRaises(SystemExit):
            cost.check(ledger, float("nan"))

    def test_open_entries_count_at_worst_case_closed_at_actual(self):
        ledger = {"entries": []}
        e = cost.open_entry(ledger, "pod", "seg1", 4.59, 5.0, cost.worst_case(4.59, 5.0))
        self.assertAlmostEqual(cost.committed(ledger), 22.95)
        cost.close_entry(e, seconds=3600, price_per_hour=4.59)
        self.assertAlmostEqual(cost.committed(ledger), 4.59)
        with self.assertRaises(SystemExit):                                # 4.59 spent + 48 > 52.5
            cost.check(ledger, 48.0)

    def test_estimate_scales_with_flops(self):
        a = cost.estimate(6e8, 2e9, 4.59, mfu=0.3)
        b = cost.estimate(6e8, 4e9, 4.59, mfu=0.3)
        self.assertAlmostEqual(b["train_hours"], 2 * a["train_hours"], delta=0.002)      # rounded to 3 places
        self.assertGreater(a["usd"], 0)


if __name__ == "__main__":
    unittest.main()
