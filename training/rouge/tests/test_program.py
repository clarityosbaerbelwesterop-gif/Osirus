"""Program planner: parallel jobs are admitted by priority while the ceiling covers their worst case."""

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "program"))

import plan  # noqa: E402


def line(i, machine, hours, ready=True, priority=1):
    return {"id": i, "priority": priority, "next": {"name": f"{i}-001", "machine": machine, "hours": hours, "ready": ready}}


class PlanTest(unittest.TestCase):
    PRICES = {"H200_X_8": {"usd_per_hour": 36.0}, "H200": {"usd_per_hour": 4.5}, "B200_X_8": {"usd_per_hour": 78.87}}

    def test_parallel_jobs_fill_the_budget_in_priority_order(self):
        lines = [line("rouge-1", "H200_X_8", 2.5, priority=1), line("quesnir", "H200", 6, priority=2),
                 line("darus", "B200_X_8", 1.5, priority=3)]
        out = plan.plan(lines, 125.0, self.PRICES)
        self.assertEqual([j["line"] for j in out["parallel_now"]], ["rouge-1", "quesnir"])
        self.assertEqual(out["waiting"][0]["line"], "darus")
        self.assertIn("budget", out["waiting"][0]["reason"])
        self.assertAlmostEqual(out["left_after_usd"], 125.0 - 94.5 - 28.35, places=2)

    def test_a_job_that_is_not_ready_never_runs(self):
        out = plan.plan([line("quesnir", "H200", 6, ready=False)], 1000.0, self.PRICES)
        self.assertEqual(out["parallel_now"], [])

    def test_the_committed_program_file_is_valid(self):
        program = json.loads((ROOT / "program" / "lines.json").read_text())
        self.assertEqual({l["id"] for l in program["lines"]}, {"rouge-1", "quesnir", "darus"})
        out = plan.plan(program["lines"], 125.0, self.PRICES)
        self.assertEqual([j["line"] for j in out["parallel_now"]], ["rouge-1"])


if __name__ == "__main__":
    unittest.main()
