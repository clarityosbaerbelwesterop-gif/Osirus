#!/usr/bin/env python3
"""Research controller: record a finished experiment, apply its gate, pick
the next approved free experiment.

    python lab/controller.py record --prereg experiments/r1_01b.json --results DIR --run-id N --code-sha SHA
    python lab/controller.py next

`record` writes one registry row per model x seed and one row for the
experiment with its pre-registered decision (experiments/registry.json).
The decision is the one the experiment's own runner computed from its
pre-registration; the controller never re-defines success.

`next` prints the id of the next experiment in experiments/queue.json that
is approved, costs $0, routes to tier 0-2 and whose predecessors are
recorded, or nothing. The controller cannot spend money, rent GPUs, change
release claims or touch main: it only reads and writes files in this
directory, and the workflow pushes them to the research branch.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from lab import compute  # noqa: E402

REGISTRY = ROOT / "experiments" / "registry.json"
QUEUE = ROOT / "experiments" / "queue.json"


def load(path: Path, default):
    return json.loads(path.read_text()) if path.exists() else default


def dataset_hash(prereg: dict) -> str:
    """sha256 over the benchmark generator sources the experiment uses."""
    h = hashlib.sha256()
    for rel in sorted(prereg.get("benchmarks", ["benchmarks/microbench.py"])):
        h.update((ROOT / rel).read_bytes())
    return h.hexdigest()


def record(args) -> None:
    prereg = json.loads(Path(args.prereg).read_text())
    exp_id = prereg["id"]
    results = Path(args.results)
    summary = json.loads((results / "summary.json").read_text())
    decision = summary.get("decision", {})
    route = compute.route(prereg)
    data = dataset_hash(prereg)
    rows = [r for r in load(REGISTRY, []) if r["experiment_id"] != exp_id]
    runs = [json.loads(p.read_text()) for p in sorted(results.glob("*-seed*.json"))]
    for run in runs:
        rows.append({
            "experiment_id": exp_id, "run": f"{run['model']}-seed{run['seed']}", "parent": prereg.get("follows"),
            "hypothesis": prereg.get("question"), "architecture": run["model"],
            "config": prereg["setup"]["models"].get(run["model"]), "seed": run["seed"],
            "dataset_hash": data, "code_sha": args.code_sha, "parameter_count": run["parameters"],
            "flop_estimate": run.get("flops_effective", run.get("flops_per_example")),
            "hardware": run.get("hardware", args.hardware), "duration_s": run["train_seconds"],
            "cost_usd": 0.0 if route["tier"] < 3 else None, "ci_run": args.run_id,
            "metrics": {"id": run["id"], "ood": run["ood"], **({"extra": run["extra"]} if "extra" in run else {})},
            "result": None, "decision": None,
        })
    rows.append({
        "experiment_id": exp_id, "run": "experiment", "parent": prereg.get("follows"),
        "hypothesis": prereg.get("question"), "architecture": list(prereg["setup"]["models"]),
        "seed": prereg["setup"]["seeds"], "dataset_hash": data, "code_sha": args.code_sha,
        "parameter_count": prereg["setup"].get("parameters"), "flop_estimate": route["estimate"]["train_flops_per_run"],
        "hardware": f"tier {route['tier']}: {route['runs_on']}", "duration_s": sum(r["train_seconds"] for r in runs),
        "cost_usd": 0.0, "ci_run": args.run_id, "metrics": {k: v for k, v in summary.items() if k != "decision"},
        "result": decision.get("result"), "decision": decision,
        "recorded": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })
    REGISTRY.write_text(json.dumps(rows, indent=1) + "\n")
    print(json.dumps({"experiment": exp_id, "result": decision.get("result"), "runs": len(runs)}))


def void(args) -> None:
    """Record an experiment that was stopped because its design was invalid."""
    prereg = json.loads(Path(args.prereg).read_text())
    rows = [r for r in load(REGISTRY, []) if r["experiment_id"] != prereg["id"]]
    rows.append({
        "experiment_id": prereg["id"], "run": "experiment", "parent": prereg.get("follows"),
        "hypothesis": prereg.get("question"), "architecture": list(prereg["setup"]["models"]),
        "seed": prereg["setup"]["seeds"], "dataset_hash": dataset_hash(prereg), "code_sha": args.code_sha,
        "parameter_count": prereg["setup"].get("parameters"), "flop_estimate": None, "hardware": "tier 0: ubuntu-latest",
        "duration_s": None, "cost_usd": 0.0, "ci_run": args.run_id, "metrics": {}, "result": "VOID",
        "decision": {"result": "VOID", "reason": args.reason},
        "recorded": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })
    REGISTRY.write_text(json.dumps(rows, indent=1) + "\n")
    print(json.dumps({"experiment": prereg["id"], "result": "VOID"}))


def next_experiment() -> str | None:
    done = {r["experiment_id"].lower().replace(".", "_") for r in load(REGISTRY, []) if r["run"] == "experiment"}
    for item in load(QUEUE, []):
        if item["id"] in done or not item.get("approved") or item.get("cost_usd", 0) != 0:
            continue
        if not all(dep in done for dep in item.get("after", [])):
            continue
        prereg = ROOT / "experiments" / f"{item['id']}.json"
        if not prereg.exists():
            continue
        if compute.route(json.loads(prereg.read_text()))["tier"] >= 3:
            continue
        return item["id"]
    return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["record", "void", "next"])
    parser.add_argument("--reason")
    parser.add_argument("--prereg")
    parser.add_argument("--results")
    parser.add_argument("--run-id", default="local")
    parser.add_argument("--code-sha", default="local")
    parser.add_argument("--hardware", default="unknown")
    args = parser.parse_args()
    if args.command == "record":
        record(args)
    elif args.command == "void":
        void(args)
    else:
        print(next_experiment() or "")


if __name__ == "__main__":
    main()
