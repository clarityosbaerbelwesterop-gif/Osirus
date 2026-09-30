"""Append-only, hash-chained registry of Rouge models (lineage).

Every trained model gets one entry: name (rouge-r1-100m-001, ...), parent,
code/architecture/data/tokenizer hashes, optimizer and schedule, hardware,
tokens, FLOPs, final loss, evaluations and the checkpoint manifest hash.
Each entry stores the hash of the previous entry and its own hash over its
canonical JSON, so an edited or removed entry breaks the chain (`verify`).
The registry holds hashes and numbers only, never weights.

    python -m native.registry verify [--path training/rouge/registry/models.json]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from pathlib import Path

DEFAULT = Path(__file__).resolve().parents[1] / "registry" / "models.json"
NAME = re.compile(r"^rouge-r1-(\d+[mb])-(\d{3})$")
REQUIRED = ("name", "parent", "code_sha", "architecture_sha", "data_sha", "tokenizer_sha", "optimizer", "schedule",
            "hardware", "tokens", "train_flops", "final_loss", "evals", "checkpoint_sha")
GENESIS = "0" * 64


def canonical(entry: dict) -> bytes:
    return json.dumps({k: v for k, v in entry.items() if k != "entry_hash"}, sort_keys=True, separators=(",", ":")).encode()


def load(path: Path = DEFAULT) -> dict:
    return json.loads(Path(path).read_text()) if Path(path).exists() else {"schema": "rouge.registry/1", "entries": []}


def verify(reg: dict) -> list[str]:
    """Problems in the chain (empty when intact)."""
    problems, prev, names = [], GENESIS, set()
    for i, e in enumerate(reg["entries"]):
        if e.get("prev_hash") != prev:
            problems.append(f"entry {i} ({e.get('name')}): prev_hash does not match entry {i - 1}")
        if hashlib.sha256(canonical(e)).hexdigest() != e.get("entry_hash"):
            problems.append(f"entry {i} ({e.get('name')}): content does not match its hash")
        if e.get("parent") not in (None, *names):
            problems.append(f"entry {i} ({e.get('name')}): parent {e.get('parent')} is not an earlier entry")
        names.add(e.get("name"))
        prev = e.get("entry_hash")
    return problems


def next_name(reg: dict, size: str) -> str:
    n = sum(1 for e in reg["entries"] if (m := NAME.match(e["name"])) and m.group(1) == size)
    return f"rouge-r1-{size}-{n + 1:03d}"


def append(reg: dict, entry: dict, path: Path | None = DEFAULT) -> dict:
    missing = [k for k in REQUIRED if k not in entry]
    if missing:
        raise ValueError(f"registry entry lacks {missing}")
    if not NAME.match(entry["name"]):
        raise ValueError(f"name {entry['name']} does not follow rouge-r1-<size>-<nnn>")
    if any(e["name"] == entry["name"] for e in reg["entries"]):
        raise ValueError(f"{entry['name']} is already registered")
    problems = verify(reg)
    if problems:
        raise ValueError(f"registry chain is broken: {problems}")
    entry = {**entry, "registered": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
             "prev_hash": reg["entries"][-1]["entry_hash"] if reg["entries"] else GENESIS}
    entry["entry_hash"] = hashlib.sha256(canonical(entry)).hexdigest()
    reg["entries"].append(entry)
    if verify(reg):
        raise AssertionError("appending broke the chain")
    if path is not None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(json.dumps(reg, indent=1) + "\n")
    return entry


def entry_from_result(result: dict, name: str, parent: str | None, code_sha: str, tokenizer_sha: str, checkpoint_sha: str,
                      optimizer: dict, schedule: dict, hardware: str) -> dict:
    """Registry entry from a trainer result.json (native.train)."""
    return {"name": name, "parent": parent, "code_sha": code_sha, "architecture_sha": result["architecture_sha"],
            "data_sha": result["data_sha"], "tokenizer_sha": tokenizer_sha, "optimizer": optimizer, "schedule": schedule,
            "hardware": hardware, "tokens": result["tokens"],
            "train_flops": result["spec"]["flops_per_token_train"] * result["tokens"],
            "final_loss": result["final_train_loss"], "evals": result.get("eval", {}), "checkpoint_sha": checkpoint_sha,
            "params": result["spec"]["params_physical"], "stored_bytes": result["spec"]["stored_bytes"]}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["verify"])
    parser.add_argument("--path", default=str(DEFAULT))
    args = parser.parse_args()
    problems = verify(load(Path(args.path)))
    print("registry intact" if not problems else "\n".join(problems))
    raise SystemExit(1 if problems else 0)


if __name__ == "__main__":
    main()
