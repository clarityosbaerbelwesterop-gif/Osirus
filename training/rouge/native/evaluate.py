"""Evaluation for native Rouge checkpoints (independent of the trainer's state).

- val_losses: next-token loss per source on validation windows, reported as
  nats per token and bits per byte (tokens-per-byte from the data manifest);
- tasks: exact match of the greedy continuation on held-out generated math
  and algorithmic items (seeds disjoint from training);
- passkey: a 5-digit code stated once, followed by D tokens of validation
  text, then asked for; accuracy by distance (inside and beyond the training
  length): exact retrieval over distance, the capability R1.16 found missing;
- decode throughput and memory figures.
"""

from __future__ import annotations

import math
import random
import time
from pathlib import Path

import torch

from .data import synth
from .data.build import load_tokenizer

LN2 = math.log(2)


@torch.no_grad()
def val_losses(model, val, seq: int, windows: int, device) -> dict:
    out = {}
    for name in sorted(val.arrays):
        w = val.windows(name, seq, windows)
        if not len(w):
            continue
        total, count = 0.0, 0
        for i in range(0, len(w), 8):
            x = w[i:i + 8].to(device)
            loss = model(x[:, :-1], x[:, 1:])
            total += loss.item() * x[:, 1:].numel()
            count += x[:, 1:].numel()
        nats = total / count
        entry = val.manifest["sources"][name]["shards"]["val"]
        tokens_per_byte = entry["tokens"] / entry["bytes"] if entry.get("bytes") else float("nan")
        out[name] = {"nats_per_token": round(nats, 4), "bpb": round(nats * tokens_per_byte / LN2, 4)}
    return out


@torch.no_grad()
def greedy(model, ids: list[int], max_new: int, device, stop: int | None = None) -> list[int]:
    cache = model.init_cache()
    x = torch.tensor([ids], device=device)
    logits, cache = model(x, cache=cache, start=0)
    pos, new = len(ids), []
    for _ in range(max_new):
        nxt = int(logits[0, -1].argmax())
        if stop is not None and nxt == stop:
            break
        new.append(nxt)
        logits, cache = model(torch.tensor([[nxt]], device=device), cache=cache, start=pos)
        pos += 1
    return new


def task_accuracy(model, tok, kind: str, n: int, device) -> float:
    newline = tok.encode("\n").ids
    stop = newline[0] if len(newline) == 1 else None
    ok = 0
    for prompt, answer in synth.eval_items(kind, n):
        ids = tok.encode(prompt).ids
        out = tok.decode(greedy(model, ids, len(tok.encode(" " + answer).ids) + 2, device, stop)).strip().split("\n")[0]
        ok += out == answer
    return ok / n


def passkey(model, tok, val, distances: list[int], trials: int, device) -> dict:
    shards = val.arrays.get("web_en") or next(iter(val.arrays.values()))   # a list of shard arrays
    filler = torch.from_numpy(__import__("numpy").concatenate([a[:] for a in shards]).astype("int64"))
    rng = random.Random("passkey")
    out = {}
    for d in distances:
        hits = 0
        for t in range(trials):
            key = f"{rng.randrange(10000, 99999)}"
            start = rng.randrange(0, max(1, filler.numel() - d - 1))
            ids = (tok.encode(f"The secret code is {key}. Remember it.\n").ids + filler[start:start + d].tolist()
                   + tok.encode(f"\nWhat is the secret code? The secret code is").ids)
            got = tok.decode(greedy(model, ids, 6, device)).strip()
            hits += got.startswith(key)
        out[str(d)] = hits / trials
    return out


@torch.no_grad()
def decode_speed(model, device, context: int = 512, new: int = 64) -> float:
    """Tokens per second when generating after a prefilled context (batch 1, KV cache)."""
    ids = torch.randint(0, model.cfg.vocab_size, (1, context), device=device)
    logits, cache = model(ids, cache=model.init_cache(), start=0)
    if device.type == "cuda":
        torch.cuda.synchronize()
    t0, pos = time.time(), context
    for _ in range(new):
        logits, cache = model(logits[:, -1:].argmax(-1), cache=cache, start=pos)
        pos += 1
    if device.type == "cuda":
        torch.cuda.synchronize()
    return round(new / (time.time() - t0), 1)


def full(model, val, data_dir: str, seq: int, device, tasks: bool = True) -> dict:
    tok = load_tokenizer(Path(data_dir) / "tokenizer.json")
    result = {"val": val_losses(model, val, seq, 256, device)}
    web = [v["bpb"] for k, v in result["val"].items() if k in ("web_en", "web_de", "code_py", "math_web")]
    result["val_bpb_mean"] = round(sum(web) / len(web), 4) if web else None
    if tasks:
        result["tasks"] = {k: task_accuracy(model, tok, k, 200, device) for k in ("math_synth", "algo_synth")}
        result["passkey"] = passkey(model, tok, val, [256, seq - 64, 2 * seq, 4 * seq], 20, device)
        result["decode_tokens_per_s"] = decode_speed(model, device)
    return result
