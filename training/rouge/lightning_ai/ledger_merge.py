"""Merge a job's ledger into the branch's ledger in place (entries keyed by name and start; a finished
entry wins over a running one), so concurrent workflows never drop each other's spend.

    python lightning_ai/ledger_merge.py BRANCH_LEDGER OUR_LEDGER
"""

import json
import sys
from pathlib import Path


def merge(base: dict, ours: dict) -> dict:
    out = {"schema": base.get("schema") or ours.get("schema") or "rouge.lightning-ledger/1", "months": {}}
    for month in sorted(set(base.get("months", {})) | set(ours.get("months", {}))):
        jobs = {}
        for src in (base, ours):
            for j in src.get("months", {}).get(month, {}).get("jobs", []):
                key = (j.get("name"), j.get("started"))
                if key not in jobs or (jobs[key].get("cost_usd") is None and j.get("cost_usd") is not None):
                    jobs[key] = j
        out["months"][month] = {"jobs": sorted(jobs.values(), key=lambda j: j.get("started") or "")}
    return out


if __name__ == "__main__":
    base_path, ours_path = Path(sys.argv[1]), Path(sys.argv[2])
    base = json.loads(base_path.read_text()) if base_path.exists() else {}
    base_path.write_text(json.dumps(merge(base, json.loads(ours_path.read_text())), indent=1) + "\n")
