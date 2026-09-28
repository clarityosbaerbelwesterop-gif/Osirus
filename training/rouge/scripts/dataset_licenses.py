#!/usr/bin/env python3
"""Read each Hub dataset's licence and current revision (metadata only).

For every registry entry whose source is `hf:<repo>`, prints the Hub's
revision sha, the card licence, gating and the card's licence tags. The
output is evidence for approving an entry; it changes nothing by itself.
Standard library only.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

REGISTRY = Path(__file__).resolve().parent.parent / "data" / "registry.json"


def main() -> None:
    registry = json.loads(REGISTRY.read_text())
    results = []
    for entry in registry["datasets"]:
        if not entry["source"].startswith("hf:"):
            continue
        repo = entry["source"][3:]
        try:
            request = urllib.request.Request(
                f"https://huggingface.co/api/datasets/{repo}",
                headers={"User-Agent": "rouge-registry/1"},
            )
            with urllib.request.urlopen(request, timeout=60) as response:
                info = json.load(response)
            card = info.get("cardData") or {}
            results.append(
                {
                    "id": entry["id"],
                    "repo": repo,
                    "revision": info.get("sha"),
                    "lastModified": info.get("lastModified"),
                    "gated": info.get("gated"),
                    "cardLicense": card.get("license"),
                    "licenseTags": [t for t in info.get("tags", []) if t.startswith("license:")],
                    "registryLicense": entry["license"],
                }
            )
        except urllib.error.HTTPError as error:
            results.append({"id": entry["id"], "repo": repo, "error": error.code})
    json.dump(results, sys.stdout, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
