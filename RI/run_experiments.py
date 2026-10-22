"""Run all RI toy experiment test suites and evaluations using the active Python interpreter.

From repository root: python RI/run_experiments.py
No network, GPU, paid service, or external dependency is required.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EXPERIMENTS = (
    ("E2 capability use", ROOT / "experiments" / "E2_capability_transfer"),
    ("E3 composition", ROOT / "experiments" / "E3_composition"),
    ("E4 autonomous curriculum", ROOT / "experiments" / "E4_autonomous_curriculum"),
)

def run(label, cwd, args):
    print(f"\n=== {label}: {' '.join(args)} ===", flush=True)
    result = subprocess.run([sys.executable, *args], cwd=cwd, check=False)
    return result.returncode

def main():
    failures = []
    for label, directory in EXPERIMENTS:
        if not directory.is_dir():
            failures.append(f"{label}: directory missing")
            continue
        code = run(label + " tests", directory, ["-m", "unittest", "-v"])
        if code:
            failures.append(f"{label}: tests exit {code}")
        eval_args = ["evaluate.py", "--seeds", *[str(i) for i in range(30)],
                     "--output", str(directory / "results" / "results.json")]
        code = run(label + " evaluation", directory, eval_args)
        if code:
            failures.append(f"{label}: evaluation exit {code}")
    if failures:
        print("\nFAILED:")
        for item in failures:
            print(f"- {item}")
        return 1
    print("\nAll configured test/evaluation commands exited successfully.")
    print("This is software validation only; results do not prove general intelligence.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
