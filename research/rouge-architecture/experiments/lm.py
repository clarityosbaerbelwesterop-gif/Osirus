#!/usr/bin/env python3
"""Runner for byte-level language-model experiments (R1.14, R1.16).

    python experiments/lm.py --prereg experiments/r1_14.json train --model rouge-lm --seed 1
    python experiments/lm.py --prereg experiments/r1_14.json report --out results/r1.14

Same interface as experiments/suite.py (resumable with exit 75, one JSON
per model and seed, report with seed statistics and the pre-registered
gate). Data: benchmarks/text.py (enwik8, bits per byte).

Scorecard per run:
- valid.bpb / test.bpb: non-overlapping segments of the training length,
  every segment on its own (fresh state): all models see the same context;
- stream.*: long test streams read from the start. Recurrent models carry
  their state; the Transformer reads with a sliding window of its training
  length (stride = half of it, so every scored byte has at least half a
  window of context). Reported per position bucket (0-256, 256-1k, 1k-4k)
  so the use of long context is visible;
- n-gram floors (order 1 and 3) on the validation bytes;
- parameters, stored bytes, inference FLOPs per byte, training FLOPs,
  inference memory for the stream evaluation (state + KV cache),
  throughput, peak RAM, training time and CPU-core-seconds.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import resource
import sys
import time
from pathlib import Path

import torch
import torch.nn.functional as F
from torch.utils.flop_counter import FlopCounterMode

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from benchmarks import text  # noqa: E402
from lab import gate, stats  # noqa: E402
from prototypes import lm  # noqa: E402

PREREG: dict = {}
SETUP: dict = {}
LN2 = math.log(2)


def load(path: str) -> None:
    global PREREG, SETUP
    PREREG = json.loads(Path(path).read_text())
    SETUP = PREREG["setup"]


def build(name: str) -> torch.nn.Module:
    config = dict(SETUP["models"][name])
    return lm.build(config.pop("kind"), **config)


@torch.no_grad()
def segment_bpb(model, segs: torch.Tensor, batch: int = 32) -> float:
    total, count = 0.0, 0
    for i in range(0, len(segs), batch):
        x = segs[i:i + batch]
        logits, _ = model(x[:, :-1], model.init_state(len(x)))
        total += F.cross_entropy(logits.reshape(-1, lm.VOCAB), x[:, 1:].reshape(-1), reduction="sum").item()
        count += x[:, 1:].numel()
    return total / count / LN2


@torch.no_grad()
def stream_losses(model, streams: torch.Tensor, length: int) -> torch.Tensor:
    """Per-position loss in nats, (N, L), for streams (N, L + 1) read from the start."""
    x, y = streams[:, :-1], streams[:, 1:]
    n, total = x.shape
    losses = torch.empty(n, total)
    if model.recurrent:
        state = model.init_state(n)
        for s in range(0, total, length):
            logits, state = model(x[:, s:s + length], state)
            losses[:, s:s + length] = F.cross_entropy(logits.transpose(1, 2), y[:, s:s + length], reduction="none")
        return losses
    half = length // 2
    logits, _ = model(x[:, :length])
    losses[:, :length] = F.cross_entropy(logits.transpose(1, 2), y[:, :length], reduction="none")
    for s in range(length, total, half):  # sliding window: score the last `half` bytes of each window
        end = min(s + half, total)
        logits, _ = model(x[:, end - length:end])
        losses[:, s:end] = F.cross_entropy(logits[:, -(end - s):].transpose(1, 2), y[:, s:end], reduction="none")
    return losses


def flops_per_byte(model, length: int) -> float:
    if isinstance(model, lm.LSTMLM):  # fused kernel: not seen by the FLOP counter
        return model.analytic_flops_per_byte()
    x = torch.zeros(1, length, dtype=torch.long)
    counter = FlopCounterMode(display=False)
    with counter, torch.no_grad():
        model(x)  # the state is created inside (the FLOP counter must not see it as an input)
    return counter.get_total_flops() / length


def hardware() -> dict:
    return {"machine": platform.machine(), "processor": platform.processor() or platform.machine(),
            "cpus": os.cpu_count(), "torch": torch.__version__, "runner": os.environ.get("RUNNER_NAME", "local")}


def train(args) -> None:
    torch.manual_seed(args.seed)
    torch.set_num_threads(args.threads)
    corpus = text.Corpus()
    length, batch = SETUP["length"], SETUP["batch"]
    streams = text.Streams(corpus.splits["train"], batch, length, args.seed, span=args.steps * length)
    model = build(args.model)
    params = sum(p.numel() for p in model.parameters())
    opt = torch.optim.AdamW(model.parameters(), lr=SETUP["lr"], weight_decay=SETUP["weight_decay"], betas=(0.9, 0.95))
    warm = SETUP["warmup"]
    sched = torch.optim.lr_scheduler.LambdaLR(
        opt, lambda s: min(1.0, (s + 1) / warm) * (0.1 + 0.9 * 0.5 * (1 + math.cos(math.pi * min(1.0, s / args.steps)))))
    probe = text.segments(corpus.splits["valid"], length, 32)
    out = Path(args.out)
    resume = out / "resume" / f"{args.model}-seed{args.seed}.pt"
    state = model.init_state(batch) if model.recurrent else None
    curve, start, first = [], time.time(), 1
    if resume.exists():
        saved = torch.load(resume, weights_only=False)
        model.load_state_dict(saved["model"])
        opt.load_state_dict(saved["opt"])
        sched.load_state_dict(saved["sched"])
        streams.restore(saved["streams"])
        torch.set_rng_state(saved["torch_rng"])
        state, curve, first = saved["state"], saved["curve"], saved["step"] + 1
        start -= saved["elapsed"]
        print(f"resumed {args.model} seed {args.seed} at step {saved['step']}", flush=True)

    def save_resume(step):
        resume.parent.mkdir(parents=True, exist_ok=True)
        torch.save({"model": model.state_dict(), "opt": opt.state_dict(), "sched": sched.state_dict(),
                    "streams": streams.state(), "torch_rng": torch.get_rng_state(), "state": state, "curve": curve,
                    "step": step, "elapsed": time.time() - start}, resume.with_suffix(".tmp"))
        resume.with_suffix(".tmp").replace(resume)

    deadline = time.time() + args.budget_min * 60 if args.budget_min else None
    for step in range(first, args.steps + 1):
        x, reset = streams.next()
        if model.recurrent:
            state = model.reset(state, reset)
        logits, new = model(x[:, :-1], state)
        loss = F.cross_entropy(logits.reshape(-1, lm.VOCAB), x[:, 1:].reshape(-1))
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        sched.step()
        if model.recurrent:
            state = model.detach(new)
        if step % args.eval_every == 0 or step == args.steps:
            model.eval()
            curve.append({"step": step, "bytes": step * batch * length, "train_bpb": round(loss.item() / LN2, 4),
                          "probe_bpb": round(segment_bpb(model, probe), 4), "elapsed_s": round(time.time() - start, 1)})
            model.train()
            print(args.model, args.seed, curve[-1], flush=True)
        if step < args.steps and (step % args.ckpt_every == 0 or (deadline and time.time() > deadline)):
            save_resume(step)
            if deadline and time.time() > deadline:
                print(f"time budget reached at step {step}: resume state saved; rerun to continue", flush=True)
                raise SystemExit(75)
    train_seconds = time.time() - start
    resume.unlink(missing_ok=True)

    model.eval()
    (out / "checkpoints").mkdir(parents=True, exist_ok=True)
    ckpt = out / "checkpoints" / f"{args.model}-seed{args.seed}.pt"
    torch.save(model.state_dict(), ckpt)
    ev = SETUP["eval"]
    result_eval = {
        "valid_bpb": segment_bpb(model, text.segments(corpus.splits["valid"], length, ev["segments"])),
        "test_bpb": segment_bpb(model, text.segments(corpus.splits["test"], length, ev["segments"])),
    }
    long = text.streams(corpus.splits["test"], ev["stream_length"], ev["streams"])
    t0 = time.time()
    losses = stream_losses(model, long, length)
    stream_seconds = time.time() - t0
    buckets = {}
    for name, (lo, hi) in ev["buckets"].items():
        buckets[name] = losses[:, lo:hi].mean().item() / LN2
    buckets["all"] = losses.mean().item() / LN2
    flops = flops_per_byte(model, length)
    mem = model.memory_bytes(length)
    trained_bytes = args.steps * batch * length
    result = {
        "model": args.model, "seed": args.seed, "kind": SETUP["models"][args.model]["kind"], "steps": args.steps,
        "training_bytes": trained_bytes, "train_seconds": round(train_seconds, 1), "threads": args.threads,
        "cpu_core_seconds": round(train_seconds * args.threads, 1), "hardware": hardware(),
        "code_sha": os.environ.get("GITHUB_SHA", "local"),
        "dataset": {"source": corpus.source, "sha256": corpus.sha256},
        "params": params, "stored_bytes": lm.stored_bytes(model),
        "disk_bytes": ckpt.stat().st_size, "checkpoint_sha256": hashlib.sha256(ckpt.read_bytes()).hexdigest(),
        "flops_per_byte": flops, "train_flops": 3 * flops * trained_bytes,
        "memory": {"stream_eval": mem, "full_context_4k": model.memory_bytes(4096)},
        "peak_rss_mb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1),
        "throughput_bytes_s": round(long[:, 1:].numel() / stream_seconds, 1),
        "floors": {"order1_bpb": text.ngram_floor(corpus.splits["train"], corpus.splits["valid"][:200_000], 1),
                   "order3_bpb": text.ngram_floor(corpus.splits["train"], corpus.splits["valid"][:200_000], 3)},
        "curve": curve, **result_eval, "stream": buckets,
    }
    (out / f"{args.model}-seed{args.seed}.json").write_text(json.dumps(result, indent=1))
    print(json.dumps({"model": args.model, "seed": args.seed, "valid_bpb": round(result_eval["valid_bpb"], 4),
                      "stream": {k: round(v, 4) for k, v in buckets.items()}, "flops_per_byte_M": round(flops / 1e6, 2),
                      "train_s": result["train_seconds"]}), flush=True)


def report(args) -> None:
    out = Path(args.out)
    runs = [json.loads(p.read_text()) for p in sorted(out.glob("*-seed*.json"))]
    hashes = {r["dataset"]["sha256"] for r in runs}
    table = {}
    for m in [m for m in SETUP["models"] if any(r["model"] == m for r in runs)]:
        rs = sorted((r for r in runs if r["model"] == m), key=lambda r: r["seed"])
        s = lambda f: stats.summary([f(r) for r in rs])  # noqa: E731
        metrics = {"valid.bpb": s(lambda r: r["valid_bpb"]), "test.bpb": s(lambda r: r["test_bpb"])}
        for bucket in rs[0]["stream"]:
            metrics[f"stream.{bucket}"] = s(lambda r, b=bucket: r["stream"][b])
        mem = rs[0]["memory"]["stream_eval"]
        metrics.update({
            "params": rs[0]["params"], "stored_bytes": rs[0]["stored_bytes"],
            "flops": s(lambda r: r["flops_per_byte"]), "train_flops": s(lambda r: r["train_flops"]),
            "state_bytes": mem["state"], "kv_bytes": mem["kv"], "total_bytes": mem["state"] + mem["kv"],
            "full_context_4k_bytes": sum(rs[0]["memory"]["full_context_4k"].values()),
            "peak_rss_mb": s(lambda r: r["peak_rss_mb"]), "throughput_bytes_s": s(lambda r: r["throughput_bytes_s"]),
            "train_seconds": s(lambda r: r["train_seconds"]), "cpu_core_seconds": s(lambda r: r["cpu_core_seconds"]),
            "training_bytes": rs[0]["training_bytes"],
        })
        table[m] = {"seeds": [r["seed"] for r in rs], "kind": rs[0]["kind"], "metrics": metrics}
    decision = gate.decide(table, SETUP["gate"])
    if len(hashes) != 1:
        decision = {**decision, "complete": False, "missing": [f"runs saw different datasets: {sorted(hashes)}"]}
    floors = runs[0]["floors"] if runs else {}
    summary = {"experiment": PREREG["id"], "dataset": sorted({r["dataset"]["source"] for r in runs}),
               "dataset_sha256": sorted(hashes), "floors": floors, "models": table, "decision": decision}
    (out / "summary.json").write_text(json.dumps(summary, indent=1))
    text_md = markdown(summary)
    (out / "report.md").write_text(text_md)
    print(text_md)


def markdown(summary: dict) -> str:
    table, models = summary["models"], list(summary["models"])
    bpb = lambda x: f"{x['mean']:.3f} ± {x['sd']:.3f}"  # noqa: E731
    head = ["| | " + " | ".join(models) + " |", "|---|" + "---|" * len(models)]
    lines = [f"# Rouge LM scorecard: {summary['experiment']}", "",
             f"Data: {', '.join(summary['dataset'])} (sha256 {', '.join(h[:12] for h in summary['dataset_sha256'])}). "
             "Bits per byte, mean ± SD over seeds (95% CIs in summary.json); lower is better.", "",
             f"Floors on validation bytes: unigram {summary['floors'].get('order1_bpb', float('nan')):.3f}, "
             f"order-3 byte n-gram {summary['floors'].get('order3_bpb', float('nan')):.3f} BPB.", "", "## Quality", ""] + head
    keys = ["valid.bpb", "test.bpb"] + sorted(k for k in table[models[0]]["metrics"] if k.startswith("stream.")) if models else []
    for k in keys:
        lines.append(f"| {k} | " + " | ".join(bpb(table[m]["metrics"][k]) for m in models) + " |")
    lines += ["", "## Cost", ""] + head
    rows = [
        ("parameters", lambda r: f"{r['params']:,}"),
        ("stored weight bytes", lambda r: f"{r['stored_bytes'] / 1024:.0f} KiB"),
        ("inference FLOPs / byte", lambda r: f"{r['flops']['mean'] / 1e6:.2f} M"),
        ("training bytes", lambda r: f"{r['training_bytes']:,}"),
        ("training FLOPs (3x fwd x bytes)", lambda r: f"{r['train_flops']['mean']:.2e}"),
        ("inference memory, stream eval (state + KV)", lambda r: f"{r['total_bytes'] / 1024:.0f} KiB"),
        ("memory if the full 4k context were kept", lambda r: f"{r['full_context_4k_bytes'] / 1024:.0f} KiB"),
        ("stream throughput (CPU, batch 16)", lambda r: f"{r['throughput_bytes_s']['mean']:.0f} B/s"),
        ("peak RAM (process RSS, incl. torch)", lambda r: f"{r['peak_rss_mb']['mean']:.0f} MB"),
        ("training time", lambda r: f"{r['train_seconds']['mean'] / 60:.0f} min"),
        ("energy proxy (CPU-core-seconds)", lambda r: f"{r['cpu_core_seconds']['mean']:.0f}"),
    ]
    for name, fn in rows:
        lines.append(f"| {name} | " + " | ".join(fn(table[m]["metrics"]) for m in models) + " |")
    lines += ["", "## Decision", "", f"`{json.dumps(summary['decision'])}`", ""]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prereg", required=True)
    parser.add_argument("command", choices=["train", "report"])
    parser.add_argument("--model")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--steps", type=int)
    parser.add_argument("--eval-every", type=int, default=250)
    parser.add_argument("--threads", type=int, default=1)
    parser.add_argument("--ckpt-every", type=int, default=250)
    parser.add_argument("--budget-min", type=float, default=0)
    parser.add_argument("--out")
    args = parser.parse_args()
    load(args.prereg)
    args.steps = args.steps or SETUP["steps"]
    args.out = args.out or str(ROOT / "results" / PREREG["id"].lower())
    (train if args.command == "train" else report)(args)


if __name__ == "__main__":
    main()
