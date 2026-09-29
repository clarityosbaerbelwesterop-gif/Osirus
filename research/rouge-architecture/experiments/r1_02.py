#!/usr/bin/env python3
"""R1.02: does learned halting spend compute where the task needs it?

Looped (shared-block) models with fixed, ACT and PonderNet halting vs
bidirectional Transformers matched in parameters and in FLOPs, on the
depth-controlled benchmark (benchmarks/depthbench.py). Defined by its
pre-registration, experiments/r1_02.json.

    python experiments/r1_02.py --prereg experiments/r1_02.json train --model loop-ponder --seed 1
    python experiments/r1_02.py --prereg experiments/r1_02.json report --out results/r1.02
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
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
from torch.utils.flop_counter import FlopCounterMode

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from benchmarks import depthbench as db  # noqa: E402
from lab import stats  # noqa: E402
from prototypes.looped import Looped  # noqa: E402
from prototypes.transformer_baseline import Transformer  # noqa: E402

PREREG: dict = {}
SETUP: dict = {}
SCHEDULE_KEYS = ("tau_warmup", "floor_warmup")


def load(path: str) -> None:
    global PREREG, SETUP, db
    PREREG = json.loads(Path(path).read_text())
    SETUP = PREREG["setup"]
    # R1.02 used benchmarks/depthbench.py (void: length cue); R1.02b uses depthbench2.
    db = importlib.import_module("benchmarks." + Path(PREREG.get("benchmarks", ["benchmarks/depthbench.py"])[0]).stem)


def build(name: str) -> torch.nn.Module:
    config = dict(SETUP["models"][name])
    schedule = {k: config.pop(k, 0) for k in SCHEDULE_KEYS}
    if name.startswith("transformer"):
        model = Transformer(len(db.VOCAB), causal=False, **config)
    else:
        model = Looped(len(db.VOCAB), **config)
    model.schedule = schedule
    return model


def collate(examples):
    ids = torch.tensor([t for t, _, _, _ in examples])
    return ids, torch.full((len(examples),), ids.shape[1]), torch.tensor([a for _, a, _, _ in examples])


def loss_of(model, logits, info, answers):
    if hasattr(model, "loss"):
        return model.loss(logits, info, answers)
    return torch.nn.functional.cross_entropy(logits, answers)


@torch.no_grad()
def evaluate(model, examples, batch_size=200, **kwargs) -> dict:
    model.eval()
    rows = []
    for i in range(0, len(examples), batch_size):
        chunk = examples[i : i + batch_size]
        ids, lengths, answers = collate(chunk)
        logits, info = model(ids, lengths, **kwargs)
        steps = info.get("steps", torch.full((len(chunk),), float(getattr(model, "layers", 0)))).tolist()
        for (_, _, depth, terminals), ok, s in zip(chunk, (logits.argmax(-1) == answers).tolist(), steps):
            rows.append((depth, ok, s, 1 / terminals))
    model.train()
    out = {"all": sum(r[1] for r in rows) / len(rows), "guess": sum(r[3] for r in rows) / len(rows),
           "steps_mean": sum(r[2] for r in rows) / len(rows), "by_depth": {}}
    for depth in sorted({r[0] for r in rows}):
        sel = [r for r in rows if r[0] == depth]
        out["by_depth"][str(depth)] = {"acc": sum(r[1] for r in sel) / len(sel), "steps": sum(r[2] for r in sel) / len(sel),
                                       "guess": sum(r[3] for r in sel) / len(sel)}
    out["pairs"] = [(r[0], r[2]) for r in rows]  # (required depth, chosen steps) per example
    return out


def count_flops(model, examples, **kwargs) -> float:
    ids, lengths, _ = collate(examples)
    model.eval()
    with FlopCounterMode(display=False) as counter:  # forward only
        model(ids, lengths, **kwargs)
    model.train()
    return counter.get_total_flops() / len(examples)


def flops_model(model, examples) -> dict:
    """FLOPs per example as base + per-step cost (looped) or one pass (Transformer)."""
    if not isinstance(model, Looped):
        return {"base": count_flops(model, examples), "per_step": 0.0}
    mode = model.mode
    model.mode = "fixed"
    one, two = count_flops(model, examples, max_think=1), count_flops(model, examples, max_think=2)
    model.mode = mode
    return {"base": one - (two - one), "per_step": two - one}


def hardware() -> dict:
    return {"machine": platform.machine(), "system": platform.system(), "cpus": os.cpu_count(), "torch": torch.__version__,
            "runner": os.environ.get("RUNNER_NAME", "local"), "runner_environment": os.environ.get("RUNNER_ENVIRONMENT", "local")}


def train(args) -> None:
    torch.manual_seed(args.seed)
    torch.set_num_threads(args.threads)
    rng = random.Random(f"depth-train:{args.seed}")
    model = build(args.model)
    params = sum(p.numel() for p in model.parameters())
    opt = torch.optim.AdamW(model.parameters(), lr=SETUP["lr"], weight_decay=SETUP["weight_decay"])
    warm = SETUP["warmup"]
    sched = torch.optim.lr_scheduler.LambdaLR(
        opt, lambda s: min(1.0, (s + 1) / warm) * 0.5 * (1 + math.cos(math.pi * min(1.0, s / args.steps))))
    probe = db.fixed_set("probe", 25, "id")
    seq_len = len(probe[0][0])
    curve, examples_seen, start, first = [], 0, time.time(), 1
    out = Path(args.out)
    resume = out / "resume" / f"{args.model}-seed{args.seed}.pt"
    if resume.exists():
        saved = torch.load(resume, weights_only=False)
        model.load_state_dict(saved["model"])
        opt.load_state_dict(saved["opt"])
        sched.load_state_dict(saved["sched"])
        rng.setstate(saved["rng"])
        torch.set_rng_state(saved["torch_rng"])
        curve, examples_seen, first = saved["curve"], saved["examples_seen"], saved["step"] + 1
        start -= saved["elapsed"]
        print(f"resumed {args.model} seed {args.seed} at step {saved['step']}", flush=True)

    def save_resume(step):
        resume.parent.mkdir(parents=True, exist_ok=True)
        torch.save({"model": model.state_dict(), "opt": opt.state_dict(), "sched": sched.state_dict(), "rng": rng.getstate(),
                    "torch_rng": torch.get_rng_state(), "curve": curve, "examples_seen": examples_seen, "step": step,
                    "elapsed": time.time() - start}, resume.with_suffix(".tmp"))
        resume.with_suffix(".tmp").replace(resume)

    def set_schedule(step):
        frac = step / args.steps
        if isinstance(model, Looped):
            tw, fw = model.schedule["tau_warmup"], model.schedule["floor_warmup"]
            model.tau = model.tau_base * (min(1.0, frac / tw) if tw else 1.0)
            model.floor = round(model.floor_base * max(0.0, 1 - frac / fw)) if fw else model.floor_base

    deadline = time.time() + args.budget_min * 60 if args.budget_min else None
    train_steps = []
    for step in range(first, args.steps + 1):
        set_schedule(step - 1)
        ids, lengths, answers = collate(db.batch(rng, SETUP["batch"], "id"))
        examples_seen += len(answers)
        logits, info = model(ids, lengths)
        loss = loss_of(model, logits, info, answers)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        sched.step()
        if "ponder" in info:
            train_steps.append(float(info["ponder"].detach().float().mean()))
        if step % args.eval_every == 0 or step == args.steps:
            probe_eval = evaluate(model, probe)
            curve.append({"step": step, "loss": round(loss.item(), 4), "probe_id": round(probe_eval["all"], 3),
                          "probe_steps": round(probe_eval["steps_mean"], 2),
                          "train_ponder": round(sum(train_steps) / len(train_steps), 2) if train_steps else None,
                          "elapsed_s": round(time.time() - start, 1)})
            train_steps = []
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
    id_set, ood_set = db.fixed_set("r1.02", SETUP["eval_per_depth"], "id"), db.fixed_set("r1.02", SETUP["eval_per_depth"], "ood")
    t0 = time.time()
    result_id = evaluate(model, id_set)
    latency_ms = (time.time() - t0) / len(id_set) * 1000
    ood_kwargs = {"max_think": SETUP["ood_max_think"]} if getattr(model, "halting", False) else {}
    result = {
        "model": args.model, "seed": args.seed, "steps": args.steps, "batch": SETUP["batch"], "training_examples": examples_seen,
        "train_seconds": round(train_seconds, 1), "threads": args.threads, "hardware": hardware(),
        "code_sha": os.environ.get("GITHUB_SHA", "local"), "parameters": params, "disk_bytes": ckpt.stat().st_size,
        "checkpoint_sha256": hashlib.sha256(ckpt.read_bytes()).hexdigest(),
        "state_bytes": {"len57": model.state_bytes(seq_len), "tokens": seq_len},
        "peak_rss_mb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1),
        "latency_ms_per_example_cpu": round(latency_ms, 3),
        "id": result_id, "ood": evaluate(model, ood_set, **ood_kwargs), "curve": curve,
        "flops": flops_model(model, id_set[:40]),
    }
    if isinstance(model, Looped) and model.mode == "fixed":
        result["ood_fixed16"] = evaluate(model, ood_set, max_think=16)
    for split in ("id", "ood"):
        f = result["flops"]
        result[split]["flops_per_example"] = f["base"] + f["per_step"] * (result[split]["steps_mean"] if f["per_step"] else 0)
    (out / f"{args.model}-seed{args.seed}.json").write_text(json.dumps(result, indent=1))
    print(json.dumps({"model": args.model, "seed": args.seed, "id": result["id"]["all"], "ood": result["ood"]["all"],
                      "steps_id": result["id"]["steps_mean"], "train_seconds": result["train_seconds"]}), flush=True)


def rho_of(run: dict) -> float:
    pairs = [p for split in ("id", "ood") for p in run[split]["pairs"] if p[0] in SETUP["correlation_depths"]]
    return stats.spearman([p[0] for p in pairs], [p[1] for p in pairs])


def report(args) -> None:
    out = Path(args.out)
    runs = [json.loads(p.read_text()) for p in sorted(out.glob("*-seed*.json"))]
    order = list(SETUP["models"])
    table = {}
    for m in sorted({r["model"] for r in runs}, key=order.index):
        rs = [r for r in runs if r["model"] == m]
        depths = sorted({d for r in rs for s in ("id", "ood") for d in r[s]["by_depth"]}, key=int)
        by = lambda r, d: r["id"]["by_depth"].get(d) or r["ood"]["by_depth"][d]  # noqa: E731
        table[m] = {
            "seeds": [r["seed"] for r in rs], "parameters": rs[0]["parameters"], "disk_bytes": rs[0]["disk_bytes"],
            "state_bytes_len57": rs[0]["state_bytes"]["len57"], "tokens": rs[0]["state_bytes"].get("tokens", 57), "hardware": rs[0].get("hardware"),
            "id_all": stats.summary([r["id"]["all"] for r in rs]), "ood_all": stats.summary([r["ood"]["all"] for r in rs]),
            "guess_id": rs[0]["id"]["guess"], "guess_ood": rs[0]["ood"]["guess"],
            "acc_by_depth": {d: stats.summary([by(r, d)["acc"] for r in rs]) for d in depths},
            "steps_by_depth": {d: stats.summary([by(r, d)["steps"] for r in rs]) for d in depths},
            "steps_id": stats.summary([r["id"]["steps_mean"] for r in rs]),
            "flops_id": stats.summary([r["id"]["flops_per_example"] for r in rs]),
            "flops_ood": stats.summary([r["ood"]["flops_per_example"] for r in rs]),
            "rho_depth_steps": stats.summary([rho_of(r) for r in rs]),
            "train_seconds": stats.summary([r["train_seconds"] for r in rs]),
            "latency_ms": stats.summary([r["latency_ms_per_example_cpu"] for r in rs]),
        }
        if "ood_fixed16" in rs[0]:
            table[m]["ood_fixed16_all"] = stats.summary([r["ood_fixed16"]["all"] for r in rs])
    table["decision"] = decide(table)
    (out / "summary.json").write_text(json.dumps(table, indent=1))
    (out / "report.md").write_text(markdown(table))
    print(markdown(table))


def decide(table: dict) -> dict:
    """The pre-registered gate (experiments/r1_02.json), computed from the runs."""
    role = PREREG["roles"]
    need = {role[k] for k in ("candidate", "fixed", "baseline_flops")}
    if not need <= set(table):
        return {"complete": False, "missing": sorted(need - set(table))}
    c, f, tf = table[role["candidate"]], table[role["fixed"]], table[role["baseline_flops"]]
    g = SETUP["gate"]
    learned = max(table[m]["id_all"]["mean"] - table[m]["guess_id"] for m in table if m != "decision")
    if learned < g["learned_margin"]:
        return {"complete": True, "result": "INCONCLUSIVE", "reason": f"no model beat the terminal-guess baseline by {g['learned_margin']}"}
    steps = lambda d: c["steps_by_depth"][d]["mean"]  # noqa: E731
    checks = {
        "G1_depth": c["rho_depth_steps"]["mean"] >= g["rho_mean"] and min(c["rho_depth_steps"]["values"]) >= g["rho_min_seed"]
                    and steps("8") >= g["steps_ratio_8_1"] * steps("1"),
        "G1_rho": round(c["rho_depth_steps"]["mean"], 3),
        "G2_accuracy_vs_fixed": c["id_all"]["mean"] >= f["id_all"]["mean"] - g["fixed_tolerance"],
        "G3_per_flop": (c["id_all"]["mean"] >= tf["id_all"]["mean"] - 0.02 and c["flops_id"]["mean"] <= 0.75 * tf["flops_id"]["mean"])
                       or (c["id_all"]["mean"] >= tf["id_all"]["mean"] + 0.02 and c["flops_id"]["mean"] <= tf["flops_id"]["mean"]),
        "G4_ood": c["ood_all"]["mean"] >= tf["ood_all"]["mean"] + 0.10 and steps("16") > steps("8"),
    }
    if checks["G1_rho"] < g["rho_fail_below"] or not checks["G1_depth"]:
        result = "FAIL"
    elif checks["G2_accuracy_vs_fixed"] and checks["G3_per_flop"]:
        result = "PASS"
    elif checks["G2_accuracy_vs_fixed"] or checks["G3_per_flop"]:
        result = "PARTIAL"
    else:
        result = "FAIL"
    secondary = {}
    for m in role.get("secondary", []):
        if m in table:
            secondary[m] = {"rho": round(table[m]["rho_depth_steps"]["mean"], 3), "id_all": round(table[m]["id_all"]["mean"], 3),
                            "flops_id": table[m]["flops_id"]["mean"]}
    return {"complete": True, "roles": role, "checks": checks, "result": result, "secondary_exploratory": secondary}


def markdown(table: dict) -> str:
    models = [m for m in SETUP["models"] if m in table]
    pct = lambda s: f"{100 * s['mean']:.1f} ± {100 * s['sd']:.1f}"  # noqa: E731
    lines = ["Mean ± SD over seeds; 95% CIs are in summary.json.", "",
             "| | " + " | ".join(models) + " |", "|---|" + "---|" * len(models)]
    rows = [("parameters", lambda r: f"{r['parameters']:,}"),
            ("FLOPs / example (ID)", lambda r: f"{r['flops_id']['mean'] / 1e6:.1f} M"),
            ("FLOPs / example (OOD)", lambda r: f"{r['flops_ood']['mean'] / 1e6:.1f} M"),
            ("activation memory (one input)", lambda r: f"{r['state_bytes_len57'] / 1024:.0f} KiB at {r['tokens']} tokens"),
            ("train wall-clock", lambda r: f"{r['train_seconds']['mean'] / 60:.1f} min"),
            ("latency / example (CPU)", lambda r: f"{r['latency_ms']['mean']:.2f} ms"),
            ("ID accuracy (%)", lambda r: pct(r["id_all"])), ("OOD accuracy (%)", lambda r: pct(r["ood_all"])),
            ("Spearman rho(depth, steps)", lambda r: f"{r['rho_depth_steps']['mean']:.2f} ± {r['rho_depth_steps']['sd']:.2f}")]
    depths = sorted({d for m in models for d in table[m]["acc_by_depth"]}, key=int)
    for d in depths:
        rows.append((f"depth {d}: accuracy (%)", lambda r, d=d: pct(r["acc_by_depth"][d]) if d in r["acc_by_depth"] else "-"))
    for d in depths:
        rows.append((f"depth {d}: steps", lambda r, d=d: f"{r['steps_by_depth'][d]['mean']:.2f}" if d in r["steps_by_depth"] else "-"))
    for name, fn in rows:
        lines.append(f"| {name} | " + " | ".join(fn(table[m]) for m in models) + " |")
    first = table[models[0]]
    lines += ["", f"Terminal-guess baseline: ID {100 * first['guess_id']:.1f}%, OOD {100 * first['guess_ood']:.1f}%.",
              "", f"Decision: `{json.dumps(table.get('decision'))}`"]
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prereg", default=str(ROOT / "experiments" / "r1_02.json"))
    parser.add_argument("command", choices=["train", "report"])
    parser.add_argument("--model")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--steps", type=int)
    parser.add_argument("--eval-every", type=int, default=250)
    parser.add_argument("--threads", type=int, default=1)
    parser.add_argument("--ckpt-every", type=int, default=500)
    parser.add_argument("--budget-min", type=float, default=0)
    parser.add_argument("--out")
    args = parser.parse_args()
    load(args.prereg)
    args.steps = args.steps or SETUP["steps"]
    args.out = args.out or str(ROOT / "results" / PREREG["id"].lower())
    (train if args.command == "train" else report)(args)


if __name__ == "__main__":
    main()
