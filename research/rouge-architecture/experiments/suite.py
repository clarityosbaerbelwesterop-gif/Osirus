#!/usr/bin/env python3
"""Generic runner for experiments on benchmark v3 (benchmarks/suite3.py),
R1.07 onwards. It reports the R1.08 Rouge scorecard for every model.

    python experiments/suite.py --prereg experiments/r1_07.json train --model lstm --seed 1
    python experiments/suite.py --prereg experiments/r1_07.json report --out results/r1.07

A pre-registration names its models by kind (prototypes/zoo.py build()),
the budget, the seeds and a gate given as data (lab/gate.py).

Scorecard fields per run (mean, SD and 95% CI over seeds in the report):
- capability: accuracy on dev (frozen ID), holdout (fresh ID examples for
  this experiment), OOD (harder levels), adversarial (examples the cue
  model gets wrong), per task and level, and above the task's cue floor;
- parameters: physical and active (virtual capacity is not claimed here);
- FLOPs: inference per example (measured with torch's FLOP counter,
  analytic for fused LSTM/GRU kernels) and training (3x forward x examples);
- memory: persistent state bytes and KV / context bytes for one input;
- peak RAM, latency, training time, CPU-core-seconds (energy proxy) and
  sample efficiency (mean probe accuracy over the training curve).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import random
import resource
import sys
import time
from pathlib import Path

import torch
import torch.nn.functional as F
from torch.utils.flop_counter import FlopCounterMode

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from benchmarks import audit  # noqa: E402
from benchmarks import suite3 as bench  # noqa: E402
from lab import gate, stats  # noqa: E402
from prototypes import zoo  # noqa: E402

PREREG: dict = {}
SETUP: dict = {}


def load(path: str) -> None:
    global PREREG, SETUP
    PREREG = json.loads(Path(path).read_text())
    SETUP = PREREG["setup"]


def build(name: str) -> torch.nn.Module:
    config = dict(SETUP["models"][name])
    kind = config.pop("kind")
    tau_warmup = config.pop("tau_warmup", 0)
    model = zoo.build(kind, len(bench.VOCAB), **config)
    model.tau_warmup = tau_warmup
    return model


def collate(examples):
    lengths = torch.tensor([len(t) for t, *_ in examples])
    ids = torch.full((len(examples), int(lengths.max())), bench.PAD)
    for i, (t, *_) in enumerate(examples):
        ids[i, : len(t)] = torch.tensor(t)
    return ids, lengths, torch.tensor([a for _, a, *_ in examples])


@torch.no_grad()
def evaluate(model, examples, batch_size=200) -> dict:
    model.eval()
    rows = []
    for i in range(0, len(examples), batch_size):
        chunk = examples[i : i + batch_size]
        ids, lengths, answers = collate(chunk)
        logits, info = model(ids, lengths)
        steps = info.get("steps", torch.zeros(len(chunk))).tolist()
        for (_, _, task, level), ok, s in zip(chunk, (logits.argmax(-1) == answers).tolist(), steps):
            rows.append((task, level, ok, s))
    model.train()
    out = {"all": sum(r[2] for r in rows) / len(rows), "task": {}, "level": {}, "steps": {}}
    for task in bench.TASKS:
        sel = [r for r in rows if r[0] == task]
        if sel:
            out["task"][task] = sum(r[2] for r in sel) / len(sel)
            out["steps"][task] = sum(r[3] for r in sel) / len(sel)
            for level in sorted({r[1] for r in sel}):
                lv = [r[2] for r in sel if r[1] == level]
                out["level"][f"{task}:{level}"] = round(sum(lv) / len(lv), 4)
    return out


def flops_per_example(model, examples) -> float:
    ids, lengths, _ = collate(examples)
    model.eval()
    with FlopCounterMode(display=False) as counter:  # forward only; grad mode on for the module tracker
        model(ids, lengths)
    model.train()
    counted = counter.get_total_flops() / len(examples)
    if hasattr(model, "analytic_flops"):
        counted += model.analytic_flops(float(lengths.float().mean()))
    return counted


def hardware() -> dict:
    return {"machine": platform.machine(), "cpus": os.cpu_count(), "torch": torch.__version__,
            "runner": os.environ.get("RUNNER_NAME", "local"), "runner_environment": os.environ.get("RUNNER_ENVIRONMENT", "local")}


def eval_sets() -> dict:
    per = SETUP["eval_per_task"]
    exp = PREREG["id"]
    return {
        "dev": bench.fixed_set("dev", per, "dev"),
        "holdout": bench.fixed_set(f"holdout:{exp}", per, "holdout"),
        "ood": bench.fixed_set(f"ood", per, "ood"),
        "adv": [e for t in bench.TASKS for e in audit.adversarial(t, per // 2, exp)],
    }


def train(args) -> None:
    torch.manual_seed(args.seed)
    torch.set_num_threads(args.threads)
    rng = random.Random(f"suite3-train:{args.seed}")
    model = build(args.model)
    params = sum(p.numel() for p in model.parameters())
    opt = torch.optim.AdamW(model.parameters(), lr=SETUP["lr"], weight_decay=SETUP["weight_decay"])
    warm = SETUP["warmup"]
    sched = torch.optim.lr_scheduler.LambdaLR(
        opt, lambda s: min(1.0, (s + 1) / warm) * 0.5 * (1 + math.cos(math.pi * min(1.0, s / args.steps))))
    probe = bench.fixed_set("probe", 20, "dev")
    out = Path(args.out)
    resume = out / "resume" / f"{args.model}-seed{args.seed}.pt"
    curve, seen, start, first = [], 0, time.time(), 1
    if resume.exists():
        saved = torch.load(resume, weights_only=False)
        model.load_state_dict(saved["model"])
        opt.load_state_dict(saved["opt"])
        sched.load_state_dict(saved["sched"])
        rng.setstate(saved["rng"])
        torch.set_rng_state(saved["torch_rng"])
        curve, seen, first = saved["curve"], saved["seen"], saved["step"] + 1
        if hasattr(model, "tau_base"):
            model.tau = saved["tau"]
        start -= saved["elapsed"]
        print(f"resumed {args.model} seed {args.seed} at step {saved['step']}", flush=True)

    def save_resume(step):
        resume.parent.mkdir(parents=True, exist_ok=True)
        torch.save({"model": model.state_dict(), "opt": opt.state_dict(), "sched": sched.state_dict(), "rng": rng.getstate(),
                    "torch_rng": torch.get_rng_state(), "curve": curve, "seen": seen, "step": step,
                    "tau": getattr(model, "tau", None), "elapsed": time.time() - start}, resume.with_suffix(".tmp"))
        resume.with_suffix(".tmp").replace(resume)

    deadline = time.time() + args.budget_min * 60 if args.budget_min else None
    for step in range(first, args.steps + 1):
        ids, lengths, answers = collate(bench.batch(rng, SETUP["batch"], "id"))
        seen += len(answers)
        logits, info = model(ids, lengths)
        loss = F.cross_entropy(logits, answers)
        if hasattr(model, "extra_loss"):
            loss = loss + model.extra_loss(info)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        sched.step()
        if hasattr(model, "tau_base") and model.tau_warmup:
            model.tau = model.tau_base * min(1.0, step / (model.tau_warmup * args.steps))
        if step % args.eval_every == 0 or step == args.steps:
            curve.append({"step": step, "examples": seen, "loss": round(loss.item(), 4),
                          "probe": round(evaluate(model, probe)["all"], 4), "elapsed_s": round(time.time() - start, 1)})
            print(args.model, args.seed, curve[-1], flush=True)
        if step < args.steps and (step % args.ckpt_every == 0 or (deadline and time.time() > deadline)):
            save_resume(step)
            if deadline and time.time() > deadline:
                print(f"time budget reached at step {step}: resume state saved; rerun to continue", flush=True)
                raise SystemExit(75)
    train_seconds = time.time() - start
    resume.unlink(missing_ok=True)

    (out / "checkpoints").mkdir(parents=True, exist_ok=True)
    ckpt = out / "checkpoints" / f"{args.model}-seed{args.seed}.pt"
    torch.save(model.state_dict(), ckpt)
    sets = eval_sets()
    t0 = time.time()
    results = {"dev": evaluate(model, sets["dev"])}
    latency_ms = (time.time() - t0) / len(sets["dev"]) * 1000
    for split in ("holdout", "ood", "adv"):
        results[split] = evaluate(model, sets[split])
    flop_set = [e for t in bench.TASKS for e in bench.fixed_set("flops", 4, "dev", (t,))]
    flops = flops_per_example(model, flop_set)
    mean_len = sum(len(t) for t, *_ in sets["dev"]) / len(sets["dev"])
    max_len = max(len(t) for t, *_ in sets["ood"])
    result = {
        "model": args.model, "seed": args.seed, "kind": SETUP["models"][args.model]["kind"], "steps": args.steps,
        "training_examples": seen, "train_seconds": round(train_seconds, 1), "threads": args.threads,
        "cpu_core_seconds": round(train_seconds * args.threads, 1), "hardware": hardware(),
        "code_sha": os.environ.get("GITHUB_SHA", "local"),
        "params": params, "params_active": zoo.active_parameters(model),
        "disk_bytes": ckpt.stat().st_size, "checkpoint_sha256": hashlib.sha256(ckpt.read_bytes()).hexdigest(),
        "flops_per_example": flops, "train_flops": 3 * flops * seen,
        "memory": {"mean_dev_tokens": round(mean_len, 1), "at_mean": zoo.memory_bytes(model, round(mean_len)),
                   "max_ood_tokens": max_len, "at_max_ood": zoo.memory_bytes(model, max_len)},
        "peak_rss_mb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1),
        "latency_ms_per_example": round(latency_ms, 3),
        "sample_efficiency": round(sum(c["probe"] for c in curve) / len(curve), 4),
        "curve": curve, **results,
    }
    (out / f"{args.model}-seed{args.seed}.json").write_text(json.dumps(result, indent=1))
    print(json.dumps({"model": args.model, "seed": args.seed, **{s: round(results[s]["all"], 4) for s in results},
                      "flops_M": round(flops / 1e6, 1), "train_s": result["train_seconds"]}), flush=True)


def cue_floors() -> dict:
    return {t: audit.audit_task(t, n_train=2000, n_eval=300) for t in bench.TASKS}


def report(args) -> None:
    out = Path(args.out)
    runs = [json.loads(p.read_text()) for p in sorted(out.glob("*-seed*.json"))]
    floors = cue_floors()
    table = {}
    for m in [m for m in SETUP["models"] if any(r["model"] == m for r in runs)]:
        rs = sorted((r for r in runs if r["model"] == m), key=lambda r: r["seed"])
        s = lambda f: stats.summary([f(r) for r in rs])  # noqa: E731
        metrics = {f"{split}.all": s(lambda r, x=split: r[x]["all"]) for split in ("dev", "holdout", "ood", "adv")}
        for split in ("dev", "ood", "adv"):
            for t in bench.TASKS:
                metrics[f"{split}.{t}"] = s(lambda r, x=split, t=t: r[x]["task"][t])
        for t in bench.TASKS:
            floor = floors[t]["dev"]["cue_floor"]
            metrics[f"above_cue.{t}"] = s(lambda r, t=t, f=floor: r["dev"]["task"][t] - f)
            metrics[f"steps.{t}"] = s(lambda r, t=t: r["dev"]["steps"][t])
        metrics.update({
            "params": rs[0]["params"], "params_active": rs[0]["params_active"],
            "flops": s(lambda r: r["flops_per_example"]), "train_flops": s(lambda r: r["train_flops"]),
            "state_bytes": rs[0]["memory"]["at_max_ood"]["state"], "kv_bytes": rs[0]["memory"]["at_max_ood"]["kv"],
            "total_bytes": rs[0]["memory"]["at_max_ood"]["state"] + rs[0]["memory"]["at_max_ood"]["kv"],
            "peak_rss_mb": s(lambda r: r["peak_rss_mb"]), "latency_ms": s(lambda r: r["latency_ms_per_example"]),
            "train_seconds": s(lambda r: r["train_seconds"]), "cpu_core_seconds": s(lambda r: r["cpu_core_seconds"]),
            "sample_efficiency": s(lambda r: r["sample_efficiency"]),
        })
        table[m] = {"seeds": [r["seed"] for r in rs], "kind": rs[0]["kind"], "metrics": metrics,
                    "memory_tokens": rs[0]["memory"]["max_ood_tokens"]}
    decision = gate.decide(table, SETUP["gate"])
    summary = {"experiment": PREREG["id"], "models": table, "cue_floors": {t: floors[t]["dev"]["cue_floor"] for t in bench.TASKS},
               "decision": decision}
    (out / "summary.json").write_text(json.dumps(summary, indent=1))
    text = markdown(summary)
    (out / "report.md").write_text(text)
    print(text)


def markdown(summary: dict) -> str:
    table, models = summary["models"], list(summary["models"])
    pct = lambda x: f"{100 * x['mean']:.1f} ± {100 * x['sd']:.1f}"  # noqa: E731
    head = ["| | " + " | ".join(models) + " |", "|---|" + "---|" * len(models)]
    lines = [f"# Rouge scorecard: {summary['experiment']}", "",
             "Mean ± SD over seeds (95% CIs in summary.json). Accuracy in %.", "", "## Capability", ""] + head
    for split in ("dev", "holdout", "ood", "adv"):
        lines.append(f"| **{split} all** | " + " | ".join(pct(table[m]["metrics"][f"{split}.all"]) for m in models) + " |")
    for t in bench.TASKS:
        floor = summary["cue_floors"][t]
        lines.append(f"| {t}: dev / ood (cue floor {100 * floor:.0f}) | " + " | ".join(
            f"{100 * table[m]['metrics'][f'dev.{t}']['mean']:.0f} / {100 * table[m]['metrics'][f'ood.{t}']['mean']:.0f}" for m in models) + " |")
    lines += ["", "## Cost", ""] + head
    rows = [
        ("parameters (physical)", lambda r: f"{r['params']:,}"),
        ("parameters (active)", lambda r: f"{r['params_active']:,}"),
        ("inference FLOPs / example", lambda r: f"{r['flops']['mean'] / 1e6:.1f} M"),
        ("training FLOPs (3x fwd x examples)", lambda r: f"{r['train_flops']['mean']:.2e}"),
        ("persistent state bytes", lambda r: f"{r['state_bytes'] / 1024:.1f} KiB"),
        ("KV / context bytes (longest OOD input)", lambda r: f"{r['kv_bytes'] / 1024:.1f} KiB"),
        ("peak RAM (process RSS, incl. torch)", lambda r: f"{r['peak_rss_mb']['mean']:.0f} MB"),
        ("latency / example (CPU)", lambda r: f"{r['latency_ms']['mean']:.2f} ms"),
        ("training time", lambda r: f"{r['train_seconds']['mean'] / 60:.1f} min"),
        ("energy proxy (CPU-core-seconds)", lambda r: f"{r['cpu_core_seconds']['mean']:.0f}"),
        ("sample efficiency (mean probe accuracy)", lambda r: f"{100 * r['sample_efficiency']['mean']:.1f}"),
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
    parser.add_argument("--eval-every", type=int, default=500)
    parser.add_argument("--threads", type=int, default=1)
    parser.add_argument("--ckpt-every", type=int, default=1000)
    parser.add_argument("--budget-min", type=float, default=0)
    parser.add_argument("--out")
    args = parser.parse_args()
    load(args.prereg)
    args.steps = args.steps or SETUP["steps"]
    args.out = args.out or str(ROOT / "results" / PREREG["id"].lower())
    (train if args.command == "train" else report)(args)


if __name__ == "__main__":
    main()
