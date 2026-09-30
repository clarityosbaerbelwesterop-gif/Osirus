"""RunPod session for native Rouge training: one pod, driven over SSH, always deleted.

    python training/rouge/runpod/session.py --task prepare --corpus pretrain-v1 --tokens 2e9 --max-hours 3
    python training/rouge/runpod/session.py --task train --rung 100m --corpus pretrain-v1 --max-hours 5

Runs from GitHub Actions in the protected environment "rouge-gpu" (the owner
approves every paid run). Standard library plus the system ssh client.

Order of guards, before anything is billed:
1. TRAINING_READY.json must be true for task=train (training/rouge/ready.py);
2. the live price (GraphQL) is read and capped (--max-price);
3. worst case = max_hours x max_price (+ a new volume's first month) must fit
   the 50 EUR ceiling with everything already in the ledger (cost.py).
Then: find or create the private network volume `rouge` (in a data center
with H200 stock and network storage), create the pod with an ephemeral SSH
key (generated per run, never stored), check the pod's actual price, copy
the pinned commit to the volume, run pod_train.sh detached, follow its
phases, fetch results and hashes (never weights), and DELETE the pod in a
`finally` block. The ledger records the actual seconds x price.

Weights stay on the private network volume (owner decision 2026-09-30).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shlex
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cost  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
REST = "https://rest.runpod.io/v1"
GRAPHQL = "https://api.runpod.io/graphql"
IMAGE = "nvidia/cuda:12.8.1-base-ubuntu24.04"
VOLUME_NAME = "rouge"
VOLUME_GB = 60
GPU = {"H200": "NVIDIA H200"}
BOOT = (
    "set -e; export DEBIAN_FRONTEND=noninteractive; "
    "apt-get update -qq && apt-get install -y -qq openssh-server python3-venv python3-dev curl ca-certificates >/dev/null; "
    "mkdir -p /root/.ssh /run/sshd && echo \"$PUBLIC_KEY\" > /root/.ssh/authorized_keys && chmod 700 /root/.ssh "
    "&& chmod 600 /root/.ssh/authorized_keys; "
    "sed -i 's/^#\\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config; "
    "/usr/sbin/sshd; "
    # hard stop at the deadline even if the launcher disappears
    "(sleep \"$ROUGE_POD_SECONDS\"; curl -sS -o /dev/null -X POST -H \"Authorization: Bearer $RUNPOD_API_KEY\" "
    "\"https://rest.runpod.io/v1/pods/$RUNPOD_POD_ID/stop\") & "
    "sleep infinity"
)


def api(method: str, path: str, body: dict | None = None) -> dict:
    request = urllib.request.Request(f"{REST}{path}", method=method, data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Authorization": f"Bearer {os.environ['RUNPOD_API_KEY']}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            text = response.read().decode()
    except urllib.error.HTTPError as error:
        raise SystemExit(f"RunPod {method} {path}: HTTP {error.code}: {error.read().decode()[:400]}") from None
    return json.loads(text) if text.strip() else {}


def graphql(query: str) -> dict:
    request = urllib.request.Request(GRAPHQL, data=json.dumps({"query": query}).encode(),
                                     headers={"Authorization": f"Bearer {os.environ['RUNPOD_API_KEY']}", "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=60) as response:
        out = json.loads(response.read().decode())
    if out.get("errors"):
        raise SystemExit(f"RunPod GraphQL: {out['errors'][0].get('message', '')[:300]}")
    return out["data"]


def live_price(gpu: str) -> float:
    rows = graphql("query { gpuTypes { id securePrice } }")["gpuTypes"]
    price = next((r["securePrice"] for r in rows if r["id"] == gpu), None)
    if not price:
        raise SystemExit(f"no secure-cloud price for {gpu}")
    return float(price)


def account() -> dict:
    return graphql("query { myself { clientBalance networkVolumes { id name size dataCenterId } } }")["myself"]


def h200_storage_dcs() -> list[str]:
    dcs = graphql("query { dataCenters { id storageSupport gpuAvailability { gpuTypeId available } } }")["dataCenters"]
    return [d["id"] for d in dcs if d.get("storageSupport")
            and any(g.get("gpuTypeId") == GPU["H200"] and g.get("available") for g in d.get("gpuAvailability") or [])]


def ensure_volume(ledger: dict) -> dict:
    vols = [v for v in account()["networkVolumes"] or [] if v["name"] == VOLUME_NAME]
    if vols:
        return vols[0]
    dcs = h200_storage_dcs()
    if not dcs:
        raise SystemExit("no data center has H200 stock and network storage right now")
    worst = cost.worst_case(0, 0, VOLUME_GB, 1)
    cost.check(ledger, worst)
    vol = api("POST", "/networkvolumes", {"name": VOLUME_NAME, "size": VOLUME_GB, "dataCenterId": dcs[0]})
    entry = cost.open_entry(ledger, "volume", f"{VOLUME_NAME} ({VOLUME_GB} GB, {dcs[0]})", 0.0, 0.0, worst, volume_id=vol.get("id"))
    entry["cost_usd"] = round(worst, 4)          # one month charged up front; later months are added by `volume-month`
    cost.save(ledger)
    print(f"[session] network volume created in {dcs[0]} ({VOLUME_GB} GB)", flush=True)
    return {"id": vol["id"], "dataCenterId": dcs[0], "size": VOLUME_GB}


def ssh_base(key: Path, host: str, port: int) -> list[str]:
    return ["ssh", "-i", str(key), "-p", str(port), "-o", "StrictHostKeyChecking=accept-new", "-o", "BatchMode=yes",
            "-o", "ConnectTimeout=20", "-o", "ServerAliveInterval=30", "-o", f"UserKnownHostsFile={key}.known", f"root@{host}"]


def ssh(key: Path, host: str, port: int, command: str, check: bool = True, timeout: int = 600) -> subprocess.CompletedProcess:
    return subprocess.run(ssh_base(key, host, port) + [command], capture_output=True, text=True, check=check, timeout=timeout)


def wait_for_ssh(pod_id: str, key: Path, deadline: float) -> tuple[str, int]:
    while time.time() < deadline:
        pod = api("GET", f"/pods/{pod_id}")
        host, port = pod.get("publicIp"), (pod.get("portMappings") or {}).get("22")
        if host and port:
            try:
                if ssh(key, host, int(port), "true", check=False, timeout=60).returncode == 0:
                    return host, int(port)
            except subprocess.TimeoutExpired:
                pass
        time.sleep(20)
    raise SystemExit("the pod never accepted SSH")


def copy_code(key: Path, host: str, port: int, sha: str) -> str:
    """Pack training/rouge at the pinned commit and unpack it on the volume."""
    archive = Path(os.environ.get("RUNNER_TEMP", "/tmp")) / "rouge-code.tar.gz"
    subprocess.run(["git", "-C", str(ROOT), "archive", "--format=tar.gz", "-o", str(archive), f"{sha}:training/rouge"], check=True)
    dest = f"/workspace/rouge/code/{sha}"
    with open(archive, "rb") as fh:
        subprocess.run(ssh_base(key, host, port) + [f"mkdir -p {dest} && tar -xzf - -C {dest}"], stdin=fh, check=True, timeout=600)
    return dest


def ensure_venv(key: Path, host: str, port: int) -> None:
    cmd = ("test -x /workspace/rouge/venv/bin/python || (python3 -m venv /workspace/rouge/venv && "
           "/workspace/rouge/venv/bin/pip install -q torch==2.14.0 numpy tokenizers datasets huggingface_hub)")
    ssh(key, host, port, cmd, timeout=1800)


def fetch(key: Path, host: str, port: int, remote: str, local: Path) -> bool:
    out = ssh(key, host, port, f"cat {shlex.quote(remote)}", check=False, timeout=300)
    if out.returncode != 0:
        return False
    local.parent.mkdir(parents=True, exist_ok=True)
    local.write_text(out.stdout)
    return True


def run(args) -> int:
    for var in ("RUNPOD_API_KEY",):
        if not os.environ.get(var):
            raise SystemExit(f"{var} is not set")
    if args.task == "train":
        ready = json.loads((ROOT / "TRAINING_READY.json").read_text()) if (ROOT / "TRAINING_READY.json").exists() else {}
        if ready.get("TRAINING_READY") is not True:
            raise SystemExit("TRAINING_READY is not true: run training/rouge/ready.py and fix every failing condition first")
    gpu = GPU["H200"] if args.task == "train" else None
    price = live_price(gpu) if gpu else args.cpu_price
    if price > args.max_price:
        raise SystemExit(f"live price {price} USD/h is above the cap {args.max_price}")
    ledger = cost.load()
    worst = cost.worst_case(args.max_price, args.max_hours)
    remaining = cost.check(ledger, worst)
    balance = float(account().get("clientBalance") or 0)
    if balance < worst:
        raise SystemExit(f"RunPod balance {balance:.2f} USD does not cover the worst case {worst:.2f} USD: top up the account first")
    print(f"[session] {args.task}: price {price} USD/h, worst case {worst:.2f} USD, {remaining:.2f} USD left under the ceiling afterwards",
          flush=True)
    volume = ensure_volume(ledger)

    sha = os.environ.get("GITHUB_SHA") or subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    tmp = Path(os.environ.get("RUNNER_TEMP", "/tmp"))
    key = tmp / "rouge_pod_key"
    for p in (key, Path(f"{key}.pub"), Path(f"{key}.known")):
        p.unlink(missing_ok=True)
    subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(key)], check=True)
    seconds = int(args.max_hours * 3600)
    body = {"name": f"rouge-{args.task}-{args.run}", "imageName": IMAGE, "cloudType": "SECURE", "networkVolumeId": volume["id"],
            "volumeMountPath": "/workspace", "containerDiskInGb": 40, "ports": ["22/tcp"], "supportPublicIp": True,
            "interruptible": False, "dockerStartCmd": ["bash", "-lc", BOOT],
            "env": {"PUBLIC_KEY": Path(f"{key}.pub").read_text().strip(), "ROUGE_POD_SECONDS": str(seconds)}}
    if gpu:
        body.update({"computeType": "GPU", "gpuTypeIds": [gpu], "gpuCount": 1, "allowedCudaVersions": ["13.0", "12.9", "12.8"],
                     "minRAMPerGPU": 64, "minVCPUPerGPU": 8})
    else:
        body.update({"computeType": "CPU", "cpuFlavorIds": ["cpu5c", "cpu3c"], "vcpuCount": args.vcpus})
    started = time.time()
    entry = cost.open_entry(ledger, "pod", f"{args.task}-{args.run}", args.max_price, args.max_hours, worst, sha=sha)
    cost.save(ledger)
    pod_id, actual_price, code = None, args.max_price, 1
    try:
        pod = api("POST", "/pods", body)
        pod_id = pod.get("id")
        if not pod_id:
            raise SystemExit(f"RunPod returned no pod id (fields {sorted(pod)})")
        actual_price = float(pod.get("costPerHr") or api("GET", f"/pods/{pod_id}").get("costPerHr") or args.max_price)
        entry.update({"pod_id": pod_id, "price_per_hour": actual_price})
        cost.save(ledger)
        print(f"[session] pod created: {actual_price} USD/h", flush=True)
        if actual_price > args.max_price:
            raise SystemExit(f"pod price {actual_price} USD/h is above the cap {args.max_price}")
        host, port = wait_for_ssh(pod_id, key, time.time() + 1500)
        print("[session] SSH ready", flush=True)
        ensure_venv(key, host, port)
        code_dir = copy_code(key, host, port, sha)
        deadline = int(started + seconds - 300)
        env = {"ROUGE_TASK": args.task, "ROUGE_RUN": args.run, "ROUGE_CORPUS": args.corpus, "ROUGE_DEADLINE_EPOCH": str(deadline),
               "ROUGE_EXPECT_GPU": "H200", "ROUGE_TOKENS": str(int(args.tokens or 0))}
        if args.task == "train":
            ladder = json.loads((ROOT / "configs/native/ladder-v1.json").read_text())["rungs"][args.rung]
            seq = json.loads((ROOT / "configs/native/ladder-v1.json").read_text())["common"]["max_seq"]
            batch, accum = args.batch, max(1, ladder["batch_tokens"] // (args.batch * seq))
            steps = int(ladder["tokens"] // (batch * accum * seq))
            env.update({"ROUGE_CONFIG": f"configs/native/rouge-v1-{args.rung}.json", "ROUGE_STEPS": str(steps),
                        "ROUGE_BATCH": str(batch), "ROUGE_ACCUM": str(accum), "ROUGE_SEQ": str(seq), "ROUGE_LR": str(ladder["lr"])})
        exports = " ".join(f"{k}={shlex.quote(v)}" for k, v in env.items())
        run_dir = f"/workspace/rouge/runs/{args.run}"
        ssh(key, host, port, f"mkdir -p {run_dir} && cd {code_dir} && {exports} nohup bash runpod/pod_train.sh "
                             f"> {run_dir}/session.log 2>&1 < /dev/null & echo started")
        seen, last_tel = 0, ""
        while time.time() < deadline + 240:
            time.sleep(60)
            out = ssh(key, host, port, f"cat {run_dir}/phases.jsonl 2>/dev/null; echo ===; tail -n 1 {run_dir}/telemetry.jsonl 2>/dev/null",
                      check=False, timeout=120)
            phases_text, _, tel = out.stdout.partition("===\n")
            phases = [json.loads(l) for l in phases_text.splitlines() if l.strip()]
            for p in phases[seen:]:
                print(f"[pod] {p['phase']} {p.get('note', '')} at {p['at']}", flush=True)
            seen = len(phases)
            if tel.strip() and tel != last_tel:
                print(f"[pod] {tel.strip()[:300]}", flush=True)
                last_tel = tel
            if phases and phases[-1]["phase"] in ("DONE", "FAILED", "SEGMENT_END", "DEADLINE"):
                break
        final = phases[-1]["phase"] if phases else "NO_PHASES"
        results = ROOT / "results" / "runs" / args.run
        for name in ("phases.jsonl", "result.json", "telemetry.jsonl", "verify.log"):
            fetch(key, host, port, f"{run_dir}/{name}", results / name)
        fetch(key, host, port, f"{run_dir}/train.log", results / "train-tail.log") if args.task == "train" else None
        if args.task == "prepare":
            fetch(key, host, port, f"/workspace/rouge/data/{args.corpus}/manifest.json", results / "manifest.json")
            fetch(key, host, port, f"{run_dir}/prepare.log", results / "prepare.log")
        # checkpoint hash manifests (never the weights)
        metas = ssh(key, host, port, f"for d in {run_dir}/checkpoints/step_*; do [ -f $d/meta.json ] && echo $d; done", check=False).stdout.split()
        for d in metas[-2:]:
            fetch(key, host, port, f"{d}/meta.json", results / "checkpoints" / Path(d).name / "meta.json")
        tail = results / "train-tail.log"
        if tail.exists():
            tail.write_text("\n".join(tail.read_text().splitlines()[-200:]) + "\n")
        print(f"[session] final phase {final}", flush=True)
        code = 0 if final in ("DONE", "SEGMENT_END") else 1
    finally:
        if pod_id:
            for attempt in range(6):
                try:
                    api("DELETE", f"/pods/{pod_id}")
                    print("[session] pod deleted", flush=True)
                    break
                except SystemExit as error:
                    print(f"[session] delete attempt {attempt + 1} failed: {error}", flush=True)
                    time.sleep(15 * (attempt + 1))
            else:
                print("[session] COULD NOT DELETE THE POD: delete it in the RunPod console now", flush=True)
                code = 2
        cost.close_entry(entry, time.time() - started, actual_price)
        cost.save(ledger)
        print(f"[session] cost {entry['cost_usd']:.2f} USD; committed under the ceiling {cost.committed(ledger):.2f} of "
              f"{cost.CEILING_USD:.2f} USD", flush=True)
    return code


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task", choices=["prepare", "train"], required=True)
    parser.add_argument("--run", required=True, help="run name, e.g. rouge-r1-100m-001-seg1 or prepare-pretrain-v1")
    parser.add_argument("--corpus", default="pretrain-v1")
    parser.add_argument("--tokens", type=float, help="prepare: corpus size")
    parser.add_argument("--rung", default="100m")
    parser.add_argument("--batch", type=int, default=16, help="train: micro-batch per step (sequences)")
    parser.add_argument("--max-hours", type=float, required=True)
    parser.add_argument("--max-price", type=float, default=4.80, help="highest accepted USD per hour")
    parser.add_argument("--cpu-price", type=float, default=0.60, help="prepare: assumed CPU pod price for the pre-check")
    parser.add_argument("--vcpus", type=int, default=16)
    args = parser.parse_args()
    if not math.isfinite(args.max_hours) or args.max_hours <= 0 or args.max_hours > 5.75:
        raise SystemExit("--max-hours must be in (0, 5.75]: a GitHub job lasts at most 6 hours")
    sys.exit(run(args))


if __name__ == "__main__":
    main()
