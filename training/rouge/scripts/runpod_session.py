#!/usr/bin/env python3
"""Launch, watch and always delete ONE RunPod GPU pod for a Rouge session.

Used by .github/workflows/rouge-gpu.yml; standard library plus
huggingface_hub. Secrets come from the environment and are never printed.

    runpod_session.py create --experiment rouge-1-exp-001 --state pod.json
    runpod_session.py watch  --experiment rouge-1-exp-001 --state pod.json --max-hours 4.5
    runpod_session.py delete --state pod.json
    runpod_session.py report --experiment rouge-1-exp-001

Cost guards, in addition to the pod's own ones (gpu_session.sh cost guard,
pod_entry.sh hard time limit, self-stop):
- only H100 GPU types are requested, one GPU, no persistent volume;
- a pod whose price per hour exceeds --max-price is deleted at once;
- watch gives up when the session has not started after 25 minutes or has
  not finished at --max-hours, and the workflow deletes the pod on every
  exit path (success, failure, cancel).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "https://rest.runpod.io/v1"
IMAGE = "nvidia/cuda:12.8.1-base-ubuntu24.04"
STARTUP_HOURS = 25 / 60  # no first phase by then: give up (the pod is deleted)
REPO_URL = "https://github.com/clarityosbaerbelwesterop-gif/Osirus"
START = (
    "set -e; export DEBIAN_FRONTEND=noninteractive; "
    "apt-get update -qq && apt-get install -y -qq git curl ca-certificates python3-venv python3-dev build-essential >/dev/null; "
    f"git clone -q --filter=blob:none {REPO_URL} /opt/osirus && cd /opt/osirus && git checkout -q \"$ROUGE_COMMIT\"; "
    "exec training/rouge/scripts/pod_entry.sh"
)


def call(method: str, path: str, body: dict | None = None) -> dict:
    request = urllib.request.Request(
        f"{API}{path}", method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {os.environ['RUNPOD_API_KEY']}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            text = response.read().decode()
    except urllib.error.HTTPError as error:
        # The error body never contains our secrets (they are only in the request).
        raise SystemExit(f"RunPod {method} {path}: HTTP {error.code}: {error.read().decode()[:500]}") from None
    return json.loads(text) if text.strip() else {}


def h100_types() -> list[str]:
    with urllib.request.urlopen(f"{API}/openapi.json", timeout=60) as response:
        spec = json.load(response)
    schema = spec["paths"]["/pods"]["post"]["requestBody"]["content"]["application/json"]["schema"]
    if "$ref" in schema:
        schema = spec["components"]["schemas"][schema["$ref"].split("/")[-1]]
    names = schema["properties"]["gpuTypeIds"]["items"]["enum"]
    return [n for n in names if "H100" in n and "MIG" not in n]


def create(args) -> None:
    gpus = h100_types()
    if not gpus:
        raise SystemExit("no H100 GPU type in RunPod's API schema")
    env = {
        "HF_TOKEN": os.environ["HF_TOKEN"], "ROUGE_HF_REPO": os.environ["ROUGE_HF_REPO"],
        "EXPERIMENT": args.experiment, "ROUGE_COMMIT": os.environ["GITHUB_SHA"],
        "DATA_FROM_HF": "1", "MAX_HOURS": str(args.max_hours), "ROUGE_RUN_ID": os.environ.get("GITHUB_RUN_ID", "manual"),
    }
    body = {
        "name": f"rouge-{args.experiment}-{os.environ.get('GITHUB_RUN_ID', 'manual')}",
        "imageName": IMAGE, "gpuTypeIds": gpus, "gpuCount": 1, "cloudType": args.cloud,
        # Drivers for CUDA 13 run both the torch and the vLLM wheels.
        "allowedCudaVersions": ["13.0"], "interruptible": False,
        "containerDiskInGb": 200, "volumeInGb": 0, "minRAMPerGPU": 96, "minVCPUPerGPU": 8,
        "ports": [], "env": env, "dockerStartCmd": ["bash", "-lc", START],
    }
    pod = call("POST", "/pods", body)
    pod_id = pod.get("id")
    if not pod_id:
        raise SystemExit(f"RunPod returned no pod id (fields: {sorted(pod)})")
    Path(args.state).write_text(json.dumps({"id": pod_id, "created": time.time()}))
    price = pod.get("costPerHr") or call("GET", f"/pods/{pod_id}").get("costPerHr")
    gpu = (pod.get("machine") or {}).get("gpuTypeId") or pod.get("gpuTypeId") or pod.get("gpu")
    print(f"pod {pod_id}: {gpu}, {price} USD/h, {args.cloud}")
    if price is not None and float(price) > args.max_price:
        call("DELETE", f"/pods/{pod_id}")
        raise SystemExit(f"price {price} USD/h is above the cap {args.max_price}: pod deleted")


def _prefix(experiment: str) -> str:
    return f"{experiment}/sessions/{os.environ.get('GITHUB_RUN_ID', 'manual')}"


def _hf_json(experiment: str, name: str) -> dict | None:
    from huggingface_hub import hf_hub_download
    from huggingface_hub.errors import EntryNotFoundError, RepositoryNotFoundError

    try:
        path = hf_hub_download(os.environ["ROUGE_HF_REPO"], f"{_prefix(experiment)}/{name}", force_download=True)
    except (EntryNotFoundError, RepositoryNotFoundError):
        return None
    return json.loads(Path(path).read_text())


def watch(args) -> None:
    state = json.loads(Path(args.state).read_text())
    deadline = state["created"] + args.max_hours * 3600
    seen = 0
    while time.time() < deadline:
        time.sleep(60)
        elapsed = (time.time() - state["created"]) / 3600
        try:
            pod = call("GET", f"/pods/{state['id']}")
        except SystemExit as error:
            print(f"{elapsed:.2f} h: pod lookup failed ({error})")
            pod = {}
        status = _hf_json(args.experiment, "status.json") or {"phases": []}
        for phase in status["phases"][seen:]:
            print(f"{elapsed:.2f} h: phase {phase['phase']} at {phase['at']}", flush=True)
        seen = len(status["phases"])
        result = _hf_json(args.experiment, "result.json")
        if result is not None:
            print(f"{elapsed:.2f} h: session ended: {json.dumps(result)}")
            Path(args.state).write_text(json.dumps(state | {"result": result}))
            return
        if pod.get("desiredStatus") in ("TERMINATED",):
            raise SystemExit(f"{elapsed:.2f} h: pod terminated without a result")
        if not seen and elapsed > STARTUP_HOURS:
            raise SystemExit(f"{elapsed:.2f} h: the session never started (image, network or host problem)")
    raise SystemExit(f"hard limit of {args.max_hours} h reached without a result")


def delete(args) -> None:
    path = Path(args.state)
    if not path.exists():
        print("no pod was created")
        return
    pod_id = json.loads(path.read_text())["id"]
    for attempt in range(5):
        try:
            call("DELETE", f"/pods/{pod_id}")
            print(f"pod {pod_id} deleted")
            return
        except SystemExit as error:
            print(f"delete attempt {attempt + 1} failed: {error}")
            time.sleep(10 * (attempt + 1))
    raise SystemExit(f"could not delete pod {pod_id}: delete it in the RunPod console")


def report(args) -> None:
    from huggingface_hub import hf_hub_download

    lines = [f"## {args.experiment}"]
    result = _hf_json(args.experiment, "result.json")
    lines.append(f"- session: `{json.dumps(result)}`")
    for name in ("compare.txt",):
        try:
            text = Path(hf_hub_download(os.environ["ROUGE_HF_REPO"], f"{_prefix(args.experiment)}/{name}", force_download=True)).read_text()
            lines += ["", "```", text.strip(), "```"]
        except Exception as error:  # the report is best effort
            lines.append(f"- {name}: not available ({type(error).__name__})")
    text = "\n".join(lines)
    print(text)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as handle:
            handle.write(text + "\n")
    if not result or result.get("exit_code") != 0:
        raise SystemExit("the session did not finish cleanly")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["create", "watch", "delete", "report"])
    parser.add_argument("--experiment", default="rouge-1-exp-001")
    parser.add_argument("--state", default="pod.json")
    parser.add_argument("--max-hours", type=float, default=4.5)
    parser.add_argument("--max-price", type=float, default=3.30)
    parser.add_argument("--cloud", default="SECURE", choices=["SECURE", "COMMUNITY"])
    args = parser.parse_args()
    {"create": create, "watch": watch, "delete": delete, "report": report}[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
