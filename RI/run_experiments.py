"""Run RI experiment suites. From repo root: python RI/run_experiments.py."""
import subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
EXPERIMENTS=(
 ("M3 E2 capability use",ROOT/"experiments/E2_capability_transfer",["--seeds",*[str(i) for i in range(30)],"--budget","4","--noise","0.15"]),
 ("M4 E3 composition",ROOT/"experiments/E3_composition",["--seeds",*[str(i) for i in range(30)],"--noise","0.0"]),
 ("M5 E4 autonomous curriculum",ROOT/"experiments/E4_autonomous_curriculum",["--seeds",*[str(i) for i in range(30)],"--steps","80","--noise","0.1"]),
 ("M6 E5 continual learning",ROOT/"experiments/E5_continual_learning",["--seeds",*[str(i) for i in range(30)],"--steps","120"]),
 ("M7 E6 guarded improvement",ROOT/"experiments/E6_guarded_self_improvement",["--seeds",*[str(i) for i in range(30)]]),
)
def run(label,cwd,args):
 print(f"\n=== {label}: {' '.join(args)} ===",flush=True)
 return subprocess.run([sys.executable,*args],cwd=cwd,check=False).returncode
def main():
 failures=[]
 for label,directory,eval_args in EXPERIMENTS:
  if not directory.is_dir():
   failures.append(f"{label}: directory missing");continue
  if run(label+" tests",directory,["-m","unittest","-v"]):
   failures.append(f"{label}: tests failed")
  if run(label+" evaluation",directory,["evaluate.py",*eval_args,"--output",str(directory/"results/results.json")]):
   failures.append(f"{label}: evaluation failed")
 if failures:
  print("\nFAILED:");[print("- "+x) for x in failures];return 1
 print("\nAll configured test and evaluation commands exited successfully.")
 print("This validates code paths only; synthetic results are not evidence of general intelligence.")
 return 0
if __name__=="__main__":raise SystemExit(main())
