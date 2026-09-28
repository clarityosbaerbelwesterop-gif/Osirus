#!/usr/bin/env python3
"""Pin Rouge 1's base model: exact revision, file hashes, licence, config.

Reads only public metadata and small text files from the Hugging Face Hub.
It never downloads weights: shard hashes come from the Hub's LFS metadata
(the sha256 the Hub itself verifies on upload), so the manifest can be
checked against any later download without trusting this script's network.

Usage:
    python base_manifest.py Qwen/Qwen3.5-397B-A17B [revision] > manifest.json

Standard library only, so it runs on a bare CI runner.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import sys
import urllib.request

HUB = "https://huggingface.co"
# Small files that define the model's behaviour and legal terms. Anything
# listed here is downloaded (never more than a few MB) and hashed locally.
SMALL_FILES = (
    "config.json",
    "generation_config.json",
    "tokenizer_config.json",
    "tokenizer.json",
    "vocab.json",
    "merges.txt",
    "chat_template.jinja",
    "chat_template.json",
    "preprocessor_config.json",
    "video_preprocessor_config.json",
    "model.safetensors.index.json",
    "LICENSE",
    "README.md",
)
MAX_SMALL_BYTES = 64 * 1024 * 1024


def get(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "rouge-manifest/1"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def main() -> None:
    repo = sys.argv[1]
    wanted = sys.argv[2] if len(sys.argv) > 2 else "main"
    info = json.loads(get(f"{HUB}/api/models/{repo}/revision/{wanted}?blobs=true"))
    revision = info["sha"]

    files = []
    for sibling in sorted(info.get("siblings", []), key=lambda s: s["rfilename"]):
        lfs = sibling.get("lfs") or {}
        files.append(
            {
                "path": sibling["rfilename"],
                "size": sibling.get("size", lfs.get("size")),
                "sha256": lfs.get("sha256"),
                "gitBlob": sibling.get("blobId"),
            }
        )

    small = {}
    for name in SMALL_FILES:
        entry = next((f for f in files if f["path"] == name), None)
        if not entry or (entry["size"] or 0) > MAX_SMALL_BYTES:
            continue
        body = get(f"{HUB}/{repo}/resolve/{revision}/{name}")
        digest = hashlib.sha256(body).hexdigest()
        if entry["sha256"] and entry["sha256"] != digest:
            raise SystemExit(f"hash mismatch for {name}")
        entry["sha256"] = digest
        small[name] = body

    config = json.loads(small["config.json"]) if "config.json" in small else None
    weights = [f for f in files if f["path"].endswith(".safetensors")]
    card = info.get("cardData") or {}
    manifest = {
        "repo": repo,
        "requestedRevision": wanted,
        "revision": revision,
        "retrievedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "lastModified": info.get("lastModified"),
        "createdAt": info.get("createdAt"),
        "gated": info.get("gated"),
        "private": info.get("private"),
        "license": {
            "cardLicense": card.get("license"),
            "licenseName": card.get("license_name"),
            "licenseLink": card.get("license_link"),
            "tags": [t for t in info.get("tags", []) if t.startswith("license:")],
            "licenseFileSha256": next(
                (f["sha256"] for f in files if f["path"] == "LICENSE"), None
            ),
            "licenseHead": small["LICENSE"].decode("utf-8", "replace")[:600]
            if "LICENSE" in small
            else None,
        },
        "pipelineTag": info.get("pipeline_tag"),
        "libraryName": info.get("library_name"),
        "tags": info.get("tags", []),
        "safetensorsParameters": (info.get("safetensors") or {}).get("parameters"),
        "safetensorsTotal": (info.get("safetensors") or {}).get("total"),
        "weights": {
            "shards": len(weights),
            "bytes": sum(f["size"] or 0 for f in weights),
            "allHashed": all(f["sha256"] for f in weights),
        },
        "config": config,
        "files": files,
    }
    json.dump(manifest, sys.stdout, indent=1, sort_keys=False)
    sys.stdout.write("\n")
    if "README.md" in small:
        sys.stderr.write(small["README.md"].decode("utf-8", "replace"))


if __name__ == "__main__":
    main()
