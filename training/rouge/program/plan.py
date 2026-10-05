#!/usr/bin/env python3
"""Which model lines can train now, in parallel, under the ceiling.

Reads program/lines.json and the ledger (lightning_ai/cost.py). Each line's next job costs its worst
case (live price + 5 %, or the price ceiling when unknown). Jobs are admitted in priority order
while they are ready and the remaining budget covers them; everything else waits with its reason.
Nothing is launched here: the launch stays one owner-approved dispatch per job (`rouge-gpu`).

    python program/plan.py            # plan against the committed ledger
    python program/plan.py --json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "lightning_ai"))
import cost  # noqa: E402


def plan(lines: list[dict], remaining_usd: float, prices: dict) -> dict:
    run, wait, left = [], [], remaining_usd
    for line in sorted(lines, key=lambda l: l["priority"]):
        job = line["next"]
        price = (prices.get(job["machine"]) or {}).get("usd_per_hour")
        worst = round(cost.worst_case(job["machine"], job["hours"], price), 2)
        entry = {"line": line["id"], "job": job["name"], "machine": job["machine"], "hours": job["hours"], "worst_case_usd": worst}
        if not job.get("ready"):
            wait.append(entry | {"reason": job.get("blocked_by", "not ready")})
        elif worst > left:
            wait.append(entry | {"reason": f"budget: needs {worst:.2f} USD, {left:.2f} USD left under the ceiling"})
        else:
            left = round(left - worst, 2)
            run.append(entry)
    return {"remaining_usd": round(remaining_usd, 2), "parallel_now": run, "left_after_usd": left, "waiting": wait}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lines", type=Path, default=HERE / "lines.json")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    program = json.loads(args.lines.read_text())
    out = plan(program["lines"], cost.CEILING_USD - cost.committed(cost.load()), cost.live_prices())
    if args.json:
        print(json.dumps(out, indent=1))
        return
    print(f"under the ceiling: {out['remaining_usd']:.2f} USD")
    for j in out["parallel_now"]:
        print(f"  RUN   {j['line']:8s} {j['job']:18s} {j['machine']:9s} {j['hours']:>4} h  worst {j['worst_case_usd']:7.2f} USD")
    for j in out["waiting"]:
        print(f"  WAIT  {j['line']:8s} {j['job']:18s} {j['machine']:9s} {j['hours']:>4} h  worst {j['worst_case_usd']:7.2f} USD  ({j['reason']})")
    print(f"left after the parallel jobs: {out['left_after_usd']:.2f} USD")


if __name__ == "__main__":
    main()
