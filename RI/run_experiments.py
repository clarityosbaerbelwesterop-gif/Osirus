"""Run RI experiment suites. From repo root: python RI/run_experiments.py."""
import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EXPERIMENTS = (
    ("M3 E2 capability use", ROOT / "experiments/E2_capability_transfer",
     ["--seeds", *map(str, range(30)), "--budget", "4", "--noise", "0.15"]),
    ("M4 E3 composition", ROOT / "experiments/E3_composition",
     ["--seeds", *map(str, range(30)), "--noise", "0.0"]),
    ("M5 E4 autonomous curriculum", ROOT / "experiments/E4_autonomous_curriculum",
     ["--seeds", *map(str, range(30)), "--steps", "80", "--noise", "0.1"]),
    ("M6 E5 continual learning", ROOT / "experiments/E5_continual_learning",
     ["--seeds", *map(str, range(30)), "--steps", "120"]),
    ("M7 E6 guarded improvement", ROOT / "experiments/E6_guarded_self_improvement",
     ["--seeds", *map(str, range(30))]),
    ("M8 E7 held-out skill acquisition", ROOT / "experiments/E7_skill_acquisition",
     ["--seeds", *map(str, range(30)), "--train-size", "12", "--test-size", "24"]),
    ("M9 E8 rule-family discovery", ROOT / "experiments/E8_rule_discovery",
     ["--seeds", *map(str, range(30)), "--train-size", "16", "--test-size", "24"]),
    ("M16 E9 held-out rule generalization", ROOT / "experiments/E9_heldout_rule_generalization",
     ["--seeds", *map(str, range(30)), "--train-size", "10", "--val-size", "10",
      "--query-pool-size", "16", "--test-size", "36", "--noise", "0.05"]),
    ("M17 E10 guarded sub-primitive synthesis", ROOT / "experiments/E10_guarded_subprimitive_synthesis",
     ["--seeds", *map(str, range(30)), "--train-size", "18", "--val-size", "14",
      "--independent-size-val", "14", "--test-size", "36"]),
    ("M18 E11 active disambiguation", ROOT / "experiments/E11_active_disambiguation",
     ["--seeds", *map(str, range(30)), "--train-size", "16", "--val-size", "14",
      "--independent-size-val", "14", "--test-size", "36", "--intervention-budget", "3"]),
    ("M19 E12 adaptive sequential confidence", ROOT / "experiments/E12_sequential_confidence",
     ["--seeds", *map(str, range(30))]),
)

SECRET_PATTERN = re.compile(
    r"(api[_-]?key|secret[_-]?key|access[_-]?token|private[_-]?key|password\s*[:=]|ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,})",
    re.IGNORECASE,
)


def run(label, cwd, args):
    print(f"\n=== {label}: {' '.join(args)} ===", flush=True)
    return subprocess.run([sys.executable, *args], cwd=cwd, check=False).returncode


def validate_results_file(path):
    """Ensure result artifact exists, is valid JSON, and contains no secret patterns."""
    if not path.is_file():
        return False, "results JSON missing"
    try:
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw)
    except Exception as exc:
        return False, f"invalid JSON ({exc})"
    if not isinstance(data, dict):
        return False, "top-level JSON value must be an object"
    if SECRET_PATTERN.search(raw):
        return False, "potential secret pattern detected in results artifact"
    return True, "ok"


def run_suite(experiments=EXPERIMENTS, tests_only=False, summary_output=None, run_top_level_tests=True):
    failures = []
    records = []

    for label, directory, eval_args in experiments:
        record = {
            "experiment": label,
            "directory": str(directory),
            "tests_exit_code": None,
            "evaluation_exit_code": None,
            "artifact_valid": None,
            "duration_ms": 0.0,
            "status": "passed",
        }
        start = time.perf_counter()
        if not directory.is_dir():
            failures.append(f"{label}: directory missing ({directory})")
            record["status"] = "failed: directory missing"
            records.append(record)
            continue

        test_rc = run(label + " tests", directory, ["-m", "unittest", "-v"])
        record["tests_exit_code"] = test_rc
        if test_rc != 0:
            failures.append(f"{label}: tests failed (exit code {test_rc})")
            record["status"] = f"failed: tests (exit code {test_rc})"

        if not tests_only:
            out_path = directory / "results/results.json"
            eval_rc = run(
                label + " evaluation",
                directory,
                ["evaluate.py", *eval_args, "--output", str(out_path)],
            )
            record["evaluation_exit_code"] = eval_rc
            if eval_rc != 0:
                failures.append(f"{label}: evaluation failed (exit code {eval_rc})")
                record["status"] = f"failed: evaluation (exit code {eval_rc})"
            else:
                valid, reason = validate_results_file(out_path)
                record["artifact_valid"] = valid
                if not valid:
                    failures.append(f"{label}: artifact validation failed ({reason})")
                    record["status"] = f"failed: artifact validation ({reason})"

        record["duration_ms"] = round((time.perf_counter() - start) * 1000.0, 3)
        records.append(record)

    if run_top_level_tests and (ROOT / "tests").is_dir():
        top_rc = run("RI top-level tests", ROOT, ["-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py", "-v"])
        if top_rc != 0:
            failures.append(f"RI top-level tests: tests failed (exit code {top_rc})")

    if run_top_level_tests and not tests_only and (ROOT / "run_prototype.py").is_file():
        proto_rc = run("M10-M12 prototype demo and benchmark", ROOT, ["run_prototype.py", "--mode", "all"])
        if proto_rc != 0:
            failures.append(f"M10-M12 prototype: execution failed (exit code {proto_rc})")
        else:
            for proto_artifact in (
                ROOT / "results/prototype_demo_report.json",
                ROOT / "results/prototype_benchmark.json",
                ROOT / "results/prototype_skill_memory.json",
                ROOT / "results/m16_summary.json",
                ROOT / "results/m16_ablation_results.json",
                ROOT / "results/m17_summary.json",
                ROOT / "results/m17_ablation_results.json",
                ROOT / "results/m18_summary.json",
                ROOT / "results/m18_ablation_results.json",
                ROOT / "results/m19_summary.json",
                ROOT / "results/m19_ablation_results.json",
            ):
                valid, reason = validate_results_file(proto_artifact)
                if not valid:
                    failures.append(f"RI artifact {proto_artifact.name}: {reason}")

    summary = {
        "n_experiments": len(records),
        "tests_only": bool(tests_only),
        "all_passed": len(failures) == 0,
        "failures": failures,
        "experiments": records,
    }
    if summary_output is not None:
        out = Path(summary_output)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

    if failures:
        print("\nFAILED:")
        for failure in failures:
            print("- " + failure)
        return 1
    print("\nAll configured test and evaluation commands exited successfully.")
    print("This validates code paths only; synthetic results are not evidence of general intelligence.")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="Run RI experiment tests and evaluations.")
    parser.add_argument("--tests-only", action="store_true", help="Run only unit tests without evaluations.")
    parser.add_argument(
        "--summary-output",
        default=str(ROOT / "results/experiment_suite_summary.json"),
        help="Path for consolidated suite summary JSON.",
    )
    args = parser.parse_args(argv)
    return run_suite(
        experiments=EXPERIMENTS,
        tests_only=args.tests_only,
        summary_output=args.summary_output,
        run_top_level_tests=True,
    )


if __name__ == "__main__":
    raise SystemExit(main())
