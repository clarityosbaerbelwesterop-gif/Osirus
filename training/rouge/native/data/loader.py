"""Batches from token shards (memory-mapped), mixed by source weights.

Deterministic and resumable without state: the batch for step s on rank r is
a pure function of (seed, s, r), so resuming at step s reproduces exactly the
batches an uninterrupted run would have seen.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import torch


class ShardSet:
    def __init__(self, root: str | Path, split: str, mixture: dict | None = None):
        self.root = Path(root)
        self.manifest = json.loads((self.root / "manifest.json").read_text())
        self.dtype = np.uint16 if self.manifest["tokenizer"]["vocab"] <= 65535 else np.uint32
        self.arrays, weights = {}, {}
        for name, src in self.manifest["sources"].items():
            files = src["shards"][split]["files"]
            if not files:
                continue
            self.arrays[name] = [np.memmap(self.root / f["path"], dtype=self.dtype, mode="r") for f in files]
            weights[name] = (mixture or self.manifest["mixture"]).get(name, 0.0)
        total = sum(weights.values())
        self.names = sorted(n for n in weights if weights[n] > 0)
        self.weights = np.array([weights[n] / total for n in self.names])

    def batch(self, seed: int, step: int, rank: int, batch: int, seq: int) -> tuple[torch.Tensor, torch.Tensor]:
        rng = np.random.default_rng([seed, step, rank])
        rows = []
        for src in rng.choice(len(self.names), size=batch, p=self.weights):
            arrays = self.arrays[self.names[src]]
            sizes = np.array([a.size for a in arrays], dtype=np.float64)
            a = arrays[rng.choice(len(arrays), p=sizes / sizes.sum())]
            start = int(rng.integers(0, max(1, a.size - seq - 1)))
            rows.append(np.asarray(a[start:start + seq + 1], dtype=np.int64))
        x = torch.from_numpy(np.stack(rows))
        return x[:, :-1], x[:, 1:]

    def windows(self, name: str, seq: int, limit: int) -> torch.Tensor:
        """Non-overlapping windows from the start of a source's shards (evaluation)."""
        data = np.concatenate([np.asarray(a, dtype=np.int64) for a in self.arrays[name]])
        n = min(limit, (data.size - 1) // seq)
        return torch.from_numpy(np.stack([data[i * seq:i * seq + seq + 1] for i in range(n)])) if n else torch.empty(0, seq + 1, dtype=torch.long)
