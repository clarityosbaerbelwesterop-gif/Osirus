#!/usr/bin/env python3
"""R1.22: does algorithmic sparsity save wall-clock time on real hardware?

Times forward+backward of one MLP layer on `tokens` tokens:
- dense-active: hidden = top_k x expert_hidden (same FLOPs as the MoE);
- dense-total:  hidden = experts x expert_hidden (same parameters as the MoE);
- moe-gather:   prototypes/sparse_circuits.MoE (each expert runs only on its tokens);
- moe-masked:   every expert on every token, then masked (dense execution of a sparse model).

    python lab/kernels.py [--out results/r1.22]
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import statistics
import sys
import time
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from prototypes.sparse_circuits import MoE  # noqa: E402


class Masked(MoE):
    def forward(self, x):
        flat = x.reshape(-1, x.shape[-1])
        probs = F.softmax(self.router(flat), -1)
        weight, chosen = probs.topk(self.top_k, -1)
        weight = weight / weight.sum(-1, keepdim=True)
        h = F.gelu(torch.einsum("nd,edh->enh", flat, self.w1) + self.b1[:, None, :])
        y = torch.einsum("enh,ehd->end", h, self.w2) + self.b2[:, None, :]       # all experts, all tokens
        gate = torch.zeros(flat.shape[0], self.experts).scatter(1, chosen, weight)
        return torch.einsum("end,ne->nd", y, gate).view(x.shape)


def dense(d, hidden):
    return nn.Sequential(nn.Linear(d, hidden), nn.GELU(), nn.Linear(hidden, d))


def time_layer(layer, x, repeats):
    for _ in range(3):
        layer(x).sum().backward()
    times = []
    for _ in range(repeats):
        t0 = time.perf_counter()
        layer(x).sum().backward()
        times.append(time.perf_counter() - t0)
    return statistics.median(times)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prereg", default=str(Path(__file__).resolve().parent.parent / "experiments" / "r1_22.json"))
    parser.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "results" / "r1.22"))
    args = parser.parse_args()
    setup = json.loads(Path(args.prereg).read_text())["setup"]
    torch.manual_seed(1)
    torch.set_num_threads(os.cpu_count())
    e, k, n = setup["experts"], setup["top_k"], setup["tokens_per_batch"]
    rows = []
    for d in setup["widths"]:
        h = 2 * d
        x = torch.randn(n, d, requires_grad=False)
        layers = {"dense-active": dense(d, k * h), "dense-total": dense(d, e * h), "moe-gather": MoE(d, e, h, k), "moe-masked": Masked(d, e, h, k)}
        row = {"d": d}
        for name, layer in layers.items():
            row[name] = time_layer(layer, x, setup["repeats"])
            row[f"{name}.params"] = sum(p.numel() for p in layer.parameters())
        rows.append(row)
        print(json.dumps(row), flush=True)
    big, small = rows[-1], rows[0]
    checks = {"K1_saves_vs_total": big["moe-gather"] <= 0.5 * big["dense-total"],
              "K2_overhead_vs_active": big["moe-gather"] <= 1.5 * big["dense-active"],
              "K3_small_overhead_ratio": round(small["moe-gather"] / small["dense-active"], 2)}
    result = "PASS" if checks["K1_saves_vs_total"] and checks["K2_overhead_vs_active"] else "PARTIAL" if checks["K1_saves_vs_total"] else "FAIL"
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    summary = {"experiment": "R1.22", "rows": rows, "decision": {"complete": True, "checks": checks, "result": result},
               "hardware": {"machine": platform.machine(), "cpus": os.cpu_count(), "torch": torch.__version__,
                            "processor": platform.processor(), "runner": os.environ.get("RUNNER_NAME", "local container")}}
    (out / "summary.json").write_text(json.dumps(summary, indent=1))
    print(json.dumps(summary["decision"]))


if __name__ == "__main__":
    main()
