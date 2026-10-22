"""Tests for central runner RI/run_experiments.py failure handling and artifact validation."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import run_experiments


class RunnerTests(unittest.TestCase):
    def test_missing_directory_causes_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing_dir = Path(tmp) / "does_not_exist"
            summary_path = Path(tmp) / "summary.json"
            rc = run_experiments.run_suite(
                experiments=[("Mock Missing", missing_dir, [])],
                tests_only=False,
                summary_output=summary_path,
                run_top_level_tests=False,
            )
            self.assertEqual(rc, 1)
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            self.assertFalse(summary["all_passed"])
            self.assertTrue(any("directory missing" in f for f in summary["failures"]))

    def test_failing_unit_test_causes_nonzero_exit(self):
        with tempfile.TemporaryDirectory() as tmp:
            exp_dir = Path(tmp) / "exp_fail_test"
            exp_dir.mkdir()
            (exp_dir / "test_experiment.py").write_text(
                "import unittest\n"
                "class T(unittest.TestCase):\n"
                "    def test_fail(self):\n"
                "        self.assertEqual(1, 2)\n",
                encoding="utf-8",
            )
            (exp_dir / "evaluate.py").write_text(
                "import argparse, json\n"
                "from pathlib import Path\n"
                "p = argparse.ArgumentParser()\n"
                "p.add_argument('--output', required=True)\n"
                "a = p.parse_args()\n"
                "out = Path(a.output)\n"
                "out.parent.mkdir(parents=True, exist_ok=True)\n"
                "out.write_text(json.dumps({'ok': True}), encoding='utf-8')\n",
                encoding="utf-8",
            )
            summary_path = Path(tmp) / "summary.json"
            rc = run_experiments.run_suite(
                experiments=[("Mock Failing Test", exp_dir, [])],
                tests_only=False,
                summary_output=summary_path,
                run_top_level_tests=False,
            )
            self.assertEqual(rc, 1)
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            self.assertFalse(summary["all_passed"])
            self.assertTrue(any("Mock Failing Test: tests failed" in f for f in summary["failures"]))

    def test_failing_evaluation_causes_nonzero_exit(self):
        with tempfile.TemporaryDirectory() as tmp:
            exp_dir = Path(tmp) / "exp_fail_eval"
            exp_dir.mkdir()
            (exp_dir / "test_experiment.py").write_text(
                "import unittest\n"
                "class T(unittest.TestCase):\n"
                "    def test_ok(self):\n"
                "        self.assertTrue(True)\n",
                encoding="utf-8",
            )
            (exp_dir / "evaluate.py").write_text(
                "import sys\nsys.exit(2)\n",
                encoding="utf-8",
            )
            summary_path = Path(tmp) / "summary.json"
            rc = run_experiments.run_suite(
                experiments=[("Mock Failing Eval", exp_dir, [])],
                tests_only=False,
                summary_output=summary_path,
                run_top_level_tests=False,
            )
            self.assertEqual(rc, 1)
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            self.assertFalse(summary["all_passed"])
            self.assertTrue(any("Mock Failing Eval: evaluation failed (exit code 2)" in f for f in summary["failures"]))

    def test_secret_detection_rejects_leaked_token_in_artifact(self):
        with tempfile.TemporaryDirectory() as tmp:
            artifact = Path(tmp) / "results.json"
            artifact.write_text(json.dumps({"api_key": "secret"}), encoding="utf-8")
            valid, reason = run_experiments.validate_results_file(artifact)
            self.assertFalse(valid)
            self.assertIn("secret", reason)


if __name__ == "__main__":
    unittest.main()
