"""Paid Rouge training rung on Lightning AI (H100 or H200), one owner-approved job at a time.

    python lightning_ai/train_session.py --rung 100m --run rouge-r1-100m-001 --machine H100 --max-hours 3

Runs from GitHub Actions in the protected environment "rouge-gpu" (the owner approves every run).
Guards, all before anything is billed:
1. TRAINING_READY.json is true (ready.py: 16 conditions with committed evidence);
2. the machine is a training machine (H100/H200) and the worst case (max hours x price ceiling)
   fits the 50 EUR ceiling together with every Rouge job already in the ledger (cost.py);
3. the worst case fits the teamspace's credit balance.
The job (train_job.sh) downloads the hash-verified corpus and any earlier checkpoint of this run
from the teamspace drive, trains with a time budget, syncs checkpoints back while it runs, uploads
the run and publishes the model to the teamspace model registry. Storage is the registry (the
teamspace drive answered 404 and job mounts do not persist); the job gets the key as job env. This process stops the job at its
deadline and records the actual cost. Weights never leave the private teamspace.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

import cost  # noqa: E402
import job as lj  # noqa: E402

MODEL_NAME = {"100m": "rouge-r1-100m", "300m": "rouge-r1-300m", "1b": "rouge-r1-1b"}


def plan(rung: str, batch: int) -> dict:
    ladder = json.loads((ROOT / "configs/native/ladder-v1.json").read_text())
    r, seq = ladder["rungs"][rung], ladder["common"]["max_seq"]
    accum = max(1, r["batch_tokens"] // (batch * seq))
    return {"ROUGE_CONFIG": f"configs/native/rouge-v1-{rung}.json", "ROUGE_STEPS": str(int(r["tokens"] // (batch * accum * seq))),
            "ROUGE_BATCH": str(batch), "ROUGE_ACCUM": str(accum), "ROUGE_SEQ": str(seq), "ROUGE_LR": str(r["lr"])}


def preflight(args) -> float:
    ready = json.loads((ROOT / "TRAINING_READY.json").read_text()) if (ROOT / "TRAINING_READY.json").exists() else {}
    if ready.get("TRAINING_READY") is not True:
        raise SystemExit("TRAINING_READY is not true: run ready.py and fix every failing condition first")
    worst = cost.worst_case(args.machine, args.max_hours)
    remaining = cost.check(cost.load(HERE / "ledger.json"), worst)
    print(f"[train] {args.machine} for at most {args.max_hours} h: worst case {worst:.2f} USD; "
          f"{remaining:.2f} USD would remain under the {cost.CEILING_USD:.2f} USD ceiling", flush=True)
    return worst


def run(args) -> int:
    from lightning_sdk import Job, Machine

    if not os.environ.get("LIGHTNING_API_KEY"):
        raise SystemExit("LIGHTNING_API_KEY is not set")
    sha = os.environ.get("GITHUB_SHA") or args.sha
    if not sha:
        raise SystemExit("commit SHA required")
    worst = preflight(args)
    ledger_path = HERE / "ledger.json"
    ledger = lj.load_ledger(ledger_path)
    env = {"PYTHONUNBUFFERED": "1", "ROUGE_RUN": args.run, "ROUGE_CORPUS": args.corpus, "ROUGE_EXPECT_GPU": args.machine,
           "ROUGE_MODEL_NAME": MODEL_NAME[args.rung], "ROUGE_BUDGET_MIN": str(int(args.max_hours * 60 - 45)),
           **plan(args.rung, args.batch)}
    # Jobs carry no teamspace credentials (probe 2026-09-30) and the model registry is the only store
    # that persists, so the job gets the key as job environment: it stays inside Lightning, is never
    # printed, and is used only by lightning_ai/storage.py for registry transfers.
    env["LIGHTNING_API_KEY"] = os.environ["LIGHTNING_API_KEY"]
    job = None
    for i, (ts, balance, project) in enumerate(lj.teamspaces()):
        if balance is not None and worst > float(balance) - lj.SAFETY_MARGIN:
            print(f"[train] teamspace {i}: worst case {worst:.2f} exceeds its credit balance {float(balance):.2f} minus the margin",
                  flush=True)
            continue
        os.environ["LIGHTNING_CLOUD_PROJECT_ID"] = project.id
        try:
            job = Job.run(name=f"{args.run}-{int(time.time())}", machine=getattr(Machine, args.machine),
                          command=lj.bootstrap_command(sha, "lightning_ai/train_job.sh"), image="python:3.11-slim",
                          teamspace=ts, interruptible=False, env=env)
            print(f"[train] teamspace {i} accepted the job", flush=True)
            break
        except Exception as e:
            print(f"[train] teamspace {i}: job creation refused ({str(e)[-60:]})", flush=True)
    if job is None:
        raise SystemExit("no teamspace accepted the training job (credits, GPU access or permissions)")
    code = lj.record_and_wait(job, ledger, ledger_path, args.machine, args.max_hours, worst, results=None, name=args.run,
                              prefix="ROUGE_TRAIN")
    lines = (job.logs or "").splitlines()
    out = ROOT / "results" / "runs" / args.run
    out.mkdir(parents=True, exist_ok=True)
    (out / "phases.log").write_text("\n".join(l for l in lines if l.startswith("ROUGE_PHASE")) + "\n")
    result = next((l[len("ROUGE_TRAIN "):] for l in reversed(lines) if l.startswith("ROUGE_TRAIN ")), None)
    if result:
        (out / "result.json").write_text(json.dumps(json.loads(result), indent=1) + "\n")
    for l in lines:
        if l.startswith("ROUGE_PHASE"):
            print("[job]", l, flush=True)
    return code


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rung", choices=sorted(MODEL_NAME), required=True)
    parser.add_argument("--run", required=True, help="lineage name, e.g. rouge-r1-100m-001")
    parser.add_argument("--machine", choices=sorted(cost.PAID_PRICE_CEILING), default="H100")
    parser.add_argument("--max-hours", type=float, required=True)
    parser.add_argument("--corpus", default="pretrain-v1")
    parser.add_argument("--batch", type=int, default=32)
    parser.add_argument("--sha")
    args = parser.parse_args()
    if not 0 < args.max_hours <= 5.75:
        raise SystemExit("--max-hours must be in (0, 5.75]: a GitHub job lasts at most 6 hours")
    sys.exit(run(args))


if __name__ == "__main__":
    main()
