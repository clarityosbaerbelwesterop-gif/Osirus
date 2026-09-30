"""Merge per-source corpus manifests (one runner per source) into one corpus manifest.

    python -m native.data.merge --mixture v5 --total 11.5e9 --corpus pretrain-v4 --out manifest.json PART_MANIFEST...

Every part must use the same tokenizer and decontamination rule; each part's shards keep their paths
(train/<source>_NNNN.bin, val/<source>_NNNN.bin), so the parts unpack into one directory. The merged
manifest lists where each part is stored (`parts`: source -> Lightning registry path).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from . import sources


def merge(parts: list[dict], mixture_name: str, total: float, corpus: str) -> dict:
    mixture = sources.MIXTURES[mixture_name]
    if not parts:
        raise SystemExit("no parts")
    tok = {p["tokenizer"]["sha256"] for p in parts}
    rules = {p.get("decontamination_rule", "v1") for p in parts}
    if len(tok) != 1 or len(rules) != 1:
        raise SystemExit(f"parts disagree: tokenizers {sorted(tok)}, rules {sorted(rules)}")
    merged_sources = {}
    for p in parts:
        for name, src in p["sources"].items():
            if name in merged_sources:
                raise SystemExit(f"source {name} appears in two parts")
            merged_sources[name] = src
    missing = sorted(set(mixture) - set(merged_sources))
    if missing:
        raise SystemExit(f"parts missing for {missing}")
    code = next((p for p in parts if "code_py" in p["sources"]), {})
    return {
        "schema": "rouge.data/1",
        "mixture": mixture, "total_tokens": int(total), "mixture_name": mixture_name,
        "revisions": {k: v for p in parts for k, v in p.get("revisions", {}).items() if k in merged_sources},
        "code_set": code.get("code_set"), "code_projects": code.get("code_projects"), "code_missing": code.get("code_missing"),
        "tokenizer": parts[0]["tokenizer"],
        "sources": {n: merged_sources[n] for n in mixture},
        "decontamination_rule": rules.pop(),
        "max_epochs": sources.MAX_EPOCHS.get(mixture_name, {}),
        "dedup": parts[0].get("dedup"), "contamination": parts[0].get("contamination"),
        "code_sha": parts[0].get("code_sha"),
        "parts": {n: f"rouge/data/{corpus}/{n}" for n in mixture},
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mixture", required=True)
    parser.add_argument("--total", type=float, required=True)
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("parts", nargs="+")
    args = parser.parse_args()
    manifest = merge([json.loads(Path(p).read_text()) for p in args.parts], args.mixture, args.total, args.corpus)
    Path(args.out).write_text(json.dumps(manifest, indent=1) + "\n")
    print(json.dumps({n: s["shards"]["train"]["tokens"] for n, s in manifest["sources"].items()}))


if __name__ == "__main__":
    main()
