#!/usr/bin/env python3
"""Inspect candidate Hub datasets before writing their adapters.

For each repo: the card licence and revision, configs, splits, feature
names, and one example with every field cut to a short preview. Public
metadata and a few hundred characters of public data -- nothing is stored.

    python training/rouge/datasets/probe.py
"""

from __future__ import annotations

import json
import sys

CANDIDATES = [
    "nvidia/Nemotron-Post-Training-Dataset-v1",
    "nvidia/Nemotron-Post-Training-Dataset-v2",
    "open-r1/OpenR1-Math-220k",
    "nvidia/OpenMathReasoning",
    "nvidia/OpenCodeReasoning",
    "allenai/tulu-3-sft-mixture",
    # evaluation-only candidates
    "google-research-datasets/mbpp",
    "juletxara/mgsm",
    "google/IFEval",
]


def preview(value, width=160):
    text = json.dumps(value, ensure_ascii=False, default=str)
    return text if len(text) <= width else text[:width] + "..."


def main() -> None:
    from datasets import get_dataset_config_names, get_dataset_split_names, load_dataset
    from huggingface_hub import HfApi

    api = HfApi()
    for repo in CANDIDATES:
        print(f"\n=== {repo}")
        try:
            info = api.dataset_info(repo)
            card = info.card_data.to_dict() if info.card_data else {}
            print("revision", info.sha, "license", card.get("license"), "gated", info.gated)
            configs = get_dataset_config_names(repo)
            print("configs", configs[:20])
            for config in configs[:3]:
                splits = get_dataset_split_names(repo, config)
                print(f"  config {config!r} splits {splits[:12]}")
                split = splits[0]
                row = next(iter(load_dataset(repo, config, split=split, streaming=True)))
                print(f"  features {list(row)}")
                for key, value in row.items():
                    print(f"    {key}: {preview(value)}")
        except Exception as error:  # probing: report and continue
            print("ERROR", type(error).__name__, str(error)[:300])
        sys.stdout.flush()


if __name__ == "__main__":
    main()
