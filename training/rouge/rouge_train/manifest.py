"""The pinned base model, and checking a download against it.

The base manifest (training/rouge/manifests/) records the exact Hub revision
and the sha256 of every file. Before any training or evaluation run, the
downloaded base is verified against it: a run on unverified weights is not a
Rouge run.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from .hashing import sha256_file

MANIFESTS = Path(__file__).resolve().parent.parent / "manifests"
BASE_MANIFEST = MANIFESTS / "base-qwen3.5-397b-a17b.json"


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


def verify_download(root: Path, manifest: dict, *, weights_only: bool = False) -> Verification:
    """Hash every file the manifest pins (with a sha256) under root."""
    result = Verification()
    for entry in manifest["files"]:
        if not entry.get("sha256"):
            continue
        if weights_only and not entry["path"].endswith(".safetensors"):
            continue
        path = root / entry["path"]
        if not path.is_file():
            result.missing.append(entry["path"])
            continue
        result.checked += 1
        if path.stat().st_size != entry["size"] or sha256_file(path) != entry["sha256"]:
            result.mismatched.append(entry["path"])
    return result
