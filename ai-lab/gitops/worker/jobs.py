"""Pure job logic for the GitOps worker: payload checks, data shaping, metric
extraction, run records, callbacks. No GPU or ML imports, so it is unit tested
in CI (see test_jobs.py) while the heavy paths live in handler.py.

The payload contract is rendered by ai-lab/gitops/lib/render.ts
(schema "osirus.gitops.job/v1"); the run record must pass validateRunRecord in
ai-lab/gitops/lib/schema.ts.
"""

from __future__ import annotations

import json
import os
import re
import urllib.request
from datetime import datetime, timezone
from typing import Any

PAYLOAD_SCHEMA = "osirus.gitops.job/v1"
STAGES = ("train", "merge", "eval")
SHA40 = re.compile(r"^[0-9a-f]{40}$")
RUN_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,95}$")
HUB_REPO = re.compile(r"^[A-Za-z0-9][\w.-]{0,95}/[A-Za-z0-9][\w.-]{0,95}$")
SECRET_ENV = ("HF_TOKEN", "GITHUB_DISPATCH_TOKEN", "MODAL_JOB_TOKEN", "RUNPOD_API_KEY")


class PayloadError(ValueError):
    pass


def validate_payload(p: dict[str, Any]) -> None:
    """Refuse anything the control plane would not have rendered."""
    if p.get("schema") != PAYLOAD_SCHEMA:
        raise PayloadError(f"schema must be {PAYLOAD_SCHEMA}")
    stage = p.get("stage")
    if stage not in STAGES or stage not in p:
        raise PayloadError(f"stage must be one of {STAGES} with a matching section")
    if not RUN_ID.match(str(p.get("runId", ""))):
        raise PayloadError("runId has an unexpected shape")
    if not SHA40.match(str(p.get("commitSha", ""))):
        raise PayloadError("commitSha must be a 40-hex sha")
    if not re.match(r"^[0-9a-f]{64}$", str(p.get("inputHash", ""))):
        raise PayloadError("inputHash must be a sha256 hex digest")
    if not HUB_REPO.match(str(p.get("repository", ""))):
        raise PayloadError("repository must be owner/name")
    refs: list[dict[str, str]] = []
    section = p[stage]
    if stage == "train":
        refs = [section["base"], *section["datasets"]]
    elif stage == "merge":
        refs = [section["base"]]
    else:
        refs = [section["model"]]
    for ref in refs:
        if not HUB_REPO.match(ref["repo"]) or not SHA40.match(ref["revision"]):
            raise PayloadError(f"unpinned or malformed reference {ref}")
    if stage in ("train", "merge") and not HUB_REPO.match(section["publish"]):
        raise PayloadError("publish must be a hub repo id")


def to_prompt_completion(row: dict[str, Any]) -> dict[str, Any]:
    """Normalise a training row to TRL's conversational prompt/completion form,
    so the loss covers the assistant answer only."""
    if "prompt" in row and "completion" in row:
        return {"prompt": row["prompt"], "completion": row["completion"]}
    messages = row.get("messages")
    if isinstance(messages, list) and messages and messages[-1].get("role") == "assistant":
        return {"prompt": messages[:-1], "completion": [messages[-1]]}
    raise PayloadError("row has neither prompt/completion nor messages ending in an assistant turn")


def extract_metrics(results: dict[str, Any], suites: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Pull each suite's declared metric from lm-eval results. A missing key is
    an error that names the available keys; nothing is guessed."""
    out = []
    for suite in suites:
        task_results = results.get(suite["task"])
        if not isinstance(task_results, dict):
            raise KeyError(f"lm-eval returned no results for task {suite['task']}")
        if suite["metric"] not in task_results:
            available = sorted(k for k in task_results if "," in k and "_stderr" not in k)
            raise KeyError(f"{suite['task']}: metric {suite['metric']} not found; available: {available}")
        out.append({"suite": suite["id"], "metric": suite["metric"], "value": float(task_results[suite["metric"]])})
    return out


def scrub(text: str) -> str:
    for name in SECRET_ENV:
        value = os.environ.get(name)
        if value:
            text = text.replace(value, f"<{name}>")
    return text


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def build_record(
    p: dict[str, Any],
    *,
    provider_job_id: str,
    started_at: str,
    finished_at: str,
    elapsed_hours: float,
    outputs: dict[str, str] | None,
    metrics: list[dict[str, Any]],
    error: str | None,
) -> dict[str, Any]:
    """Run record in the shape validateRunRecord accepts. Failures are recorded too."""
    succeeded = error is None and outputs is not None
    return {
        "runId": p["runId"],
        "jobId": p["jobId"],
        "inputHash": p["inputHash"],
        "status": "succeeded" if succeeded else "failed",
        "provider": p["provider"],
        "providerJobId": re.sub(r"[^\w.:-]", "-", provider_job_id)[:128] or "unknown",
        "commitSha": p["commitSha"],
        "startedAt": started_at,
        "finishedAt": finished_at,
        "outputs": outputs if succeeded else None,
        "metrics": metrics,
        "costUsd": round(max(elapsed_hours, 0.0) * float(p.get("costRateUsdPerHour", 0)), 2),
        "error": None if succeeded else scrub(error or "worker produced no outputs")[-1000:],
    }


def callback(p: dict[str, Any], record: dict[str, Any]) -> int:
    """repository_dispatch to the control plane; GitHub allows 10 top-level
    client_payload keys, so the record travels as one."""
    token = os.environ["GITHUB_DISPATCH_TOKEN"]
    body = json.dumps({"event_type": p["callback"]["eventType"], "client_payload": {"record": record}}).encode()
    req = urllib.request.Request(
        f"https://api.github.com/repos/{p['repository']}/dispatches",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as res:  # noqa: S310 - fixed https host
        return res.status
