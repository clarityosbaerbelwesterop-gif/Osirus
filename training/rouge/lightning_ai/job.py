"""Lightning AI jobs for Rouge research runs, inside the owner's free monthly credits.

Owner decision (2026-09-30): Lightning is used only within the free credits
(15 per month), on small GPUs (T4/L4) or CPU machines, never H100/H200 or
other large GPUs. Production training runs on RunPod (training/rouge/runpod).

    python training/rouge/lightning_ai/job.py probe [--submit-test CPU|T4|L4]
    python training/rouge/lightning_ai/job.py run --name NAME --machine L4_X_4 --max-hours 3 \
        --script SCRIPT.sh --ledger training/rouge/lightning_ai/ledger.json --results runs.jsonl

Authentication: LIGHTNING_API_KEY (the repository secret LIGHTNING_AI_API_KEY,
mapped by the workflow). Nothing here prints the key, the account name or a
teamspace name (the repository is public).

Guards, all checked before a job is created:
- the machine is on the allowlist (no large GPUs);
- worst case = max hours x a conservative price per machine-hour; the job is
  refused when the month's recorded spend plus the worst case would exceed
  the free credits minus a safety margin;
- the job is stopped at its deadline by this process (Job.wait with
  stop_on_timeout) and the actual cost is written to the ledger.

A job downloads this repository at the exact commit from GitHub (public),
installs its Python packages and runs the given script. It receives no
secrets. Results come back as `ROUGE_RUN {json}` lines in the job log.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

FREE_CREDITS_PER_MONTH = 15.0        # USD-equivalent credits (owner decision: free credits only)
SAFETY_MARGIN = 1.0
# Conservative ceilings per machine-hour (published on-demand prices are lower: T4 about $0.19/h,
# L4 about $0.48/h per GPU); used only for the worst-case check, the ledger records actual cost.
PRICE_CEILING_PER_HOUR = {
    "CPU": 0.10, "CPU_X_4": 0.30, "CPU_X_8": 0.60, "DATA_PREP": 0.60,
    "T4": 0.30, "T4_X_4": 1.20, "L4": 0.60, "L4_X_2": 1.20, "L4_X_4": 2.40,
}
REPO = os.environ.get("GITHUB_REPOSITORY", "clarityosbaerbelwesterop-gif/Osirus")
PACKAGES = "torch==2.14.0 numpy tokenizers datasets huggingface_hub"


def month() -> str:
    return time.strftime("%Y-%m", time.gmtime())


def load_ledger(path: Path) -> dict:
    return json.loads(path.read_text()) if path.exists() else {"schema": "rouge.lightning-ledger/1", "months": {}}


def spent(ledger: dict, m: str) -> float:
    return sum(j.get("cost_usd") or j.get("worst_case_usd", 0.0) for j in ledger["months"].get(m, {}).get("jobs", []))


def check_budget(ledger: dict, machine: str, max_hours: float) -> float:
    if machine not in PRICE_CEILING_PER_HOUR:
        raise SystemExit(f"machine {machine} is not allowed on Lightning (free credits: T4/L4/CPU only)")
    worst = PRICE_CEILING_PER_HOUR[machine] * max_hours
    used = spent(ledger, month())
    if used + worst > FREE_CREDITS_PER_MONTH - SAFETY_MARGIN:
        raise SystemExit(f"refused: {used:.2f} spent this month + worst case {worst:.2f} exceeds "
                         f"{FREE_CREDITS_PER_MONTH - SAFETY_MARGIN:.2f} of free credits")
    print(f"[lightning] budget ok: {used:.2f} spent this month, worst case {worst:.2f} "
          f"(free credits {FREE_CREDITS_PER_MONTH:.0f}, margin {SAFETY_MARGIN:.0f})", flush=True)
    return worst


def teamspace():
    """The authenticated user's first teamspace (names are resolved, never printed)."""
    from lightning_sdk import Teamspace
    from lightning_sdk.api.teamspace_api import TeamspaceApi
    from lightning_sdk.api.user_api import UserApi

    user = UserApi()._client.auth_service_get_user()
    spaces = TeamspaceApi().list_teamspaces(owner_id=user.id) or []
    if not spaces:
        raise SystemExit("authenticated, but the account owns no teamspace")
    os.environ["LIGHTNING_USERNAME"] = user.username
    os.environ["LIGHTNING_TEAMSPACE"] = spaces[0].name
    return Teamspace(name=spaces[0].name, user=user.username), len(spaces)


def bootstrap_command(sha: str, script: str) -> str:
    """Shell command of a job: fetch the repository at `sha`, install packages, run `script` from training/rouge."""
    url = f"https://codeload.github.com/{REPO}/tar.gz/{sha}"
    return " && ".join([
        "set -e",
        "mkdir -p /tmp/repo",
        f"python -c \"import io,tarfile,urllib.request; tarfile.open(fileobj=io.BytesIO(urllib.request.urlopen('{url}').read())).extractall('/tmp/repo')\"",
        "cd /tmp/repo/*/training/rouge",
        f"python -m pip install -q {PACKAGES}",
        "nvidia-smi --query-gpu=name,memory.total --format=csv || true",
        f"bash {script}",
    ])


def probe(args) -> None:
    if not os.environ.get("LIGHTNING_API_KEY"):
        raise SystemExit("LIGHTNING_API_KEY is not set")
    ts, n = teamspace()
    print(f"[lightning] authenticated; {n} teamspace(s) owned; using the first", flush=True)
    for m in ("T4", "L4"):
        try:
            avail = ts.list_machines(machine=m)
            print(f"[lightning] machine {m}: {'available' if avail else 'no capacity listed'}", flush=True)
        except Exception as e:  # listing is informational
            print(f"[lightning] machine {m}: listing failed ({type(e).__name__})", flush=True)
    if args.submit_test:
        from lightning_sdk import Job, Machine

        ledger_path = Path(args.ledger)
        ledger = load_ledger(ledger_path)
        worst = check_budget(ledger, args.submit_test, 0.25)
        cmd = "nvidia-smi --query-gpu=name --format=csv || echo no-gpu; python -c \"import sys; print('ROUGE_PROBE ok', sys.version.split()[0])\""
        job = Job.run(name=f"rouge-probe-{int(time.time())}", machine=getattr(Machine, args.submit_test), command=cmd,
                      image="python:3.11-slim", teamspace=ts, interruptible=False)
        record_and_wait(job, ledger, ledger_path, args.submit_test, 0.25, worst, results=None, name="probe")


def record_and_wait(job, ledger, ledger_path: Path, machine: str, max_hours: float, worst: float, results, name: str) -> int:
    start = time.time()
    entry = {"name": name, "machine": machine, "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
             "max_hours": max_hours, "worst_case_usd": round(worst, 3), "cost_usd": None, "status": "running"}
    ledger["months"].setdefault(month(), {"jobs": []})["jobs"].append(entry)
    ledger_path.write_text(json.dumps(ledger, indent=1) + "\n")
    try:
        job.wait(interval=60, timeout=max_hours * 3600, stop_on_timeout=True)
    except Exception as e:
        print(f"[lightning] wait ended: {type(e).__name__}: {e}", flush=True)
        try:
            job.stop()
        except Exception:
            pass
    status = str(job.status)
    logs = ""
    try:
        logs = job.logs or ""
    except Exception as e:
        print(f"[lightning] logs unavailable: {type(e).__name__}", flush=True)
    lines = logs.splitlines()
    for line in lines[-80:]:
        if not line.startswith("ROUGE_RUN "):
            print("[job]", line[:400], flush=True)
    runs = [l[len("ROUGE_RUN "):] for l in lines if l.startswith("ROUGE_RUN ")]
    for l in lines:
        if l.startswith("ROUGE_PROBE"):
            print("[job]", l, flush=True)
    if results:
        with open(results, "a") as f:
            for r in runs:
                f.write(r + "\n")
    cost = None
    for _ in range(5):
        try:
            cost = float(job.total_cost)
            break
        except Exception:
            time.sleep(10)
    entry.update({"status": status, "seconds": round(time.time() - start), "cost_usd": cost, "runs": len(runs)})
    ledger_path.write_text(json.dumps(ledger, indent=1) + "\n")
    print(f"[lightning] job {name}: {status}, {entry['seconds']} s, cost {cost if cost is not None else 'unknown'}, "
          f"{len(runs)} run record(s); month spend now {spent(ledger, month()):.2f}", flush=True)
    return 0 if "Completed" in status else 1


def run(args) -> None:
    from lightning_sdk import Job, Machine

    if not os.environ.get("LIGHTNING_API_KEY"):
        raise SystemExit("LIGHTNING_API_KEY is not set")
    sha = os.environ.get("GITHUB_SHA") or args.sha
    if not sha:
        raise SystemExit("commit SHA required (GITHUB_SHA or --sha)")
    ledger_path = Path(args.ledger)
    ledger = load_ledger(ledger_path)
    worst = check_budget(ledger, args.machine, args.max_hours)
    ts, _ = teamspace()
    job = Job.run(name=args.name, machine=getattr(Machine, args.machine), command=bootstrap_command(sha, args.script),
                  image="python:3.11-slim", teamspace=ts, interruptible=False,
                  env={"PYTHONUNBUFFERED": "1", **dict(kv.split("=", 1) for kv in args.env)})
    print(f"[lightning] job {args.name} submitted on {args.machine} at {sha[:12]}", flush=True)
    sys.exit(record_and_wait(job, ledger, ledger_path, args.machine, args.max_hours, worst, args.results, args.name))


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("probe")
    p.add_argument("--submit-test", choices=["CPU", "T4", "L4"])
    p.add_argument("--ledger", default=str(Path(__file__).with_name("ledger.json")))
    r = sub.add_parser("run")
    r.add_argument("--name", required=True)
    r.add_argument("--machine", required=True)
    r.add_argument("--max-hours", type=float, required=True)
    r.add_argument("--script", required=True, help="path relative to training/rouge, run with bash inside the job")
    r.add_argument("--ledger", default=str(Path(__file__).with_name("ledger.json")))
    r.add_argument("--results", help="append ROUGE_RUN records here")
    r.add_argument("--sha")
    r.add_argument("--env", action="append", default=[], help="KEY=VALUE passed to the job (never a secret)")
    args = parser.parse_args()
    probe(args) if args.cmd == "probe" else run(args)


if __name__ == "__main__":
    main()
