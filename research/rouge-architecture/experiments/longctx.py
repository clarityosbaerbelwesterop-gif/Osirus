#!/usr/bin/env python3
"""R1.16: long context on the trained R1.14 language models (no new training).

    python experiments/longctx.py --prereg experiments/r1_16.json report --out <dir with R1.14 artifacts>

The workflow runs this as the report of a dispatch with reuse_run = the
R1.14 run and artifact_prefix = r1_14: the directory then holds every
R1.14 run's JSON and checkpoint. Models are rebuilt from the configurations
in R1.14's pre-registration.

Measured per model and seed:
- stream BPB by distance from the start of long test streams, up to 64k
  bytes (recurrent models carry their state; the Transformer reads with a
  sliding window of its 256-byte training length);
- copy probe: a random 32-byte string appears twice, D bytes apart
  (D = 128, 1k, 4k, 16k). Copy gain = bits per byte on the first
  occurrence minus bits per byte on the second (first 2 bytes of each
  excluded). A gain above zero at D beyond the window means the model
  carried the string in its state;
- inference memory (analytic) and measured throughput at 4k, 16k, 64k and
  128k bytes, batch 1 (seed 1 only: throughput is a property of the
  architecture).
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from benchmarks import text  # noqa: E402
from experiments.lm import LN2, stream_losses  # noqa: E402
from lab import gate, stats  # noqa: E402
from prototypes import lm  # noqa: E402

PREREG: dict = {}
SETUP: dict = {}
SOURCE: dict = {}
ALPHABET = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"


def load(path: str) -> None:
    global PREREG, SETUP, SOURCE
    PREREG = json.loads(Path(path).read_text())
    SETUP = PREREG["setup"]
    SOURCE = json.loads((ROOT / SETUP["models_from"]).read_text())


def build(name: str) -> torch.nn.Module:
    config = dict(SOURCE["setup"]["models"][name])
    return lm.build(config.pop("kind"), **config)


def copy_probe(model, test: torch.Tensor, distance: int, trials: int, length: int, seed: int = 0) -> dict:
    rng = random.Random(f"copy:{distance}:{seed}")
    lead, span = 512, 32
    rows, firsts, seconds = [], [], []
    for t in range(trials):
        needle = torch.tensor([rng.choice(ALPHABET) for _ in range(span)], dtype=torch.long)
        start = rng.randrange(0, len(test) - (lead + distance + 3 * span + 1))
        ctx = test[start:start + lead + distance + span + 1].long()
        seq = torch.cat([ctx[:lead], needle, ctx[lead:lead + distance], needle, ctx[lead + distance:lead + distance + span + 1]])
        rows.append(seq)
        firsts.append(lead)
        seconds.append(lead + span + distance)
    batch = torch.stack(rows)
    losses = stream_losses(model, batch, length)  # losses[:, i] scores byte i + 1
    first = torch.stack([losses[i, f + 1:f + span - 1] for i, f in enumerate(firsts)])  # predicting bytes f+2 .. f+span-1
    second = torch.stack([losses[i, s + 1:s + span - 1] for i, s in enumerate(seconds)])
    return {"first_bpb": first.mean().item() / LN2, "second_bpb": second.mean().item() / LN2,
            "gain": (first.mean().item() - second.mean().item()) / LN2}


def throughput(model, sizes: list[int], length: int) -> dict:
    out = {}
    for size in sizes:
        x = torch.randint(0, 256, (1, size + 1))
        t0 = time.time()
        stream_losses(model, x, length)
        out[str(size)] = {"bytes_s": round(size / (time.time() - t0), 1), "memory_bytes": sum(model.memory_bytes(length).values()),
                          "memory_full_context_bytes": sum(model.memory_bytes(size).values())}
    return out


def measure(model, corpus, seed: int) -> dict:
    ev, length = SETUP["eval"], SOURCE["setup"]["length"]
    test = corpus.splits["test"]
    long = text.streams(test, ev["stream_length"], ev["streams"])
    losses = stream_losses(model, long, length)
    buckets = {name: losses[:, lo:hi].mean().item() / LN2 for name, (lo, hi) in ev["buckets"].items()}
    copy = {str(d): copy_probe(model, test, d, ev["copy_trials"], length) for d in ev["copy_distances"]}
    result = {"stream": buckets, "copy": copy}
    if seed == 1:
        result["throughput"] = throughput(model, ev["throughput_sizes"], length)
    return result


def report(args) -> None:
    out = Path(args.out)
    torch.set_num_threads(args.threads)
    corpus = text.Corpus()
    runs = []
    for path in sorted(out.glob("*-seed*.json")):
        run = json.loads(path.read_text())
        if run.get("model") not in SOURCE["setup"]["models"]:
            continue
        model = build(run["model"])
        model.load_state_dict(torch.load(out / "checkpoints" / f"{run['model']}-seed{run['seed']}.pt", weights_only=True))
        model.eval()
        with torch.no_grad():
            m = measure(model, corpus, run["seed"])
        runs.append({"model": run["model"], "seed": run["seed"], "dataset": {"source": corpus.source, "sha256": corpus.sha256},
                     "trained_on": run["dataset"]["sha256"], **m})
        print(run["model"], run["seed"], json.dumps({k: m[k] for k in ("stream", "copy")}), flush=True)
    (out / "longctx-runs.json").write_text(json.dumps(runs, indent=1))
    table = {}
    for name in [n for n in SOURCE["setup"]["models"] if any(r["model"] == n for r in runs)]:
        rs = sorted((r for r in runs if r["model"] == name), key=lambda r: r["seed"])
        s = lambda f: stats.summary([f(r) for r in rs])  # noqa: E731
        metrics = {f"stream.{b}": s(lambda r, b=b: r["stream"][b]) for b in rs[0]["stream"]}
        for d in rs[0]["copy"]:
            metrics[f"copy.{d}.gain"] = s(lambda r, d=d: r["copy"][d]["gain"])
            metrics[f"copy.{d}.second_bpb"] = s(lambda r, d=d: r["copy"][d]["second_bpb"])
        tp = next((r["throughput"] for r in rs if "throughput" in r), {})
        for size, row in tp.items():
            metrics[f"throughput.{size}"] = row["bytes_s"]
            metrics[f"memory.{size}"] = row["memory_bytes"]
            metrics[f"memory_full.{size}"] = row["memory_full_context_bytes"]
        table[name] = {"seeds": [r["seed"] for r in rs], "metrics": metrics}
    decision = gate.decide(table, SETUP["gate"])
    if len({r["dataset"]["sha256"] for r in runs} | {r["trained_on"] for r in runs}) != 1:
        decision = {**decision, "complete": False, "missing": ["evaluation and training data differ"]}
    summary = {"experiment": PREREG["id"], "models": table, "decision": decision,
               "dataset": sorted({r["dataset"]["source"] for r in runs})}
    (out / "summary.json").write_text(json.dumps(summary, indent=1))
    lines = [f"# Long context: {PREREG['id']}", "", "Bits per byte (mean ± SD over seeds); copy gain in bits per byte.", "",
             "| metric | " + " | ".join(table) + " |", "|---|" + "---|" * len(table)]
    for k in next(iter(table.values()))["metrics"] if table else []:
        vals = [table[n]["metrics"].get(k) for n in table]
        fmt = lambda v: "–" if v is None else (f"{v['mean']:.3f} ± {v['sd']:.3f}" if isinstance(v, dict) else  # noqa: E731
                                              f"{v / 1024:.0f} KiB" if k.startswith("memory") else f"{v:.0f} B/s")
        lines.append(f"| {k} | " + " | ".join(fmt(v) for v in vals) + " |")
    lines += ["", f"`{json.dumps(decision)}`", ""]
    (out / "report.md").write_text("\n".join(lines))
    print("\n".join(lines))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prereg", required=True)
    parser.add_argument("command", choices=["report"])
    parser.add_argument("--out", required=True)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    load(args.prereg)
    report(args)


if __name__ == "__main__":
    main()
