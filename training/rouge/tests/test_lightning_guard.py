"""Lightning launcher guards: machine allowlist, monthly ledger, bootstrap command (no secrets)."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lightning_ai"))

import job  # noqa: E402  (stdlib only at import; the SDK is imported inside functions)


class TestGuards(unittest.TestCase):
    def test_large_gpus_are_refused(self):
        for machine in ("H100", "H200", "A100", "B200", "L40S"):
            with self.assertRaises(SystemExit):
                job.check_budget({"months": {}}, machine, 0.1)

    def test_monthly_credits_are_enforced(self):
        ledger = {"months": {job.month(): {"jobs": [{"cost_usd": 12.0}]}}}
        with self.assertRaises(SystemExit):
            job.check_budget(ledger, "L4", 4.0)                   # 12 + 2.4 > 15 - 1
        self.assertAlmostEqual(job.check_budget(ledger, "T4", 1.0), 0.30)
        running = {"months": {job.month(): {"jobs": [{"cost_usd": None, "worst_case_usd": 13.95}]}}}
        with self.assertRaises(SystemExit):                        # an open job counts at its worst case
            job.check_budget(running, "CPU", 1.0)

    def test_bootstrap_pins_the_commit_and_passes_no_secret(self):
        cmd = job.bootstrap_command("0123abcd" * 5, "lightning_ai/tournament.sh")
        self.assertIn("/tar.gz/" + "0123abcd" * 5, cmd)
        self.assertNotIn("API_KEY", cmd)
        self.assertNotIn("TOKEN", cmd)


if __name__ == "__main__":
    unittest.main()
