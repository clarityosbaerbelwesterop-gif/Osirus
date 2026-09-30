#!/usr/bin/env python3
"""Turn a raw Hub manifest (base_manifest.py output) into models/rouge-1/base.json.

Usage (CI, after base_manifest.py):
    python pin_base.py raw.json models/rouge-1/base.json --run-id 123 --decision "owner decision ..."

The pinned manifest keeps the committed schema (rouge.base-manifest/1) that
rouge_train.manifest reads. Only Apache-2.0 bases are accepted. The previous
pin is recorded under `supersedes`, so the lineage change stays auditable.

Standard library only.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path

TOKENIZER_FILES = ("chat_template.jinja", "merges.txt", "tokenizer.json", "tokenizer_config.json", "vocab.json")
SPDX = {"apache-2.0": "Apache-2.0"}
# A teacher is never trained or shipped; its self-hosted outputs may train Rouge when its weights'
# licence permits any use (MIT, Apache-2.0). API terms never apply to self-hosted weights.
TEACHER_SPDX = {"apache-2.0": "Apache-2.0", "mit": "MIT"}


def pin(raw: dict, previous: dict | None, *, run_id: str, decision: str, today: str) -> dict:
    card = (raw["license"].get("cardLicense") or "").lower()
    if card not in SPDX:
        raise SystemExit(f"refusing {raw['repo']}: licence {card!r} is not Apache-2.0")
    if raw.get("gated") or raw.get("private"):
        raise SystemExit(f"refusing {raw['repo']}: gated or private")
    if not raw["weights"]["allHashed"]:
        raise SystemExit(f"refusing {raw['repo']}: not every weight shard has a sha256")
    files = raw["files"]
    by_path = {f["path"]: f for f in files}
    repo, revision = raw["repo"], raw["revision"]
    text = (raw.get("config") or {}).get("text_config") or raw.get("config") or {}
    base_ref = f"base:{repo}@{revision}"
    lineage = [base_ref] + [n for n in (previous or {}).get("lineage", [])[1:]]
    pinned = {
        "schema": "rouge.base-manifest/1",
        "model": "rouge-1",
        "role": f"Rouge 1 base ({decision}). Rouge is a derivative of this model; it was not pretrained from scratch.",
        "source": {
            "hub": "https://huggingface.co",
            "repo": repo,
            "revision": revision,
            "pinnedAt": today,
            "verifiedBy": f"GitHub Actions run {run_id} (rouge-base-manifest.yml): Hub API + LFS sha256; small files re-hashed on download",
        },
        "license": {
            "spdx": SPDX[card],
            "cardLicense": card,
            "file": "LICENSE",
            "fileSha256": raw["license"].get("licenseFileSha256"),
            "link": raw["license"].get("licenseLink") or f"https://huggingface.co/{repo}/blob/main/LICENSE",
        },
        "gated": bool(raw.get("gated")),
        "lastModified": raw.get("lastModified"),
        "createdAt": raw.get("createdAt"),
        "library": raw.get("libraryName"),
        "pipelineTag": raw.get("pipelineTag"),
        "parameters": {
            "safetensorsTotal": raw.get("safetensorsTotal"),
            "byDtype": raw.get("safetensorsParameters"),
        },
        "weights": {
            "format": "safetensors",
            "dtype": text.get("dtype", "bfloat16"),
            "shards": raw["weights"]["shards"],
            "bytes": raw["weights"]["bytes"],
            "allHashed": True,
        },
        "context": {"nativeTokens": text.get("max_position_embeddings")},
        "tokenizer": {
            "revision": revision,
            "files": {name: by_path[name]["sha256"] for name in TOKENIZER_FILES if name in by_path},
        },
        "lineage": lineage,
        "config": raw.get("config"),
        "files": files,
    }
    if previous and previous.get("source", {}).get("repo") != repo:
        pinned["supersedes"] = {
            "repo": previous["source"]["repo"],
            "revision": previous["source"]["revision"],
            "pinnedAt": previous["source"].get("pinnedAt"),
        }
    elif previous and previous.get("supersedes"):
        pinned["supersedes"] = previous["supersedes"]
    return pinned


def pin_teacher(raw: dict, *, run_id: str, decision: str, today: str) -> dict:
    card = (raw["license"].get("cardLicense") or "").lower()
    head = raw["license"].get("licenseHead") or ""
    if card not in TEACHER_SPDX:
        raise SystemExit(f"refusing teacher {raw['repo']}: licence {card!r} is not MIT or Apache-2.0")
    if card == "mit" and "Permission is hereby granted" not in head:
        raise SystemExit(f"refusing teacher {raw['repo']}: the LICENSE file is not the MIT text")
    if raw.get("gated") or raw.get("private") or not raw["weights"]["allHashed"]:
        raise SystemExit(f"refusing teacher {raw['repo']}: gated, private or not fully hashed")
    return {
        "schema": "rouge.teacher-manifest/1",
        "role": f"Teacher for Rouge 1 ({decision}). Self-hosted weights answer prompts; only code-verified answers "
                "train Rouge. The teacher itself is never trained, shipped or named as Rouge's base.",
        "source": {"hub": "https://huggingface.co", "repo": raw["repo"], "revision": raw["revision"], "pinnedAt": today,
                   "verifiedBy": f"GitHub Actions run {run_id} (rouge-base-manifest.yml): Hub API + LFS sha256"},
        "license": {"spdx": TEACHER_SPDX[card], "cardLicense": card, "fileSha256": raw["license"].get("licenseFileSha256"),
                    "head": head[:300]},
        "weights": raw["weights"],
        "parameters": {"safetensorsTotal": raw.get("safetensorsTotal"), "byDtype": raw.get("safetensorsParameters")},
        "config": raw.get("config"),
        "files": raw["files"],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("raw")
    parser.add_argument("out")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--decision", required=True)
    parser.add_argument("--role", choices=["base", "teacher"], default="base")
    args = parser.parse_args()
    out = Path(args.out)
    today = dt.datetime.now(dt.timezone.utc).date().isoformat()
    if args.role == "teacher":
        pinned = pin_teacher(json.loads(Path(args.raw).read_text()), run_id=args.run_id, decision=args.decision, today=today)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(pinned, indent=1) + "\n")
        print(f"pinned teacher {pinned['source']['repo']}@{pinned['source']['revision']} ({pinned['weights']['bytes']} bytes)")
        return
    previous = json.loads(out.read_text()) if out.exists() else None
    pinned = pin(json.loads(Path(args.raw).read_text()), previous, run_id=args.run_id, decision=args.decision, today=today)
    out.write_text(json.dumps(pinned, indent=1) + "\n")
    print(f"pinned {pinned['source']['repo']}@{pinned['source']['revision']} "
          f"({pinned['weights']['shards']} shards, {pinned['weights']['bytes']} bytes)")


if __name__ == "__main__":
    main()
