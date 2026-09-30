"""Lightning storage and model repository for Rouge (private; replaces RunPod volumes and HF).

Backend: the teamspace **model registry** (probe of 2026-09-30: registry round trip verified;
the teamspace drive answered 404 on every cloud account, and job mounts do not persist).
A remote path such as ``rouge/data/pretrain-v1`` maps to the registry model
``rouge-data-pretrain-v1``; every upload is a new version, a download takes the latest
(or ``remote@version``).

    python lightning_ai/storage.py upload   LOCAL_DIR  REMOTE_PATH
    python lightning_ai/storage.py download REMOTE_PATH LOCAL_DIR
    python lightning_ai/storage.py publish  RUN_DIR    MODEL_NAME VERSION

Every upload writes `MANIFEST.sha256.json` (sha256 of every file) next to the data; every download
recomputes the hashes and fails on any difference, so a corrupted or partial transfer is never used.
`publish` uploads the newest verified checkpoint of a run to the teamspace model registry with its
hash manifest as metadata. Weights stay in the private teamspace; git keeps hashes only.

Layout in the teamspace drive:
    rouge/data/<corpus>/            tokenizer.json, manifest.json, train/, val/
    rouge/runs/<lineage name>/      checkpoints/step_*, telemetry.jsonl, result.json, phases.jsonl
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import tempfile
from pathlib import Path

MANIFEST = "MANIFEST.sha256.json"


def _hash_tree(root: Path) -> dict:
    out = {}
    for p in sorted(root.rglob("*")):
        if p.is_file() and p.name != MANIFEST:
            h = hashlib.sha256()
            with open(p, "rb") as f:
                for block in iter(lambda: f.read(1 << 24), b""):
                    h.update(block)
            out[str(p.relative_to(root))] = h.hexdigest()
    return out


def _teamspace():
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from job import teamspace

    return teamspace()[0]


def model_name(remote: str) -> tuple[str, str | None]:
    """'rouge/runs/rouge-r1-100m-001@v3' -> ('rouge-runs-rouge-r1-100m-001', 'v3')."""
    path, _, version = remote.partition("@")
    name = re.sub(r"[^a-z0-9-]+", "-", path.lower()).strip("-")
    return name, (version or None)


def upload(local: str, remote: str, ts=None) -> dict:
    root = Path(local)
    manifest = _hash_tree(root)
    (root / MANIFEST).write_text(json.dumps(manifest, indent=1, sort_keys=True))
    name, version = model_name(remote)
    (ts or _teamspace()).upload_model(str(root), name=name, version=version, progress_bar=False,
                                      metadata={"files": str(len(manifest))})
    print(f"[storage] uploaded {len(manifest)} files to {remote} (registry model {name})", flush=True)
    return manifest


def download(remote: str, local: str, ts=None) -> dict:
    """Download a folder and verify it against its manifest; SystemExit on any mismatch."""
    root = Path(local)
    root.mkdir(parents=True, exist_ok=True)
    name, version = model_name(remote)
    (ts or _teamspace()).download_model(f"{name}:{version}" if version else name, download_dir=str(root), progress_bar=False)
    found = next(root.rglob(MANIFEST), None)
    if found is None:
        raise SystemExit(f"{remote}: no {MANIFEST}; refusing unverified data")
    base = found.parent
    expected = json.loads(found.read_text())
    actual = _hash_tree(base)
    if actual != expected:
        bad = sorted(set(expected) ^ set(actual) | {k for k in expected if actual.get(k) != expected[k]})
        raise SystemExit(f"{remote}: {len(bad)} file(s) differ from the manifest (first: {bad[:3]})")
    print(f"[storage] downloaded and verified {len(actual)} files from {remote}", flush=True)
    return {"root": str(base), "files": len(actual)}


def exists(remote: str, ts=None) -> bool:
    try:
        return bool((ts or _teamspace()).list_model_versions(model_name(remote)[0]))
    except Exception:
        return False


def publish(run_dir: str, name: str, version: str, ts=None) -> None:
    """Upload the newest verified checkpoint to the teamspace model registry (private)."""
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from native import checkpoint

    found = checkpoint.latest(run_dir)
    if found is None:
        raise SystemExit(f"{run_dir}: no verified checkpoint to publish")
    path, meta = found
    metadata = {"architecture_sha": meta.get("architecture_sha"), "data_sha": meta.get("data_sha"), "step": meta.get("step"),
                "files": json.dumps(meta.get("files"))[:4000]}
    (ts or _teamspace()).upload_model(str(path), name=name, version=version, progress_bar=False, metadata=metadata)
    print(f"[storage] published {Path(path).name} as model {name}:{version}", flush=True)


def main() -> None:
    if len(sys.argv) < 4:
        raise SystemExit(__doc__)
    cmd, a, b = sys.argv[1:4]
    if cmd == "upload":
        upload(a, b)
    elif cmd == "download":
        download(a, b)
    elif cmd == "publish":
        publish(a, b, sys.argv[4])
    else:
        raise SystemExit(f"unknown command {cmd}")


if __name__ == "__main__":
    main()
