#!/usr/bin/env python3
"""R1.03: what is in the persistent state, and does a two-level memory fix
the recall loss at a fraction of the KV cache?

Training, evaluation, FLOPs and resume are the R1.01 runner's (same
benchmark, frozen eval sets, optimizer and schedule). This file adds:
- the two-level-memory model (prototypes/rouge_mem.py);
- linear probes on the frozen representation after reading the input:
  facts (is key x stored?), intermediate results (the running value half
  way through a state chain; the first hop of a chain), and uncertainty
  (expected calibration error of the answer distribution);
- recall accuracy by number of facts against inference memory bytes;
- the pre-registered gate of experiments/r1_03.json.

    python experiments/r1_03.py --prereg experiments/r1_03.json train --model rouge-mem --seed 1
    python experiments/r1_03.py --prereg experiments/r1_03.json report --out results/r1.03
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

import torch
import torch.nn.functional as F

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import r1_01 as base  # noqa: E402
from benchmarks import microbench as mb  # noqa: E402
from lab import stats  # noqa: E402
from prototypes.rouge_mem import RougeMem  # noqa: E402
from prototypes.rouge_r101 import Rouge  # noqa: E402
from prototypes.transformer_baseline import Transformer  # noqa: E402


def build(name: str) -> torch.nn.Module:
    config = dict(base.SETUP["models"][name])
    tau_warmup = config.pop("tau_warmup", 0)
    cls = Transformer if name.startswith("transformer") else RougeMem if name.startswith("rouge-mem") else Rouge
    model = cls(len(mb.VOCAB), **config)
    model.tau_warmup = tau_warmup
    return model


@torch.no_grad()
def features(model, examples) -> torch.Tensor:
    """The representation a probe may read: the state after the whole input
    (Rouge: slots flattened, plus memory slots for rouge-mem; Transformer:
    the last position's hidden state in every layer, i.e. what the next token
    could attend from its own position)."""
    model.eval()
    ids, lengths, _ = base.collate(examples)
    if isinstance(model, Transformer):
        x, outs = model.embed(ids), []
        for block in model.blocks:
            x = block(x)
            outs.append(x[torch.arange(len(ids)), lengths - 1])
        feats = torch.cat(outs, -1)
    else:
        b, t = ids.shape
        u = model.embed(ids)
        state = model.init_state.expand(b, -1, -1)
        memory, prev = (torch.zeros(b, model.memory_slots, model.d), torch.zeros(b, model.d)) if isinstance(model, RougeMem) else (None, None)
        for i in range(t):
            live = i < lengths
            state = torch.where(live[:, None, None], model.step(state, u[:, i]), state)
            if memory is not None:
                memory = model.write(memory, prev, u[:, i], live)
                prev = torch.where(live[:, None], u[:, i], prev)
        feats = state.flatten(1) if memory is None else torch.cat([state.flatten(1), memory.flatten(1)], -1)
    model.train()
    return feats


def probe_targets(examples) -> dict:
    """Ground truth read from the tokens (never from a model)."""
    out = {"fact_present": [], "state_halfway": [], "first_hop": []}
    for tokens, _, task, _ in examples:
        words = [mb.VOCAB[t] for t in tokens]
        body = words[1 : words.index("?")]
        if task == "recall":
            out["fact_present"].append([1.0 if l in body[0::2] else 0.0 for l in mb.LETTERS])
        if task == "state":
            x, ops = int(body[0]), list(zip(body[1::2], body[2::2]))
            for op, c in ops[: len(ops) // 2]:
                c = int(c)
                x = (x + c) % 10 if op == "+" else (x - c) % 10 if op == "-" else (x * c) % 10
            out["state_halfway"].append(x)
        if task == "hops":
            table = {body[i]: body[i + 2] for i in range(0, len(body), 4)}
            out["first_hop"].append(mb.VOCAB.index(table[words[-1]]))
    return out


def fit_probe(x, y, classes, multilabel=False, steps=300):
    mean, std = x.mean(0), x.std(0) + 1e-5
    w = torch.zeros(x.shape[1], classes, requires_grad=True)
    b = torch.zeros(classes, requires_grad=True)
    opt = torch.optim.Adam([w, b], lr=0.05)
    xs = (x - mean) / std
    for _ in range(steps):
        logits = xs @ w + b
        loss = (F.binary_cross_entropy_with_logits(logits, y) if multilabel else F.cross_entropy(logits, y)) + 1e-3 * (w ** 2).sum()
        opt.zero_grad()
        loss.backward()
        opt.step()
    return lambda z: ((z - mean) / std) @ w.detach() + b.detach()


def probes(model, seed: int) -> dict:
    per = base.SETUP["probe_examples"]
    train_set = [e for e in mb.batch(random.Random(f"probe-train:{seed}"), 3 * per, "id")]
    tests = {"id": mb.batch(random.Random(f"probe-test:{seed}"), 3 * per // 2, "id"),
             "ood": mb.batch(random.Random(f"probe-ood:{seed}"), 3 * per // 2, "ood")}
    out = {}
    for name, task, classes, multi in (("fact_present", "recall", 26, True), ("state_halfway", "state", 10, False),
                                       ("first_hop", "hops", len(mb.VOCAB), False)):
        tr = [e for e in train_set if e[2] == task]
        y = probe_targets(tr)[name]
        y = torch.tensor(y) if multi else torch.tensor(y, dtype=torch.long)
        probe = fit_probe(features(model, tr), y, classes, multi)
        for split, examples in tests.items():
            te = [e for e in examples if e[2] == task]
            yt = probe_targets(te)[name]
            pred = probe(features(model, te))
            if multi:  # balanced accuracy: most letters are absent, so plain accuracy rewards "nothing stored"
                yt, hit = torch.tensor(yt), (pred > 0).float()
                acc = 0.5 * float(hit[yt == 1].mean() + (1 - hit[yt == 0]).mean())
            else:
                acc = float((pred.argmax(-1) == torch.tensor(yt)).float().mean())
            out[f"{name}_{split}"] = round(acc, 4)
    return out


@torch.no_grad()
def calibration(model, examples, bins=10) -> float:
    """Expected calibration error of the answer distribution (uncertainty)."""
    model.eval()
    ids, lengths, answers = base.collate(examples)
    probs = F.softmax(model(ids, lengths)[0], -1)
    model.train()
    conf, pred = probs.max(-1)
    correct = (pred == answers).float()
    ece = 0.0
    for i in range(bins):
        sel = (conf > i / bins) & (conf <= (i + 1) / bins)
        if sel.any():
            ece += float(sel.float().mean()) * abs(float(correct[sel].mean()) - float(conf[sel].mean()))
    return ece


@torch.no_grad()
def recall_curve(model) -> dict:
    """Recall accuracy by number of facts (2..26) and the inference memory it needs."""
    model.eval()
    out = {}
    for n in (2, 6, 10, 14, 20, 26):
        r = random.Random(f"recall-curve:{n}")
        ex = [(mb.encode(t), mb.TOKEN[a], "recall", n) for t, a in (mb.recall_task(r, n) for _ in range(200))]
        ids, lengths, answers = base.collate(ex)
        acc = float((model(ids, lengths)[0].argmax(-1) == answers).float().mean())
        cue = sum(mb.shortcuts(t, "recall")["most_common_value"] == a for t, a, _, _ in ex) / len(ex)
        out[str(n)] = {"acc": round(acc, 4), "tokens": 2 * n + 3, "memory_bytes": model.state_bytes(2 * n + 3),
                       "value_guess_floor": round(cue, 4)}
    model.train()
    return out


def train(args) -> None:
    base.train(args)
    path = Path(args.out) / f"{args.model}-seed{args.seed}.json"
    result = json.loads(path.read_text())
    model = build(args.model)
    model.load_state_dict(torch.load(Path(args.out) / "checkpoints" / f"{args.model}-seed{args.seed}.pt"))
    result["probes"] = probes(model, args.seed)
    torch.manual_seed(args.seed)  # the same architecture untrained: what the probe reads without learning
    result["probes_init"] = probes(build(args.model), args.seed)
    result["ece"] = {s: round(calibration(model, mb.fixed_set("r1.01", 300, s)), 4) for s in ("id", "ood")}
    result["recall_curve"] = recall_curve(model)
    path.write_text(json.dumps(result, indent=1))
    print(json.dumps({"model": args.model, "probes": result["probes"], "ece": result["ece"],
                      "recall_curve": {k: v["acc"] for k, v in result["recall_curve"].items()}}))


def report(args) -> None:
    base.report(args)
    out = Path(args.out)
    runs = [json.loads(p.read_text()) for p in sorted(out.glob("*-seed*.json"))]
    table = json.loads((out / "summary.json").read_text())
    models = [m for m in base.SETUP["models"] if m in table]
    for m in models:
        rs = [r for r in runs if r["model"] == m]
        table[m]["probes"] = {k: stats.summary([r["probes"][k] for r in rs]) for k in rs[0]["probes"]}
        table[m]["probes_init"] = {k: stats.summary([r["probes_init"][k] for r in rs]) for k in rs[0]["probes_init"]}
        table[m]["ece"] = {s: stats.summary([r["ece"][s] for r in rs]) for s in ("id", "ood")}
        table[m]["recall_curve"] = {n: {"acc": stats.summary([r["recall_curve"][n]["acc"] for r in rs]),
                                        "memory_bytes": rs[0]["recall_curve"][n]["memory_bytes"]} for n in rs[0]["recall_curve"]}
    table["decision"] = decide(table)
    (out / "summary.json").write_text(json.dumps(table, indent=1))
    lines = ["", "| | " + " | ".join(models) + " |", "|---|" + "---|" * len(models)]
    for k in runs[0]["probes"]:
        lines.append(f"| probe {k} (%), trained / untrained | " + " | ".join(
            f"{100 * table[m]['probes'][k]['mean']:.1f} / {100 * table[m]['probes_init'][k]['mean']:.1f}" for m in models) + " |")
    for s in ("id", "ood"):
        lines.append(f"| ECE {s} | " + " | ".join(f"{table[m]['ece'][s]['mean']:.3f}" for m in models) + " |")
    for n in runs[0]["recall_curve"]:
        floor = runs[0]["recall_curve"][n].get("value_guess_floor", 0)
        lines.append(f"| recall, {n} facts: acc % (memory); value-guess floor {100 * floor:.0f}% | " + " | ".join(
            f"{100 * table[m]['recall_curve'][n]['acc']['mean']:.1f} ({table[m]['recall_curve'][n]['memory_bytes'] / 1024:.0f} KiB)" for m in models) + " |")
    lines += ["", f"R1.03 decision: `{json.dumps(table['decision'])}`"]
    (out / "report.md").write_text((out / "report.md").read_text() + "\n".join(lines) + "\n")
    print("\n".join(lines))


def decide(table: dict) -> dict:
    role = base.PREREG["roles"]
    need = {role["candidate"], role["state_only"], role["baseline"]}
    if not need <= set(table):
        return {"complete": False, "missing": sorted(need - set(table))}
    c, s, t = table[role["candidate"]], table[role["state_only"]], table[role["baseline"]]
    g = base.SETUP["gate"]
    acc = lambda r, k: r["stats"][k]["mean"]  # noqa: E731
    longest = max(c["recall_curve"], key=int)
    checks = {
        "M1_recall": acc(c, "ood_recall") >= acc(s, "ood_recall") + g["recall_gain"] and acc(c, "ood_recall") >= acc(t, "ood_recall") - 0.02
                     and c["recall_curve"][longest]["memory_bytes"] <= g["memory_ratio"] * t["recall_curve"][longest]["memory_bytes"],
        "M1_recall_gain_only": acc(c, "ood_recall") >= acc(s, "ood_recall") + g["recall_gain"],
        "M2_no_regression": acc(c, "ood_state") >= acc(s, "ood_state") - 0.02 and acc(c, "ood_hops") >= acc(s, "ood_hops") - 0.02,
        "M3_facts_probe": c["probes"]["fact_present_ood"]["mean"] >= s["probes"]["fact_present_ood"]["mean"]
                          and c["probes"]["fact_present_ood"]["mean"] > c["probes_init"]["fact_present_ood"]["mean"],
    }
    if checks["M1_recall"] and checks["M2_no_regression"]:
        result = "PASS"
    elif checks["M1_recall_gain_only"]:
        result = "PARTIAL"
    else:
        result = "FAIL"
    return {"complete": True, "roles": role, "checks": checks, "result": result}


if __name__ == "__main__":
    base.build = build
    base.decide = lambda table, runs: {"note": "R1.01 predictions do not apply to R1.03"}
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
    base.load(args.prereg)
    globals()["mb"] = base.mb
    args.steps = args.steps or base.SETUP["steps"]
    args.out = args.out or str(base.ROOT / "results" / base.PREREG["id"].lower())
    (train if args.command == "train" else report)(args)
