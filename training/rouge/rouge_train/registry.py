"""The dataset registry: nothing trains Rouge without provenance (M58/M62).

Every dataset or generator that may feed a Rouge training run is an entry in
training/rouge/data/registry.json. An entry is only usable for training
when it is approved: its licence is in the allowlist and was verified
against the source at a pinned revision, and -- if it contains another
model's outputs -- that model's terms permit training on them. Evaluation
sets used for claims are registered too, and are never trainable.
"""

from __future__ import annotations

import json
from pathlib import Path

REGISTRY = Path(__file__).resolve().parent.parent / "data" / "registry.json"

# Licences under which training a commercial derivative model is permitted.
# Attribution (CC-BY, ODC-BY) is honoured in the model card.
LICENSE_ALLOWLIST = {
    "Apache-2.0",
    "MIT",
    "BSD-3-Clause",
    "CC0-1.0",
    "CC-BY-4.0",
    "CC-BY-SA-4.0",
    "ODC-BY-1.0",
    "generated-in-house",
}
STATUSES = ("candidate", "approved", "rejected")
ROLES = ("train", "eval-only")


def load(path: Path = REGISTRY) -> dict:
    registry = json.loads(path.read_text())
    problems = validate(registry)
    if problems:
        raise ValueError("invalid dataset registry:\n- " + "\n- ".join(problems))
    return registry


def validate(registry: dict) -> list[str]:
    problems: list[str] = []
    if registry.get("schema") != "rouge.data-registry/1":
        problems.append("schema must be rouge.data-registry/1")
    seen: set[str] = set()
    for entry in registry.get("datasets", []):
        key = entry.get("id", "?")
        if key in seen:
            problems.append(f"{key}: duplicate id")
        seen.add(key)
        for field in ("id", "source", "license", "status", "role", "domains"):
            if not entry.get(field):
                problems.append(f"{key}: {field} is required")
        if entry.get("status") not in STATUSES:
            problems.append(f"{key}: status must be one of {STATUSES}")
        if entry.get("role") not in ROLES:
            problems.append(f"{key}: role must be one of {ROLES}")
        if entry.get("status") == "approved":
            problems.extend(f"{key}: {reason}" for reason in approval_blockers(entry))
    return problems


def approval_blockers(entry: dict) -> list[str]:
    """Why an entry may not be used for training (empty = it may)."""
    blockers = []
    if entry.get("role") != "train":
        blockers.append("evaluation-only data never trains Rouge")
    if entry.get("license") not in LICENSE_ALLOWLIST:
        blockers.append(f"licence {entry.get('license')!r} is not on the allowlist")
    verified = entry.get("licenseVerified") or {}
    if not (verified.get("at") and verified.get("evidence")):
        blockers.append("licence not verified against the source")
    if entry.get("license") != "generated-in-house" and not entry.get("revision"):
        blockers.append("source revision is not pinned")
    teacher = entry.get("teacherOutputs")
    if teacher and not teacher.get("termsPermitTraining"):
        blockers.append(f"contains outputs of {teacher.get('model')!r} without terms that permit training")
    return blockers


def trainable(registry: dict) -> list[dict]:
    return [
        entry
        for entry in registry["datasets"]
        if entry["status"] == "approved" and not approval_blockers(entry)
    ]
