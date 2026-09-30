"""Checkpoints for native Rouge training: atomic, hashed, resumable.

Layout: <run>/checkpoints/step_000123/{model.pt, optim.pt, meta.json}.
meta.json records the step, the configuration and its architecture_sha, the
data manifest hash, the training state (tokens seen, spike counter) and the
sha256 of every file; `latest()` returns the newest checkpoint whose files
match their hashes, so a checkpoint cut off by a crash is never resumed.

Single process and DDP save full state from rank 0. FSDP2 runs save through
torch.distributed.checkpoint (sharded, one directory per step); the same
meta.json and hash rules apply to every shard file.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import time
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rouge_train.hashing import hash_tree  # noqa: E402  (M58 streaming sha256)


def _dist():
    return torch.distributed.is_available() and torch.distributed.is_initialized()


def save(run_dir: Path, step: int, model, optimizer, meta: dict, keep: int = 2, sharded: bool = False) -> Path:
    ckpts = Path(run_dir) / "checkpoints"
    final = ckpts / f"step_{step:07d}"
    tmp = ckpts / f".tmp_step_{step:07d}"
    rank = torch.distributed.get_rank() if _dist() else 0
    if rank == 0:
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir(parents=True)
    if _dist():
        torch.distributed.barrier()
    if sharded:
        import torch.distributed.checkpoint as dcp
        from torch.distributed.checkpoint.state_dict import get_state_dict

        model_sd, optim_sd = get_state_dict(model, optimizer)
        dcp.save({"model": model_sd, "optim": optim_sd}, checkpoint_id=str(tmp / "dcp"))
    elif rank == 0:
        raw = model.module if hasattr(model, "module") else model
        torch.save(raw.state_dict(), tmp / "model.pt")
        torch.save(optimizer.state_dict(), tmp / "optim.pt")
    if _dist():
        torch.distributed.barrier()
    if rank == 0:
        body = {**meta, "step": step, "saved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "sharded": sharded}
        body["files"] = hash_tree(tmp)
        (tmp / "meta.json").write_text(json.dumps(body, indent=1))
        os.replace(tmp, final)                                                     # atomic on one filesystem
        for old in sorted(ckpts.glob("step_*"))[:-keep]:
            shutil.rmtree(old, ignore_errors=True)
    if _dist():
        torch.distributed.barrier()
    return final


def verify(path: Path) -> dict | None:
    meta_path = Path(path) / "meta.json"
    if not meta_path.exists():
        return None
    meta = json.loads(meta_path.read_text())
    actual = {f["path"]: f["sha256"] for f in hash_tree(Path(path)) if f["path"] != "meta.json"}
    expected = {f["path"]: f["sha256"] for f in meta["files"]}
    return meta if actual == expected else None


def latest(run_dir: Path) -> tuple[Path, dict] | None:
    for path in sorted((Path(run_dir) / "checkpoints").glob("step_*"), reverse=True):
        meta = verify(path)
        if meta is not None:
            return path, meta
    return None


def load(path: Path, model, optimizer, meta: dict) -> None:
    raw = model.module if hasattr(model, "module") else model
    if meta.get("sharded"):
        # get_state_dict initialises the optimizer state, so the saved moments have somewhere to load into
        import torch.distributed.checkpoint as dcp
        from torch.distributed.checkpoint.state_dict import get_state_dict, set_state_dict

        model_sd, optim_sd = get_state_dict(model, optimizer)
        state = {"model": model_sd, "optim": optim_sd}
        dcp.load(state, checkpoint_id=str(Path(path) / "dcp"))
        set_state_dict(model, optimizer, model_state_dict=state["model"], optim_state_dict=state["optim"])
    else:
        raw.load_state_dict(torch.load(Path(path) / "model.pt", map_location="cpu", weights_only=True))
        optimizer.load_state_dict(torch.load(Path(path) / "optim.pt", map_location="cpu", weights_only=True))
