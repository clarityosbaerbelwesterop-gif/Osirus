"""Lightning spend ceiling (50 EUR over every Rouge job): refusal, ledger accounting, estimates."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lightning_ai"))

import cost  # noqa: E402


def ledger(*jobs):
    return {"months": {"2026-09": {"jobs": list(jobs)}}}


class TestCeiling(unittest.TestCase):
    def test_ceiling_is_50_eur_at_a_conservative_rate(self):
        self.assertAlmostEqual(cost.CEILING_USD, 52.5)

    def test_refuses_a_launch_that_would_exceed_the_ceiling(self):
        cost.check(ledger(), cost.worst_case("H100", 13))                 # 52 USD fits
        with self.assertRaises(SystemExit):
            cost.check(ledger(), cost.worst_case("H100", 14))             # 56 USD does not
        with self.assertRaises(SystemExit):
            cost.worst_case("B200", 1)                                    # not a training machine
        with self.assertRaises(SystemExit):
            cost.check(ledger(), float("nan"))

    def test_every_lightning_job_counts(self):
        l = ledger({"cost_usd": 0.05}, {"cost_usd": None, "worst_case_usd": 20.0}, {"cost_usd": 10.0})
        self.assertAlmostEqual(cost.committed(l), 30.05)
        with self.assertRaises(SystemExit):
            cost.check(l, cost.worst_case("H200", 4))                     # 30.05 + 28 > 52.5

    def test_estimate_scales_with_flops(self):
        a = cost.estimate(6e8, 2e9, 4.0, mfu=0.3)
        b = cost.estimate(6e8, 4e9, 4.0, mfu=0.3)
        self.assertAlmostEqual(b["train_hours"], 2 * a["train_hours"], delta=0.002)


if __name__ == "__main__":
    unittest.main()
