"""Byte-level language modelling data (R1.14, R1.16): enwik8.

enwik8 is the first 10^8 bytes of an English Wikipedia XML dump (Hutter
prize). The standard split is used: the first 90 MB for training, the next
5 MB for validation and the last 5 MB for test. The metric is bits per byte
(BPB): no tokenizer, so every architecture is scored on the same units.

The file is downloaded once into ROUGE_DATA (default ~/.cache/rouge-data)
and its SHA-256 is recorded with every run; the report checks that all
runs saw the same bytes. ROUGE_TEXT_FILE replaces it with a local file for
smoke tests only (every result then records that path and hash, so a smoke
run can never pass for an enwik8 run).

Training batches are B parallel streams that each walk forward through
their own region of the training bytes, `length` bytes per step; recurrent
models carry their state from one step to the next (truncated
backpropagation through time), Transformers see each segment on its own.
Both see exactly the same bytes in the same order.
"""

from __future__ import annotations

import hashlib
import io
import math
import os
import random
import urllib.request
import zipfile
from pathlib import Path

import torch

URLS = ("https://mattmahoney.net/dc/enwik8.zip", "http://mattmahoney.net/dc/enwik8.zip")
SIZE = 100_000_000
TRAIN, VALID = 90_000_000, 95_000_000


def _cache() -> Path:
    return Path(os.environ.get("ROUGE_DATA", Path.home() / ".cache" / "rouge-data"))


def path() -> Path:
    local = os.environ.get("ROUGE_TEXT_FILE")
    if local:
        return Path(local)
    target = _cache() / "enwik8"
    if target.exists() and target.stat().st_size == SIZE:
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    last = None
    for url in URLS:
        for attempt in range(3):
            try:
                with urllib.request.urlopen(url, timeout=120) as response:
                    blob = response.read()
                data = zipfile.ZipFile(io.BytesIO(blob)).read("enwik8")
                if len(data) != SIZE:
                    raise ValueError(f"enwik8 has {len(data)} bytes, expected {SIZE}")
                tmp = target.with_suffix(".tmp")
                tmp.write_bytes(data)
                tmp.replace(target)
                return target
            except Exception as error:  # network or archive problem: retry, then the next mirror
                last = error
    raise RuntimeError(f"enwik8 download failed: {last}")


class Corpus:
    def __init__(self):
        p = path()
        raw = p.read_bytes()
        self.source = "enwik8" if not os.environ.get("ROUGE_TEXT_FILE") else f"local:{p}"
        self.sha256 = hashlib.sha256(raw).hexdigest()
        if self.source == "enwik8":
            cuts = (TRAIN, VALID)
        else:  # smoke-test file: the same 90/5/5 proportions
            cuts = (int(len(raw) * 0.9), int(len(raw) * 0.95))
        data = torch.frombuffer(bytearray(raw), dtype=torch.uint8)
        self.splits = {"train": data[:cuts[0]], "valid": data[cuts[0]:cuts[1]], "test": data[cuts[1]:]}


class Streams:
    """B streams through the training bytes. Each stream starts at a random
    offset in its own 1/B region and restarts at a new random offset of that
    region when it reaches the end (the model's state is then reset)."""

    def __init__(self, train: torch.Tensor, batch: int, length: int, seed: int, span: int = 0):
        self.data, self.batch, self.length = train, batch, length
        self.region = len(train) // batch
        # start early enough that a stream walking `span` bytes never restarts (when the region allows)
        self.room = max(self.length + 1, self.region - max(span, 64 * length) - length - 1)
        self.rng = random.Random(f"text-streams:{seed}")
        self.pos = [self._start(b) for b in range(batch)]

    def _start(self, b: int) -> int:
        return b * self.region + self.rng.randrange(0, self.room)

    def next(self) -> tuple[torch.Tensor, torch.Tensor]:
        """(bytes, reset): bytes is (B, length + 1); reset[b] is True when stream b restarted."""
        rows, reset = [], []
        for b in range(self.batch):
            end = (b + 1) * self.region
            restarted = self.pos[b] + self.length + 1 > end
            if restarted:
                self.pos[b] = self._start(b)
            rows.append(self.data[self.pos[b]:self.pos[b] + self.length + 1])
            reset.append(restarted)
            self.pos[b] += self.length
        return torch.stack(rows).long(), torch.tensor(reset)

    def state(self) -> dict:
        return {"pos": list(self.pos), "rng": self.rng.getstate()}

    def restore(self, saved: dict) -> None:
        self.pos = list(saved["pos"])
        self.rng.setstate(saved["rng"])


def segments(split: torch.Tensor, length: int, count: int) -> torch.Tensor:
    """`count` non-overlapping segments of length + 1 bytes from the start of a split."""
    usable = min(count, (len(split) - 1) // length)
    return torch.stack([split[i * length:i * length + length + 1] for i in range(usable)]).long()


def streams(split: torch.Tensor, length: int, count: int) -> torch.Tensor:
    """`count` long streams of length + 1 bytes, evenly spaced through a split."""
    step = (len(split) - length - 1) // count
    return torch.stack([split[i * step:i * step + length + 1] for i in range(count)]).long()


def ngram_floor(train: torch.Tensor, evaluate: torch.Tensor, order: int, sample: int = 5_000_000) -> float:
    """Bits per byte of an add-one-smoothed byte n-gram model (order 1 = unigram):
    the floor any trained model must beat to have learned more than local byte statistics."""
    counts: dict[bytes, list[int]] = {}
    t = bytes(train[:sample].tolist())
    for i in range(order - 1, len(t)):
        ctx = t[i - order + 1:i]
        row = counts.setdefault(ctx, [0] * 257)
        row[t[i]] += 1
        row[256] += 1
    e = bytes(evaluate.tolist())
    bits = 0.0
    for i in range(order - 1, len(e)):
        row = counts.get(e[i - order + 1:i])
        p = ((row[e[i]] if row else 0) + 1) / ((row[256] if row else 0) + 256)
        bits -= math.log2(p)
    return bits / max(1, len(e) - order + 1)
