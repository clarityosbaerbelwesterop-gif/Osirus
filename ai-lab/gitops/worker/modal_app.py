"""Modal adapter for the GitOps worker.

Deploy:  modal deploy ai-lab/gitops/worker/modal_app.py
Secret:  modal secret create osirus-gitops HF_TOKEN=... GITHUB_DISPATCH_TOKEN=... MODAL_JOB_TOKEN=...
Then set the repository secrets MODAL_JOB_URL (the printed *.modal.run URL of
`submit`) and MODAL_JOB_TOKEN (same value as in the Modal secret).

`submit` checks the bearer token, refuses jobs whose hard runtime exceeds the
function timeout, spawns the job and returns its call id at once. Functions
scale to zero; nothing runs between jobs.
"""

from __future__ import annotations

import hmac
import os
from pathlib import Path

import modal

HERE = Path(__file__).parent
TIMEOUT_S = 24 * 3600
app = modal.App("osirus-gitops-worker")
image = modal.Image.from_dockerfile(HERE / "Dockerfile", context_dir=HERE)
secrets = [modal.Secret.from_name("osirus-gitops")]

with image.imports():
    from fastapi import HTTPException, Request


def _run(payload: dict) -> dict:
    from handler import run_job

    return run_job(payload, modal.current_function_call_id() or "unknown")


@app.function(image=image, secrets=secrets, cpu=8.0, memory=65536, ephemeral_disk=200 * 1024, timeout=TIMEOUT_S)
def run_cpu(payload: dict) -> dict:
    return _run(payload)


@app.function(image=image, secrets=secrets, gpu="A100-80GB", ephemeral_disk=200 * 1024, timeout=TIMEOUT_S)
def run_gpu(payload: dict) -> dict:
    return _run(payload)


@app.function(image=image, secrets=secrets)
@modal.fastapi_endpoint(method="POST")
async def submit(request: Request):
    expected = f"Bearer {os.environ['MODAL_JOB_TOKEN']}"
    if not hmac.compare_digest(request.headers.get("authorization", "").encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="unauthorized")
    payload = (await request.json()).get("input") or {}
    if int(payload.get("timeoutMs", 0)) > TIMEOUT_S * 1000:
        raise HTTPException(status_code=422, detail="timeoutMs exceeds the worker timeout")
    fn = run_cpu if payload.get("stage") == "merge" else run_gpu
    call = await fn.spawn.aio(payload)
    return {"call_id": call.object_id}
