#!/usr/bin/env python3
"""Verify a downloaded base model against the pinned manifest.

Run on the GPU host after downloading the pinned revision, before any
training or evaluation:

    python training/rouge/scripts/verify_weights.py /models/Qwen3.5-397B-A17B

Exits non-zero if any pinned file is missing or differs.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from rouge_train.manifest import load_base, verify_download  # noqa: E402


def main() -> None:
    root = Path(sys.argv[1])
    manifest = load_base()
    result = verify_download(root, manifest)
    print(
        f"{manifest['source']['repo']}@{manifest['source']['revision']}: "
        f"checked {result.checked}, missing {len(result.missing)}, "
        f"mismatched {len(result.mismatched)}"
    )
    for path in result.missing:
        print(f"missing  {path}")
    for path in result.mismatched:
        print(f"mismatch {path}")
    sys.exit(0 if result.ok else 1)


if __name__ == "__main__":
    main()
