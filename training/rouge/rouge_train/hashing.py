"""Streaming sha256 for files of any size (weights are hundreds of GB)."""

from __future__ import annotations

import hashlib
from pathlib import Path

CHUNK = 16 * 1024 * 1024


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(CHUNK), b""):
            digest.update(block)
    return digest.hexdigest()


def hash_tree(root: Path, suffixes: tuple[str, ...] | None = None) -> list[dict]:
    """Every regular file under root (relative path, size, sha256), sorted."""
    entries = []
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        if suffixes and not path.name.endswith(suffixes):
            continue
        entries.append(
            {
                "path": path.relative_to(root).as_posix(),
                "size": path.stat().st_size,
                "sha256": sha256_file(path),
            }
        )
    return entries
