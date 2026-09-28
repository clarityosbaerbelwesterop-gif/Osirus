#!/usr/bin/env python3
"""Download the pinned base's tokenizer and chat template, verified.

Fetches only the small tokenizer files at the exact pinned revision and
checks each against the sha256 in models/rouge-1/base.json. Stdlib only.

    python training/rouge/scripts/fetch_tokenizer.py /tmp/qwen-tokenizer
"""

from __future__ import annotations

import hashlib
import json
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from rouge_train.manifest import load_base  # noqa: E402

FILES = (
    "tokenizer.json",
    "tokenizer_config.json",
    "vocab.json",
    "merges.txt",
    "chat_template.jinja",
    "generation_config.json",
)


def main() -> None:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    base = load_base()
    repo, revision = base["source"]["repo"], base["source"]["revision"]
    pinned = {f["path"]: f for f in base["files"]}
    for name in FILES:
        entry = pinned[name]
        url = f"https://huggingface.co/{repo}/resolve/{revision}/{name}"
        request = urllib.request.Request(url, headers={"User-Agent": "rouge-train/1"})
        with urllib.request.urlopen(request, timeout=120) as response:
            body = response.read()
        digest = hashlib.sha256(body).hexdigest()
        if digest != entry["sha256"]:
            raise SystemExit(f"{name}: sha256 {digest} != pinned {entry['sha256']}")
        (out / name).write_bytes(body)
        print(f"verified {name} ({len(body)} bytes)")


if __name__ == "__main__":
    main()
