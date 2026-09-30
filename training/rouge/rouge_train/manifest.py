"""The pinned base model, and checking a download against it.

The base manifest (models/rouge-1/base.json) records the exact Hub revision
and the sha256 of every file. Before any training or evaluation run, the
downloaded base is verified against it: a run on unverified weights is not a
Rouge run.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from .hashing import sha256_file

REPO_ROOT = Path(__file__).resolve().parents[3]
BASE_MANIFEST = REPO_ROOT / "models" / "rouge-1" / "base.json"


def load_base(path: Path = BASE_MANIFEST) -> dict:
    manifest = json.loads(path.read_text())
    if manifest.get("schema") != "rouge.base-manifest/1":
        raise ValueError(f"{path} is not a Rouge base manifest")
    if manifest["license"]["spdx"] != "Apache-2.0":
        raise ValueError("the pinned base must be Apache-2.0 licensed")
    return manifest


def base_ref(manifest: dict) -> str:
    """The parent reference every first-generation checkpoint names."""
    source = manifest["source"]
    return f"base:{source['repo']}@{source['revision']}"


@dataclass
class Verification:
    checked: int = 0
    missing: list[str] = field(default_factory=list)
    mismatched: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.missing and not self.mismatched


def verify_download(root: Path, manifest: dict, *, weights_only: bool = False, workers: int = 16) -> Verification:
    """Hash every file the manifest pins (with a sha256) under root, several files at a time
    (hashlib releases the GIL, so an 865 GB teacher verifies in minutes, not a quarter hour)."""
    from concurrent.futures import ThreadPoolExecutor

    result = Verification()
    entries = [e for e in manifest["files"] if e.get("sha256") and not (weights_only and not e["path"].endswith(".safetensors"))]
    present = []
    for entry in entries:
        if (root / entry["path"]).is_file():
            present.append(entry)
        else:
            result.missing.append(entry["path"])

    def ok(entry: dict) -> bool:
        path = root / entry["path"]
        return path.stat().st_size == entry["size"] and sha256_file(path) == entry["sha256"]

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for entry, good in zip(present, pool.map(ok, present)):
            result.checked += 1
            if not good:
                result.mismatched.append(entry["path"])
    return result
