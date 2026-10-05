#!/usr/bin/env python3
"""Launch every model line the planner admits, in parallel, from one owner-approved run.

The planner (program/plan.py) admits ready jobs in priority order while the ceiling covers the SUM
of their worst cases, so jobs started together can never exceed it. Each job runs its own launcher
(lightning_ai/rouge1_session.py) in a subprocess with its own copy of the ledger (ROUGE_LEDGER), so
no two processes write one file; the copies are merged into lightning_ai/ledger.json at the end.

    python program/launch.py --dry-run     # what would start, with the commands
    python program/launch.py               # start them (in the rouge-gpu environment only)
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "lightning_ai"))
import cost  # noqa: E402
import ledger_merge  # noqa: E402
import plan as planner  # noqa: E402


def command(job: dict) -> list[str]:
    cmd = [sys.executable, "lightning_ai/rouge1_session.py", "--run", job["name"], "--prereg", job["prereg"],
           "--machine", job["machine"], "--max-hours", str(job["hours"])]
    if job.get("ttc_k"):
        cmd += ["--ttc-k", str(job["ttc_k"])]
    return cmd + [str(a) for a in job.get("args", [])]


def _relay(name: str, stream) -> None:
    for line in stream:
        print(f"[{name}] {line.rstrip()}", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lines", type=Path, default=HERE / "lines.json")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    program = json.loads(args.lines.read_text())
    ledger_path = ROOT / "lightning_ai" / "ledger.json"
    out = planner.plan(program["lines"], cost.CEILING_USD - cost.committed(cost.load(ledger_path)), cost.live_prices())
    jobs = {l["id"]: l["next"] for l in program["lines"]}
    print(json.dumps({k: out[k] for k in ("remaining_usd", "parallel_now", "left_after_usd", "waiting")}, indent=1), flush=True)
    admitted = [(j["line"], jobs[j["line"]]) for j in out["parallel_now"]]
    if not admitted:
        raise SystemExit("nothing is ready and affordable")
    if args.dry_run:
        for line, job in admitted:
            print(f"[dry-run] {line}: {' '.join(command(job))}")
        return

    procs, copies = [], []
    for line, job in admitted:
        copy = ledger_path.with_name(f"ledger.{job['name']}.json")
        shutil.copy(ledger_path, copy)
        copies.append(copy)
        p = subprocess.Popen(command(job), cwd=ROOT, env=os.environ | {"ROUGE_LEDGER": str(copy)},
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        t = threading.Thread(target=_relay, args=(job["name"], p.stdout), daemon=True)
        t.start()
        procs.append((line, job["name"], p, t))
    codes = {}
    for line, name, p, t in procs:
        codes[name] = p.wait()
        t.join()
    merged = cost.load(ledger_path)
    for copy in copies:
        merged = ledger_merge.merge(merged, json.loads(copy.read_text()))
        copy.unlink()
    ledger_path.write_text(json.dumps(merged, indent=1) + "\n")
    print("PROGRAM_RESULT", json.dumps(codes), flush=True)
    raise SystemExit(0 if all(c == 0 for c in codes.values()) else 1)


if __name__ == "__main__":
    main()
