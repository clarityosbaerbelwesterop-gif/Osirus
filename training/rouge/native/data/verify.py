"""Verify a built corpus against its manifest (sha256 of every shard) without rebuilding it.

    python -m native.data.verify --data DIR [--manifest MANIFEST]

Exit 0 when every shard listed in the manifest exists with the recorded
hash and token count, and the tokenizer matches; exit 1 otherwise.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path


def verify(data: Path, manifest: dict) -> list[str]:
    problems = []
    tok = data / "tokenizer.json"
    if not tok.exists() or hashlib.sha256(tok.read_bytes()).hexdigest() != manifest["tokenizer"]["sha256"]:
        problems.append("tokenizer.json missing or different")
    width = 2 if manifest["tokenizer"]["vocab"] <= 65535 else 4
    for name, src in manifest["sources"].items():
        for split in ("train", "val"):
            for f in src["shards"][split]["files"]:
                path = data / f["path"]
                if not path.exists():
                    problems.append(f"{f['path']}: missing")
                    continue
                h = hashlib.sha256()
                with open(path, "rb") as fh:
                    for block in iter(lambda: fh.read(1 << 24), b""):
                        h.update(block)
                if h.hexdigest() != f["sha256"]:
                    problems.append(f"{f['path']}: sha256 differs")
                elif path.stat().st_size != f["tokens"] * width:
                    problems.append(f"{f['path']}: size differs")
    return problems


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--manifest", help="expected manifest (default: DATA/manifest.json)")
    args = parser.parse_args()
    data = Path(args.data)
    manifest = json.loads(Path(args.manifest or data / "manifest.json").read_text())
    problems = verify(data, manifest)
    shards = sum(len(s["shards"][sp]["files"]) for s in manifest["sources"].values() for sp in ("train", "val"))
    if problems:
        print("\n".join(problems))
        sys.exit(1)
    print(f"[data] {shards} shards verified against the manifest")


if __name__ == "__main__":
    main()
