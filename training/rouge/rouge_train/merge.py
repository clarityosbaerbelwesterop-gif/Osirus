"""Merge a trained adapter into the base: a canonical Rouge checkpoint.

The merged checkpoint is a complete model of the base's architecture --
same config class, same tokenizer, same vision tower -- whose language-model
weights now carry the adapter. Tensors the loading class does not keep (the
base's multi-token-prediction head, used for speculative decoding) are
copied over unchanged, so nothing of the base is lost.

`weight_delta` then proves the checkpoint differs from its base: it lists
how many tensors changed and by how much.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import torch

from .config import RunConfig
from .hashing import hash_tree


def merge(config: RunConfig, adapter_dir: str | Path, out_dir: str | Path) -> dict:
    from peft import PeftModel
    from transformers import AutoModelForImageTextToText, AutoTokenizer

    out = Path(out_dir)
    if out.exists():
        shutil.rmtree(out)
    # Merging is done in full precision on the unquantised base: a QLoRA
    # adapter is merged into the BF16 weights, never into 4-bit ones.
    base = AutoModelForImageTextToText.from_pretrained(
        config.base_path, dtype=torch.bfloat16 if config.dtype == "bfloat16" else torch.float32
    )
    merged = PeftModel.from_pretrained(base, str(adapter_dir)).merge_and_unload()
    merged.save_pretrained(out, safe_serialization=True, max_shard_size="5GB")
    AutoTokenizer.from_pretrained(config.tokenizer_path).save_pretrained(out)
    for extra in ("chat_template.jinja", "generation_config.json", "preprocessor_config.json", "video_preprocessor_config.json"):
        source = Path(config.base_path) / extra
        if source.exists() and not (out / extra).exists():
            shutil.copy(source, out / extra)
    carried = carry_missing_tensors(Path(config.base_path), out)
    return {"files": hash_tree(out), "carried_from_base": carried}


def _index(path: Path) -> dict[str, str]:
    index = path / "model.safetensors.index.json"
    if index.exists():
        return json.loads(index.read_text())["weight_map"]
    single = path / "model.safetensors"
    if single.exists():
        from safetensors import safe_open

        with safe_open(str(single), "pt") as handle:
            return {key: "model.safetensors" for key in handle.keys()}
    return {}


def carry_missing_tensors(base: Path, out: Path) -> list[str]:
    """Copy base tensors the merged save dropped (e.g. mtp.*) into the output."""
    from safetensors import safe_open
    from safetensors.torch import save_file

    base_map, out_map = _index(base), _index(out)
    missing = sorted(set(base_map) - set(out_map))
    if not missing:
        return []
    tensors = {}
    for key in missing:
        with safe_open(str(base / base_map[key]), "pt") as handle:
            tensors[key] = handle.get_tensor(key)
    extra = "model-extra-from-base.safetensors"
    save_file(tensors, str(out / extra), metadata={"format": "pt"})
    index_path = out / "model.safetensors.index.json"
    if index_path.exists():
        index = json.loads(index_path.read_text())
    else:
        index = {"metadata": {}, "weight_map": dict(out_map)}
    index["weight_map"].update({key: extra for key in missing})
    index_path.write_text(json.dumps(index, indent=2))
    return missing


def weight_delta(base: Path, candidate: Path) -> dict:
    """How the candidate's weights differ from the base's, tensor by tensor."""
    from safetensors import safe_open

    base_map, cand_map = _index(base), _index(candidate)
    changed, unchanged, max_abs, compared = [], 0, 0.0, 0
    for key in sorted(set(base_map) & set(cand_map)):
        with safe_open(str(base / base_map[key]), "pt") as b, safe_open(
            str(candidate / cand_map[key]), "pt"
        ) as c:
            x, y = b.get_tensor(key).float(), c.get_tensor(key).float()
        compared += 1
        if x.shape != y.shape:
            changed.append(key)
            continue
        diff = (x - y).abs().max().item()
        if diff > 0:
            changed.append(key)
            max_abs = max(max_abs, diff)
        else:
            unchanged += 1
    return {
        "compared": compared,
        "changed": len(changed),
        "unchanged": unchanged,
        "max_abs_diff": max_abs,
        "changed_examples": changed[:10],
        "only_in_base": sorted(set(base_map) - set(cand_map))[:10],
        "only_in_candidate": sorted(set(cand_map) - set(base_map))[:10],
    }
