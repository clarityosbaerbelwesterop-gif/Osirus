"""Lightning AI jobs for Rouge research runs, inside the owner's free monthly credits.

Owner decisions (2026-09-30): research jobs (tournament, dry runs) use small
machines (T4/L4/CPU) within a monthly credit cap; Lightning also runs the paid
training rungs on H100/H200 (train_session.py, owner-approved runs only),
stores data and checkpoints in the teamspace drive and keeps models in the
teamspace model registry. RunPod is not used (archive/runpod).

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
secrets, except the Lightning key itself for jobs that store data in the
teamspace model registry (--pass-key: prepare and training jobs); the key
stays inside Lightning and is never printed. Results come back as
`ROUGE_RUN {json}` lines in the job log.
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
PRICE_CEILING_PER_HOUR = {   # about 1.25x the live on-demand price of 2026-09-30 (results/lightning/machines.json)
    "CPU": 0.45, "CPU_X_4": 0.45, "CPU_X_8": 0.65, "DATA_PREP": 1.85,
    "T4": 0.90, "T4_X_4": 4.40, "L4": 1.00, "L4_X_2": 3.00, "L4_X_4": 6.00,
}
REPO = os.environ.get("GITHUB_REPOSITORY", "clarityosbaerbelwesterop-gif/Osirus")
PACKAGES = "torch==2.14.0 numpy tokenizers datasets huggingface_hub lightning-sdk"


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


MEMBERSHIPS: dict = {}   # counts and free-credit flags of the last teamspaces() call (no names)


def teamspaces() -> list:
    """Teamspaces this key may read, richest first, as (Teamspace, balance) (names are resolved, never printed).

    A key can be scoped: memberships it is not authorized for answer 403 and are skipped.
    """
    from lightning_sdk import Teamspace
    from lightning_sdk.api.teamspace_api import TeamspaceApi
    from lightning_sdk.api.user_api import UserApi

    users = UserApi()
    user = users._client.auth_service_get_user()
    memberships = users._get_all_teamspace_memberships(user.id) or []
    api, usable, refused = TeamspaceApi(), [], 0
    for m in memberships:
        try:
            usable.append((api._get_teamspace_by_id(m.project_id), m))
        except Exception:
            refused += 1
    print(f"[lightning] {len(memberships)} teamspace membership(s): {len(usable)} readable with this key, {refused} refused",
          flush=True)
    MEMBERSHIPS.update({"total": len(memberships), "readable": len(usable), "refused_by_key_scope": refused,
                        "free_credits_enabled": [getattr(m, "free_credits_enabled", None) for _, m in usable]})
    if not usable:
        raise SystemExit("the key authenticates but may use no teamspace")
    usable.sort(key=lambda pm: -float(getattr(pm[1], "balance", 0) or 0))
    out = []
    for i, (project, m) in enumerate(usable):
        roles = [getattr(r, "name", None) or getattr(r, "display_name", None) for r in (getattr(m, "roles", None) or [])]
        owner_kind = "organization" if "organization" in str(getattr(project, "owner_type", "")).lower() else "user"
        print(f"[lightning] teamspace {i}: owner {owner_kind}, roles {roles or 'not reported'}, balance "
              f"{getattr(m, 'balance', None)}, free credits enabled {getattr(m, 'free_credits_enabled', None)}", flush=True)
        if owner_kind == "organization":
            from lightning_sdk.api.org_api import OrgApi

            name = f"{OrgApi()._get_org_by_id(project.owner_id).name}/{project.name}"
        else:
            name = f"{user.username}/{project.name}"
        out.append((Teamspace(name=name), getattr(m, "balance", None), project))
    return out


def teamspace():
    ts, balance, project = teamspaces()[0]
    os.environ["ROUGE_LIGHTNING_BALANCE"] = "" if balance is None else str(balance)
    return ts, 1


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
    print(f"[lightning] authenticated; {n} usable teamspace(s)", flush=True)
    summary = {"checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "balance": os.environ.get("ROUGE_LIGHTNING_BALANCE") or None}
    for m in ("T4", "L4", "A100", "H100", "H200"):
        try:
            avail = ts.list_machines(machine=m)
            summary[f"{m.lower()}_listed"] = bool(avail)
            print(f"[lightning] machine {m}: {'listed' if avail else 'no capacity listed'}", flush=True)
        except Exception as e:  # listing is informational
            summary[f"{m.lower()}_listed"] = False
            print(f"[lightning] machine {m}: listing failed ({type(e).__name__})", flush=True)
    summary["memberships"] = dict(MEMBERSHIPS)
    table = machine_table(ts)
    if args.out and table:
        Path(args.out).with_name("machines.json").write_text(json.dumps(
            {"checked_at": summary["checked_at"], "machines": table}, indent=1) + "\n")
    summary["training_machine"] = cheapest_training_machine(table) or ("H100" if summary.get("h100_listed") else "H200")
    summary["training_machines_listed"] = sorted(r["name"] for r in table if r["name"] in cost_module().TRAINING_MACHINES)
    if args.storage:
        summary["storage_ok"] = storage_roundtrip(ts)
        summary["model_registry_ok"] = bool(os.environ.get("ROUGE_MODEL_REGISTRY_OK"))
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps(summary, indent=1) + "\n")
    if args.submit_test:
        from lightning_sdk import Job, Machine

        ledger_path = Path(args.ledger)
        ledger = load_ledger(ledger_path)
        worst = check_budget(ledger, args.submit_test, 0.25)
        balance = os.environ.get("ROUGE_LIGHTNING_BALANCE")
        if balance and worst > float(balance) - SAFETY_MARGIN:
            raise SystemExit(f"refused: worst case {worst:.2f} exceeds the credit balance {float(balance):.2f} minus the margin")
        sha = os.environ.get("GITHUB_SHA")
        tag = str(int(time.time()))
        for mode in ("write", "read"):
            cmd = (bootstrap_command(sha, "lightning_ai/probe_job.sh").replace(f"python -m pip install -q {PACKAGES}", "true")
                   if sha else "nvidia-smi --query-gpu=name --format=csv || echo no-gpu")
            job = Job.run(name=f"rouge-probe-{mode}-{tag}", machine=getattr(Machine, args.submit_test), command=cmd,
                          image="python:3.11-slim", teamspace=ts, interruptible=False,
                          env={"ROUGE_PROBE_MODE": mode, "ROUGE_PROBE_TAG": tag})
            record_and_wait(job, ledger, ledger_path, args.submit_test, 0.25, worst, results=None, name=f"probe-{mode}",
                            prefix="ROUGE_PROBE")
            for line in (job.logs or "").splitlines():
                if line.startswith("ROUGE_PROBE"):
                    print("[job]", line[:300], flush=True)
                    if line.startswith("ROUGE_PROBE persisted"):
                        summary["job_persistent_path"] = line.split()[2]
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps(summary, indent=1) + "\n")


def cost_module():
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import cost

    return cost


def machine_table(ts) -> list:
    """Every machine the teamspace can start now, with live on-demand and interruptible prices (no job, no cost)."""
    from lightning_sdk import Machine

    import lightning_sdk.machine as sdk_machine

    by_slug = {m.slug: name for name, m in vars(Machine).items() if isinstance(m, Machine)}
    for alias, slug in getattr(sdk_machine, "_SLUG_ALIASES", {}).items():   # e.g. bare-metal H200 on a second account
        if slug in by_slug:
            by_slug.setdefault(alias, by_slug[slug])
    rows = {}
    try:
        listed = ts.list_machines()
    except Exception as e:
        print(f"[lightning] machine table unavailable: {type(e).__name__}", flush=True)
        return []
    for m in listed:
        name = by_slug.get(getattr(m, "slug", None))
        row = {"name": name, "slug": getattr(m, "slug", None), "family": getattr(m, "family", None),
               "gpus": getattr(m, "accelerator_count", None), "usd_per_hour": getattr(m, "cost", None),
               "interruptible_usd_per_hour": getattr(m, "interruptible_cost", None) or None}   # 0: not offered
        key = name or row["slug"]
        prev = rows.get(key)
        if prev is None or (row["usd_per_hour"] or 1e9) < (prev["usd_per_hour"] or 1e9):
            rows[key] = row   # several cloud accounts can list one machine: keep the cheapest
    table = sorted(rows.values(), key=lambda r: (r["family"] or "", r["gpus"] or 0))
    for r in table:
        print(f"[lightning] {r['name'] or r['slug']}: {r['gpus']} GPU, {r['usd_per_hour']} USD/h on demand, "
              f"{r['interruptible_usd_per_hour']} USD/h interruptible", flush=True)
    return table


def cheapest_training_machine(table: list) -> str | None:
    """Lowest live price per effective TFLOP among the training machines that fit their price ceiling."""
    cost = cost_module()
    best = None
    for r in table:
        name, price = r.get("name"), r.get("usd_per_hour")
        if name in cost.TRAINING_MACHINES and price and float(price) <= cost.PAID_PRICE_CEILING[name]:
            key = float(price) / (cost.PEAK_TFLOPS[name] * cost.mfu(name))
            if best is None or key < best[0]:
                best = (key, name)
    return best[1] if best else None


def storage_roundtrip(ts, remote: str = "rouge/probe") -> bool:
    """Try the teamspace drive on every cloud account, then the model registry; hash-compare every round trip."""
    import hashlib
    import tempfile

    src = Path(tempfile.mkdtemp())
    payload = os.urandom(1 << 16)
    (src / "blob.bin").write_bytes(payload)
    digest = hashlib.sha256(payload).hexdigest()
    ok_any = False
    try:
        accounts = ts.cloud_accounts
    except Exception as e:
        accounts = []
        print(f"[lightning] cloud accounts: listing failed ({type(e).__name__})", flush=True)
    print(f"[lightning] cloud accounts bound to the teamspace: {len(accounts)} (default set: {bool(ts.default_cloud_account)})",
          flush=True)
    for i, account in enumerate(accounts or [None]):
        dst = Path(tempfile.mkdtemp())
        path = f"{remote}/{int(time.time())}-{i}"
        try:
            ts.upload_folder(str(src), remote_path=path, progress_bar=False, cloud_account=account)
            ts.download_folder(path, target_path=str(dst), cloud_account=account)
            got = next(dst.rglob("blob.bin"), None)
            ok = got is not None and hashlib.sha256(got.read_bytes()).hexdigest() == digest
            print(f"[lightning] drive round trip on cloud account {i}: {'ok' if ok else 'MISMATCH'}", flush=True)
            ok_any |= ok
        except Exception as e:
            print(f"[lightning] drive round trip on cloud account {i} failed: {type(e).__name__}: {str(e)[-100:]}", flush=True)
    try:
        dst = Path(tempfile.mkdtemp())
        ts.upload_model(str(src / "blob.bin"), name="rouge-probe", version=str(int(time.time())), progress_bar=False)
        ts.download_model("rouge-probe", download_dir=str(dst), progress_bar=False)
        got = next(dst.rglob("blob.bin"), None)
        ok = got is not None and hashlib.sha256(got.read_bytes()).hexdigest() == digest
        print(f"[lightning] model registry round trip: {'ok' if ok else 'MISMATCH'}", flush=True)
        os.environ["ROUGE_MODEL_REGISTRY_OK"] = "1" if ok else ""
    except Exception as e:
        print(f"[lightning] model registry round trip failed: {type(e).__name__}: {str(e)[-100:]}", flush=True)
    return ok_any


def record_and_wait(job, ledger, ledger_path: Path, machine: str, max_hours: float, worst: float, results, name: str,
                    prefix: str = "ROUGE_RUN ") -> int:
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
        if not line.startswith(prefix):
            print("[job]", line[:400], flush=True)
    runs = [l[len(prefix):] for l in lines if l.startswith(prefix)]
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
    job = None
    for i, (ts, balance, project) in enumerate(teamspaces()):
        if balance is not None and worst > float(balance) - SAFETY_MARGIN:
            print(f"[lightning] teamspace {i}: worst case {worst:.2f} exceeds its balance {float(balance):.2f} minus the margin",
                  flush=True)
            continue
        os.environ["LIGHTNING_CLOUD_PROJECT_ID"] = project.id
        try:
            job = Job.run(name=args.name, machine=getattr(Machine, args.machine), command=bootstrap_command(sha, args.script),
                          image="python:3.11-slim", teamspace=ts, interruptible=False,
                          env={"PYTHONUNBUFFERED": "1", **dict(kv.split("=", 1) for kv in args.env),
                       # registry transfers inside the job (jobs carry no credentials); never printed
                       **({"LIGHTNING_API_KEY": os.environ["LIGHTNING_API_KEY"]} if args.pass_key else {})})
            print(f"[lightning] teamspace {i} accepted the job", flush=True)
            break
        except Exception as e:  # 403: this key may read the teamspace but not create jobs in it
            print(f"[lightning] teamspace {i}: job creation refused ({str(e)[-60:]})", flush=True)
    if job is None:
        raise SystemExit("no teamspace accepted the job: the key needs permission to create jobs "
                         "(a Lightning API key with job/studio write access in a teamspace with credits)")
    print(f"[lightning] job {args.name} submitted on {args.machine} at {sha[:12]}", flush=True)
    sys.exit(record_and_wait(job, ledger, ledger_path, args.machine, args.max_hours, worst, args.results, args.name,
                             prefix=args.prefix.rstrip() + " "))


def is_open(status) -> bool:
    return not any(s in str(status) for s in ("Completed", "Failed", "Stopped"))


def jobs(args) -> None:
    """List Rouge jobs with status and cost; with --stop PREFIX, stop the open ones whose name starts with it."""
    if args.stop and (not args.stop.startswith("rouge-") or len(args.stop) < 12):
        raise SystemExit("--stop needs a specific Rouge job name prefix (at least 12 characters, starting with rouge-)")
    stopped = 0
    for i, (ts, balance, project) in enumerate(teamspaces()):
        os.environ["LIGHTNING_CLOUD_PROJECT_ID"] = project.id
        try:
            listed = ts.jobs
        except Exception as e:
            print(f"[lightning] teamspace {i}: jobs unavailable ({type(e).__name__})", flush=True)
            continue
        for j in listed:
            name = getattr(j, "name", "") or ""
            if not name.startswith("rouge"):
                continue
            status = getattr(j, "status", None)
            try:
                spent = j.total_cost
            except Exception:
                spent = None
            print(f"[lightning] teamspace {i}: {name}: {status}, machine {getattr(j, 'machine', None)}, cost {spent}", flush=True)
            if args.progress and name.startswith(args.progress):
                try:
                    lines = (j.logs or "").splitlines()
                except Exception as e:
                    lines = [f"(logs unavailable: {type(e).__name__})"]
                after_failure = 0
                for line in lines:
                    if line.startswith(("ROUGE_RUN", "ROUGE_PHASE", "[tournament]", "[train]", "(logs")) or after_failure:
                        print(f"[job] {line[:300]}", flush=True)
                    # a failed run prints its output tail after "FAILED:"; show it (jobs without the key only)
                    after_failure = 40 if line.rstrip().endswith("FAILED:") else max(0, after_failure - 1)
            if args.stop and is_open(status) and name.startswith(args.stop):
                j.stop()
                stopped += 1
                print(f"[lightning] stopped {name}", flush=True)
    if args.stop:
        print(f"[lightning] {stopped} job(s) stopped for prefix {args.stop}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("probe")
    p.add_argument("--submit-test", choices=["CPU", "T4", "L4"])
    p.add_argument("--storage", action="store_true", help="also test a teamspace-drive round trip (a few KB)")
    p.add_argument("--out", help="write a machine-readable summary (no names, no secrets)")
    p.add_argument("--ledger", default=str(Path(__file__).with_name("ledger.json")))
    r = sub.add_parser("run")
    r.add_argument("--name", required=True)
    r.add_argument("--machine", required=True)
    r.add_argument("--max-hours", type=float, required=True)
    r.add_argument("--script", required=True, help="path relative to training/rouge, run with bash inside the job")
    r.add_argument("--ledger", default=str(Path(__file__).with_name("ledger.json")))
    r.add_argument("--results", help="append ROUGE_RUN records here")
    r.add_argument("--sha")
    r.add_argument("--prefix", default="ROUGE_RUN", help="log-line prefix of the records to collect")
    r.add_argument("--pass-key", action="store_true", help="give the job the key for model-registry transfers")
    r.add_argument("--env", action="append", default=[], help="KEY=VALUE passed to the job (never a secret)")
    j = sub.add_parser("jobs")
    j.add_argument("--stop", help="stop the open Rouge jobs whose name starts with this prefix")
    j.add_argument("--progress", help="print the progress lines of the jobs whose name starts with this prefix")
    args = parser.parse_args()
    {"probe": probe, "run": run, "jobs": jobs}[args.cmd](args)


if __name__ == "__main__":
    main()
