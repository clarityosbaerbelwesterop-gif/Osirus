#!/usr/bin/env python3
"""R1.01 / R1.01b: Rouge prototype (persistent state + adaptive recurrent
compute) vs Transformer baselines matched in parameters and in FLOPs, same
data, same token budget, same optimizer, same hardware. The experiment is
defined by its pre-registration (experiments/r1_01.json, r1_01b.json).

    python experiments/r1_01.py --prereg experiments/r1_01b.json train --model rouge-b --seed 1
    python experiments/r1_01.py --prereg experiments/r1_01b.json report --out results/r1.01b

Every run writes a checkpoint (never committed; sha256 recorded) and a JSON
with parameters, disk, state memory, FLOPs (measured with
torch.utils.flop_counter), latency, wall-clock, the learning curve and
exact-match accuracy per task on frozen ID and OOD sets.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
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

from benchmarks import microbench as mb  # noqa: E402
from prototypes.rouge_r101 import Rouge  # noqa: E402
from prototypes.transformer_baseline import Transformer  # noqa: E402

PREREG: dict = {}
SETUP: dict = {}
ROLES_R101 = {"candidate": "rouge", "baseline": "transformer", "baseline_flops": "transformer-flops", "ablation": "rouge-fixed"}


def load(path: str) -> None:
    global PREREG, SETUP
    PREREG = json.loads(Path(path).read_text())
    SETUP = PREREG["setup"]


def roles() -> dict:
    return PREREG.get("roles", ROLES_R101)


def build(name: str) -> torch.nn.Module:
    config = dict(SETUP["models"][name])
    tau_warmup = config.pop("tau_warmup", 0)  # a training-schedule setting, not an architecture one
    model = (Transformer if name.startswith("transformer") else Rouge)(len(mb.VOCAB), **config)
    model.tau_warmup = tau_warmup
    return model


def collate(examples):
    lengths = torch.tensor([len(t) for t, _, _, _ in examples])
    ids = torch.full((len(examples), int(lengths.max())), mb.PAD)
    for i, (tokens, _, _, _) in enumerate(examples):
        ids[i, : len(tokens)] = torch.tensor(tokens)
    return ids, lengths, torch.tensor([a for _, a, _, _ in examples])


@torch.no_grad()
def evaluate(model, examples, batch_size=150, **kwargs) -> dict:
    model.eval()
    rows, steps = [], []
    for i in range(0, len(examples), batch_size):
        chunk = examples[i : i + batch_size]
        ids, lengths, answers = collate(chunk)
        logits, info = model(ids, lengths, **kwargs)
        correct = (logits.argmax(-1) == answers).tolist()
        rows += [(task, level, ok) for (_, _, task, level), ok in zip(chunk, correct)]
        if "steps" in info:
            steps += info["steps"].tolist()
    model.train()
    out = {"all": sum(ok for *_, ok in rows) / len(rows)}
    for task in mb.TASKS:
        sel = [ok for t, _, ok in rows if t == task]
        out[task] = sum(sel) / len(sel)
    if steps:
        out["think_steps_mean"] = sum(steps) / len(steps)
        by_level = {}
        for (task, level, _), s in zip(rows, steps):
            by_level.setdefault(f"{task}:{level}", []).append(s)
        out["think_steps_by_level"] = {k: round(sum(v) / len(v), 3) for k, v in sorted(by_level.items())}
    return out


def flops_per_example(model, examples, **kwargs) -> float:
    ids, lengths, _ = collate(examples)
    # Forward only (no backward is run); grad mode stays on because the
    # counter's module tracker hooks into autograd.
    model.eval()
    with FlopCounterMode(display=False) as counter:
        model(ids, lengths, **kwargs)
    model.train()
    return counter.get_total_flops() / len(examples)


def train(args) -> None:
    torch.manual_seed(args.seed)
    torch.set_num_threads(args.threads)
    rng = random.Random(f"train:{args.seed}")
    model = build(args.model)
    params = sum(p.numel() for p in model.parameters())
    opt = torch.optim.AdamW(model.parameters(), lr=SETUP["lr"], weight_decay=SETUP["weight_decay"])
    warm = SETUP["warmup"]
    sched = torch.optim.lr_scheduler.LambdaLR(
        opt, lambda s: min(1.0, (s + 1) / warm) * 0.5 * (1 + math.cos(math.pi * min(1.0, s / args.steps))))
    probe = mb.fixed_set("probe", 50, "id")
    curve, tokens_seen, start = [], 0, time.time()
    for step in range(1, args.steps + 1):
        ids, lengths, answers = collate(mb.batch(rng, SETUP["batch"], "id"))
        tokens_seen += int(lengths.sum())
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
            # No ponder cost early, so halting cannot collapse before thinking helps.
            model.tau = model.tau_base * min(1.0, step / (model.tau_warmup * args.steps))
        if step % args.eval_every == 0 or step == args.steps:
            curve.append({"step": step, "loss": round(loss.item(), 4), "probe_id": evaluate(model, probe)["all"],
                          "elapsed_s": round(time.time() - start, 1)})
            print(args.model, args.seed, curve[-1], flush=True)
    train_seconds = time.time() - start

    out = Path(args.out)
    (out / "checkpoints").mkdir(parents=True, exist_ok=True)
    ckpt = out / "checkpoints" / f"{args.model}-seed{args.seed}.pt"
    torch.save(model.state_dict(), ckpt)

    id_set, ood_set = mb.fixed_set("r1.01", SETUP["eval_per_task"], "id"), mb.fixed_set("r1.01", SETUP["eval_per_task"], "ood")
    t0 = time.time()
    result_id = evaluate(model, id_set)
    latency_ms = (time.time() - t0) / len(id_set) * 1000
    result = {
        "model": args.model, "seed": args.seed, "steps": args.steps, "batch": SETUP["batch"],
        "training_examples": args.steps * SETUP["batch"], "training_tokens": tokens_seen,
        "train_seconds": round(train_seconds, 1), "threads": args.threads,
        "parameters": params, "disk_bytes": ckpt.stat().st_size,
        "checkpoint_sha256": hashlib.sha256(ckpt.read_bytes()).hexdigest(),
        "state_bytes": {"len39": model.state_bytes(39), "len67": model.state_bytes(67)},
        "peak_rss_mb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1),
        "latency_ms_per_example_cpu1": round(latency_ms, 3),
        "id": result_id, "ood": evaluate(model, ood_set), "curve": curve,
        "flops_per_example": {"id": flops_per_example(model, id_set[:60]), "ood": flops_per_example(model, ood_set[:60])},
    }
    if getattr(model, "halting", False):
        result["ood_think16"] = evaluate(model, ood_set, max_think=16)
        one = flops_per_example(model, id_set[:60], max_think=1)
        two = flops_per_example(model, id_set[:60], max_think=2)
        result["flops_effective"] = {
            split: one + (result[split]["think_steps_mean"] - 1) * (two - one) for split in ("id", "ood")}
    (out / f"{args.model}-seed{args.seed}.json").write_text(json.dumps(result, indent=1))
    print(json.dumps({k: result[k] for k in ("model", "seed", "id", "ood", "train_seconds")}), flush=True)


def report(args) -> None:
    out = Path(args.out)
    runs = [json.loads(p.read_text()) for p in sorted(out.glob("*-seed*.json"))]
    order = list(SETUP["models"])
    models = sorted({r["model"] for r in runs}, key=order.index)
    table = {}
    for m in models:
        rs = [r for r in runs if r["model"] == m]
        mean = lambda f: sum(f(r) for r in rs) / len(rs)  # noqa: E731
        table[m] = {
            "seeds": [r["seed"] for r in rs],
            "parameters": rs[0]["parameters"], "disk_bytes": rs[0]["disk_bytes"],
            "state_bytes_len67": rs[0]["state_bytes"]["len67"],
            "flops_per_example_id": mean(lambda r: r.get("flops_effective", r["flops_per_example"])["id"]),
            "flops_per_example_ood": mean(lambda r: r.get("flops_effective", r["flops_per_example"])["ood"]),
            "train_seconds": mean(lambda r: r["train_seconds"]),
            "latency_ms": mean(lambda r: r["latency_ms_per_example_cpu1"]),
            **{f"id_{t}": mean(lambda r, t=t: r["id"][t]) for t in ("all", *mb.TASKS)},
            **{f"ood_{t}": mean(lambda r, t=t: r["ood"][t]) for t in ("all", *mb.TASKS)},
            "per_seed_ood": {t: [round(r["ood"][t], 3) for r in rs] for t in mb.TASKS},
            "per_seed_id": {t: [round(r["id"][t], 3) for r in rs] for t in mb.TASKS},
        }
        if "ood_think16" in rs[0]:
            table[m]["think_steps_by_level"] = rs[0]["ood"].get("think_steps_by_level")
            table[m]["ood_think16_all"] = mean(lambda r: r["ood_think16"]["all"])
            table[m]["think_steps_id"] = mean(lambda r: r["id"]["think_steps_mean"])
            table[m]["think_steps_ood"] = mean(lambda r: r["ood"]["think_steps_mean"])
    table["decision"] = decide(table, runs)
    (out / "summary.json").write_text(json.dumps(table, indent=1))
    (out / "report.md").write_text(markdown(table))
    print(markdown(table))


def markdown(table: dict) -> str:
    models = [m for m in SETUP["models"] if m in table]
    pct = lambda v: f"{100 * v:.1f}"  # noqa: E731
    lines = ["| | " + " | ".join(models) + " |", "|---|" + "---|" * len(models)]
    rows = [
        ("parameters", lambda r: f"{r['parameters']:,}"),
        ("disk (fp32 checkpoint)", lambda r: f"{r['disk_bytes'] / 1e6:.2f} MB"),
        ("state memory at 67 tokens", lambda r: f"{r['state_bytes_len67'] / 1024:.0f} KiB"),
        ("FLOPs / example (ID)", lambda r: f"{r['flops_per_example_id'] / 1e6:.0f} M"),
        ("FLOPs / example (OOD)", lambda r: f"{r['flops_per_example_ood'] / 1e6:.0f} M"),
        ("train wall-clock (CPU)", lambda r: f"{r['train_seconds'] / 60:.1f} min"),
        ("latency / example (CPU, 1 batch)", lambda r: f"{r['latency_ms']:.2f} ms"),
    ]
    for split in ("id", "ood"):
        for task in ("all", *mb.TASKS):
            rows.append((f"{split.upper()} {task} (%)", lambda r, k=f"{split}_{task}": pct(r[k])))
    for name, fn in rows:
        lines.append(f"| {name} | " + " | ".join(fn(table[m]) for m in models) + " |")
    for m in (m for m in models if "think_steps_id" in table[m]):
        r = table[m]
        lines += ["", f"{m} think steps: ID {r['think_steps_id']:.2f}, OOD {r['think_steps_ood']:.2f}; "
                      f"OOD with 16 think steps: {pct(r['ood_think16_all'])}%."]
    lines += ["", "Per-seed OOD accuracy:", ""]
    for m in models:
        lines.append(f"- {m}: " + ", ".join(f"{t} {v}" for t, v in table[m]["per_seed_ood"].items()))
    lines += ["", f"Decision: `{json.dumps(table.get('decision'))}`"]
    return "\n".join(lines) + "\n"


def spearman(xs: list[float], ys: list[float]) -> float:
    def ranks(v):  # average ranks, so ties carry no correlation
        order = sorted(range(len(v)), key=v.__getitem__)
        r = [0.0] * len(v)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]:
                j += 1
            for k in range(i, j + 1):
                r[order[k]] = (i + j) / 2
            i = j + 1
        return r
    rx, ry = ranks(xs), ranks(ys)
    mx, my = sum(rx) / len(rx), sum(ry) / len(ry)
    cov = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    var = (sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry)) ** 0.5
    return cov / var if var else 0.0


def decide(table: dict, runs: list[dict]) -> dict:
    """The pre-registered predictions P1-P5 and the decision, from the runs."""
    role = roles()
    need = set(role.values())
    if not need <= set(table):
        return {"complete": False, "missing": sorted(need - set(table))}
    t, tf, r, rf = (table[role[k]] for k in ("baseline", "baseline_flops", "candidate", "ablation"))
    seeds = lambda m, task: {x["seed"]: x["ood"][task] for x in runs if x["model"] == m}  # noqa: E731
    every = lambda task: all(seeds(role["candidate"], task)[k] > v for k, v in seeds(role["baseline"], task).items())  # noqa: E731
    levels = {}
    for x in runs:
        if x["model"] == role["candidate"]:
            for split in ("id", "ood"):
                for key, steps in x[split].get("think_steps_by_level", {}).items():
                    task, level = key.split(":")
                    if task == "hops":
                        levels.setdefault(int(level), []).append(steps)
    hop_levels = sorted(levels)
    rho = spearman(hop_levels, [sum(levels[h]) / len(levels[h]) for h in hop_levels]) if len(hop_levels) > 2 else 0.0
    p = {
        "P1_state": r["ood_state"] >= t["ood_state"] + 0.20 and every("state"),
        "P2_hops": r["ood_hops"] >= t["ood_hops"] + 0.10 and rho >= 0.6,
        "P2_hops_rho": round(rho, 3),
        "P3_recall": t["id_recall"] >= r["id_recall"] and t["ood_recall"] >= r["ood_recall"],
        "P4_vs_ablation": r["ood_all"] >= rf["ood_all"] - 0.02 and r.get("ood_think16_all", r["ood_all"]) >= r["ood_all"] - 0.02,
        "P5_compute_state": r["ood_state"] > tf["ood_state"],
        "P5_compute_hops": r["ood_hops"] > tf["ood_hops"],
    }
    advance = (p["P1_state"] and p["P5_compute_state"]) or (p["P2_hops"] and p["P5_compute_hops"])
    return {"complete": True, "roles": role, "predictions": p, "result": "ADVANCE" if advance else "FAIL"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prereg", default=str(ROOT / "experiments" / "r1_01.json"))
    parser.add_argument("command", choices=["train", "report"])
    parser.add_argument("--model")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--steps", type=int)
    parser.add_argument("--eval-every", type=int, default=250)
    parser.add_argument("--threads", type=int, default=1)
    parser.add_argument("--out")
    args = parser.parse_args()
    load(args.prereg)
    args.steps = args.steps or SETUP["steps"]
    args.out = args.out or str(ROOT / "results" / PREREG["id"].lower())
    (train if args.command == "train" else report)(args)


if __name__ == "__main__":
    main()
