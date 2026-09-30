"""Paid Rouge training rung on Lightning AI, one owner-approved run at a time.

    python lightning_ai/train_session.py --rung 100m --run rouge-r1-100m-001 --machine T4_X_8 --max-hours 5.5 --interruptible

Machines (cost.TRAINING_MACHINES): one H100/H200, or a node of several small GPUs (T4_X_4/8, L4_X_4/8,
L40S_X_4) trained data-parallel with torchrun; the global batch in tokens is the same on every machine.
`--interruptible` uses Lightning's discounted interruptible capacity: checkpoints sync to the model
registry every 10 minutes, and a preempted job is relaunched and resumes exactly, until the deadline.

Runs from GitHub Actions in the protected environment "rouge-gpu" (the owner approves every run).
Guards, all before anything is billed:
1. TRAINING_READY.json is true (ready.py: 16 conditions with committed evidence);
2. the machine is a training machine and its live price (cheapest cloud account) is within its ceiling;
3. the worst case (hours left x live price + 5%) fits the 50 EUR ceiling together with every Rouge job
   already in the ledger (cost.py), and the teamspace's credit balance.
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

MODEL_NAME = {"100m": "rouge-r1-100m", "300m": "rouge-r1-300m", "1b": "rouge-r1-1b", "600m": "rouge-r1-600m",
              "2b-moe": "rouge-r1-2b-moe"}
BATCH_PER_GPU = {"T4": 4, "L4": 8, "L40S": 16, "A100_40GB": 16, "A100_80GB": 32, "H100": 32, "H200": 32, "B200": 32}   # sequences of max_seq per rank and micro-step
TERMINAL = ("ROUGE_PHASE DONE", "ROUGE_PHASE SEGMENT_END", "ROUGE_PHASE FAILED")


def plan(rung: str, batch: int, gpus: int = 1) -> dict:
    """Trainer arguments with the ladder's global batch (tokens) split over `gpus` ranks."""
    ladder = json.loads((ROOT / "configs/native/ladder-v1.json").read_text())
    r, seq = ladder["rungs"][rung], ladder["common"]["max_seq"]
    accum = max(1, r["batch_tokens"] // (batch * seq * gpus))
    return {"ROUGE_CONFIG": f"configs/native/rouge-v1-{rung}.json",
            "ROUGE_STEPS": str(int(r["tokens"] // (batch * accum * seq * gpus))),
            "ROUGE_BATCH": str(batch), "ROUGE_ACCUM": str(accum), "ROUGE_SEQ": str(seq), "ROUGE_LR": str(r["lr"])}


def best_offer(ts, machine: str, interruptible: bool) -> tuple[str | None, float | None]:
    """(cloud account, USD per hour) of the cheapest live offer of `machine` over the teamspace's cloud
    accounts; (None, None) when no account lists it. Account ids are used, never printed."""
    try:
        accounts = [a.id for a in ts._cloud_account_api.list_global_cloud_accounts(teamspace_id=ts.id)]
    except Exception:
        accounts = []
    for a in ts.cloud_accounts or []:
        a = getattr(a, "id", a)
        if a not in accounts:
            accounts.append(a)
    best = (None, None)
    for account in accounts:
        try:
            listed = ts.list_machines(cloud_account=account, machine=machine)
        except Exception:
            continue
        for m in listed:
            price = getattr(m, "interruptible_cost" if interruptible else "cost", None)
            if price and (best[1] is None or float(price) < best[1]):
                best = (account, float(price))
    return best


def preflight(args) -> float:
    ready = json.loads((ROOT / "TRAINING_READY.json").read_text()) if (ROOT / "TRAINING_READY.json").exists() else {}
    if ready.get("TRAINING_READY") is not True:
        raise SystemExit("TRAINING_READY is not true: run ready.py and fix every failing condition first")
    cost.worst_case(args.machine, args.max_hours)   # refuses a machine outside the training allowlist
    remaining = cost.CEILING_USD - cost.committed(cost.load(HERE / "ledger.json"))
    print(f"[train] {args.machine} for at most {args.max_hours} h; {remaining:.2f} USD left under the "
          f"{cost.CEILING_USD:.2f} USD ceiling (each launch is checked at its live price)", flush=True)
    return remaining


def launch(Job, Machine, args, sha: str, env: dict, hours: float, ledger: dict, script: str = "lightning_ai/train_job.sh"):
    """Start the job on the cheapest live offer that fits the ceiling and the balance; (job, worst case USD)."""
    for i, (ts, balance, project) in enumerate(lj.teamspaces()):
        account, price = best_offer(ts, args.machine, args.interruptible)
        if price is None:
            print(f"[train] teamspace {i}: {args.machine} is not offered {'interruptible' if args.interruptible else 'on demand'}",
                  flush=True)
            continue
        if price > cost.PAID_PRICE_CEILING[args.machine]:
            print(f"[train] teamspace {i}: live price {price} USD/h exceeds the ceiling {cost.PAID_PRICE_CEILING[args.machine]}",
                  flush=True)
            continue
        worst = cost.worst_case(args.machine, hours, price)
        cost.check(ledger, worst)   # 50 EUR ceiling over every Rouge job, at the live price
        if balance is not None and worst > float(balance) - lj.SAFETY_MARGIN:
            print(f"[train] teamspace {i}: worst case {worst:.2f} ({price} USD/h x {hours:.2f} h) exceeds its credit balance "
                  f"{float(balance):.2f} minus the margin", flush=True)
            continue
        print(f"[train] teamspace {i}: {args.machine} at {price} USD/h ({'interruptible' if args.interruptible else 'on demand'}), "
              f"worst case {worst:.2f} USD", flush=True)
        os.environ["LIGHTNING_CLOUD_PROJECT_ID"] = project.id
        try:
            job = Job.run(name=f"{args.run}-{int(time.time())}", machine=getattr(Machine, args.machine), cloud=account,
                          command=lj.bootstrap_command(sha, script), image="python:3.11-slim",
                          teamspace=ts, interruptible=args.interruptible, env=env)
            print(f"[train] teamspace {i} accepted the job", flush=True)
            return job, worst
        except Exception as e:
            print(f"[train] teamspace {i}: job creation refused ({str(e)[-60:]})", flush=True)
    return None, None


def run(args) -> int:
    from lightning_sdk import Job, Machine

    if not os.environ.get("LIGHTNING_API_KEY"):
        raise SystemExit("LIGHTNING_API_KEY is not set")
    sha = os.environ.get("GITHUB_SHA") or args.sha
    if not sha:
        raise SystemExit("commit SHA required")
    preflight(args)
    family, n = cost.gpus(args.machine)
    batch = args.batch or BATCH_PER_GPU[family]
    ledger_path = HERE / "ledger.json"
    ledger = lj.load_ledger(ledger_path)
    env = {"PYTHONUNBUFFERED": "1", "ROUGE_RUN": args.run, "ROUGE_CORPUS": args.corpus, "ROUGE_EXPECT_GPU": family.split("_")[0],   # as nvidia-smi names it (A100_40GB -> A100)
           "ROUGE_NPROC": str(n), "ROUGE_PEAK_TFLOPS": str(cost.GPU[family][0]), "ROUGE_MODEL_NAME": MODEL_NAME[args.rung],
           "ROUGE_SYNC_MIN": "10" if args.interruptible else "20", "ROUGE_OPTIMIZER": args.optimizer,
           "ROUGE_FP8": "1" if args.fp8 else "0", **plan(args.rung, batch, n)}
    if args.fp8 and family not in ("H100", "H200", "B200"):
        raise SystemExit(f"--fp8 needs an FP8 GPU; {args.machine} has none")
    # Jobs carry no teamspace credentials (probe 2026-09-30) and the model registry is the only store
    # that persists, so the job gets the key as job environment: it stays inside Lightning, is never
    # printed, and is used only by lightning_ai/storage.py for registry transfers.
    env["LIGHTNING_API_KEY"] = os.environ["LIGHTNING_API_KEY"]
    deadline = time.time() + args.max_hours * 3600
    out = ROOT / "results" / "runs" / args.run
    out.mkdir(parents=True, exist_ok=True)
    phases, result, code = [], None, 1
    for attempt in range(1, args.max_attempts + 1):
        hours = (deadline - time.time()) / 3600
        if hours < 0.75:
            print(f"[train] {hours:.2f} h left before the deadline: no further attempt", flush=True)
            break
        env["ROUGE_BUDGET_MIN"] = str(int(hours * 60 - 45))
        job, worst = launch(Job, Machine, args, sha, env, hours, ledger)
        if job is None:
            raise SystemExit("no teamspace accepted the training job (credits, GPU access, price or permissions)")
        code = lj.record_and_wait(job, ledger, ledger_path, args.machine, hours, worst, results=None,
                                  name=f"{args.run}#{attempt}", prefix="ROUGE_TRAIN")
        lines = (job.logs or "").splitlines()
        phases += [l for l in lines if l.startswith("ROUGE_PHASE")]
        result = next((l[len("ROUGE_TRAIN "):] for l in reversed(lines) if l.startswith("ROUGE_TRAIN ")), result)
        for l in lines:
            if l.startswith("ROUGE_PHASE"):
                print("[job]", l, flush=True)
        if any(l.startswith(TERMINAL) for l in lines) or not args.interruptible:
            break
        print(f"[train] attempt {attempt} ended without a terminal phase (interrupted): relaunching; the job resumes "
              f"from the last synced checkpoint", flush=True)
    (out / "phases.log").write_text("\n".join(phases) + "\n")
    if result:
        (out / "result.json").write_text(json.dumps(json.loads(result), indent=1) + "\n")
    return code


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rung", choices=sorted(MODEL_NAME), required=True)
    parser.add_argument("--run", required=True, help="lineage name, e.g. rouge-r1-100m-001")
    parser.add_argument("--machine", choices=cost.TRAINING_MACHINES, default="H100")
    parser.add_argument("--max-hours", type=float, required=True)
    parser.add_argument("--interruptible", action="store_true", help="discounted capacity; preempted jobs relaunch and resume")
    parser.add_argument("--max-attempts", type=int, default=6)
    parser.add_argument("--optimizer", choices=["adamw", "muon"], default="adamw", help="muon only after its ablation wins")
    parser.add_argument("--fp8", action="store_true", help="FP8 matmuls (H100/H200/B200) only after a loss-parity check")
    parser.add_argument("--corpus", default="pretrain-v3")
    parser.add_argument("--batch", type=int, default=0, help="sequences per GPU and micro-step (0: by GPU family)")
    parser.add_argument("--sha")
    args = parser.parse_args()
    if not 0 < args.max_hours <= 5.75:
        raise SystemExit("--max-hours must be in (0, 5.75]: a GitHub job lasts at most 6 hours")
    sys.exit(run(args))


if __name__ == "__main__":
    main()
