#!/usr/bin/env python3
"""R1.24: tokens/second and per-stream inference memory by input length, on the machine it runs on."""

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

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from benchmarks import suite3 as bench  # noqa: E402
from prototypes import zoo  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prereg", default=str(ROOT / "experiments" / "r1_24.json"))
    parser.add_argument("--out", default=str(ROOT / "results" / "r1.24"))
    args = parser.parse_args()
    setup = json.loads(Path(args.prereg).read_text())["setup"]
    torch.set_num_threads(os.cpu_count())
    rows = []
    for name, cfg in setup["models"].items():
        cfg = dict(cfg)
        kind = cfg.pop("kind")
        torch.manual_seed(1)
        model = zoo.build(kind, len(bench.VOCAB), **cfg).eval()
        for t in setup["lengths"]:
            ids = torch.randint(12, len(bench.VOCAB), (setup["batch"], t))
            lengths = torch.full((setup["batch"],), t)
            with torch.no_grad():
                model(ids, lengths)
                times = []
                for _ in range(setup["repeats"]):
                    t0 = time.perf_counter()
                    model(ids, lengths)
                    times.append(time.perf_counter() - t0)
            sec = statistics.median(times)
            mem = zoo.memory_bytes(model, t)
            rows.append({"model": name, "tokens": t, "tokens_per_second": setup["batch"] * t / sec,
                         "cpu_core_seconds_per_1k_tokens": sec * os.cpu_count() * 1000 / (setup["batch"] * t),
                         "memory_bytes_per_stream": mem["state"] + mem["kv"]})
            print(json.dumps(rows[-1]), flush=True)
    get = lambda m, t, k: next(r[k] for r in rows if r["model"] == m and r["tokens"] == t)  # noqa: E731
    t = max(setup["lengths"])
    checks = {"H1_memory": get("rouge-cheap", t, "memory_bytes_per_stream") <= 0.1 * get("transformer", t, "memory_bytes_per_stream"),
              "H2_speed": get("rouge-cheap", t, "tokens_per_second") >= 0.25 * get("transformer", t, "tokens_per_second")}
    result = "PASS" if all(checks.values()) else "PARTIAL" if checks["H1_memory"] else "FAIL"
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    summary = {"experiment": "R1.24", "rows": rows, "decision": {"complete": True, "checks": checks, "result": result},
               "hardware": {"machine": platform.machine(), "cpus": os.cpu_count(), "torch": torch.__version__}}
    (out / "summary.json").write_text(json.dumps(summary, indent=1))
    print(json.dumps(summary["decision"]))


if __name__ == "__main__":
    main()
