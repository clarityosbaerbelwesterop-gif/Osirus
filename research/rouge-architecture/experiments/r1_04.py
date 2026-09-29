#!/usr/bin/env python3
"""R1.04: sparse conditional circuits vs dense Transformers matched in active
compute and in total parameters, on the R1.01 micro-benchmark.

Training, evaluation, FLOPs and resume are the R1.01 runner's (the same
data, frozen eval sets, optimizer and schedule); this file adds the sparse
model, routing statistics and the pre-registered gate of experiments/r1_04.json.

    python experiments/r1_04.py --prereg experiments/r1_04.json train --model moe-top2 --seed 1
    python experiments/r1_04.py --prereg experiments/r1_04.json report --out results/r1.04
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import r1_01 as base  # noqa: E402
from benchmarks import microbench as mb  # noqa: E402
from lab import stats  # noqa: E402
from prototypes.sparse_circuits import SparseTransformer  # noqa: E402
from prototypes.transformer_baseline import Transformer  # noqa: E402


def build(name: str) -> torch.nn.Module:
    config = dict(base.SETUP["models"][name])
    model = (SparseTransformer if name.startswith("moe") else Transformer)(len(mb.VOCAB), **config)
    model.tau_warmup = 0
    return model


@torch.no_grad()
def routing(model, examples) -> dict:
    """Router statistics on frozen examples (real tokens only)."""
    if not isinstance(model, SparseTransformer):
        return {}
    model.eval()
    ids, lengths, _ = base.collate(examples)
    model(ids, lengths)
    real = (torch.arange(ids.shape[1])[None, :] < lengths[:, None]).flatten()
    tasks = torch.tensor([mb.TASKS.index(t) for _, _, t, _ in examples])[:, None].expand(ids.shape).flatten()[real]
    tokens = ids.flatten()[real]
    layers = []
    for block in model.blocks:
        probs, chosen = block.moe.last["probs"][real], block.moe.last["chosen"][real, 0]
        e = model.experts
        load = torch.bincount(chosen, minlength=e).float() / len(chosen)
        token_entropy = float(-(probs * probs.clamp_min(1e-9).log()).sum(-1).mean() / math.log(e))
        joint = torch.zeros(len(mb.TASKS), e)
        joint.index_put_((tasks, chosen), torch.ones(len(chosen)), accumulate=True)
        joint /= joint.sum()
        pt, pe = joint.sum(1, keepdim=True), joint.sum(0, keepdim=True)
        mi = float((joint * (joint.clamp_min(1e-12) / (pt @ pe).clamp_min(1e-12)).log()).sum())
        ht = float(-(pt * pt.clamp_min(1e-12).log()).sum())
        layers.append({"load": [round(x, 4) for x in load.tolist()], "min_load": float(load.min()),
                       "token_entropy": round(token_entropy, 4),
                       "load_entropy": round(float(-(load * load.clamp_min(1e-12).log()).sum() / math.log(e)), 4),
                       "task_expert_nmi": round(mi / ht, 4),
                       "task_expert_nmi_given_token": round(conditional_nmi(tokens, tasks, chosen, e), 4)})
    model.train()
    mean = lambda k: sum(x[k] for x in layers) / len(layers)  # noqa: E731
    return {"layers": layers, "task_expert_nmi": mean("task_expert_nmi"), "nmi_given_token": mean("task_expert_nmi_given_token"),
            "token_entropy": mean("token_entropy"), "min_load": min(x["min_load"] for x in layers)}


def conditional_nmi(tokens, tasks, chosen, experts) -> float:
    """I(task; expert | token) / H(task | token): does the router send the SAME
    token to different modules depending on the task? Token-level routing
    alone (digits to one expert, letters to another) scores 0 here, although
    it already gives a high unconditional task-expert NMI."""
    n, mi, h = len(tokens), 0.0, 0.0
    for tok in tokens.unique():
        sel = tokens == tok
        w = float(sel.sum()) / n
        joint = torch.zeros(len(mb.TASKS), experts)
        joint.index_put_((tasks[sel], chosen[sel]), torch.ones(int(sel.sum())), accumulate=True)
        joint /= joint.sum()
        pt, pe = joint.sum(1, keepdim=True), joint.sum(0, keepdim=True)
        mi += w * float((joint * (joint.clamp_min(1e-12) / (pt @ pe).clamp_min(1e-12)).log()).sum())
        h += w * float(-(pt * pt.clamp_min(1e-12).log()).sum())
    return mi / h if h else 0.0


def train(args) -> None:
    base.train(args)
    path = Path(args.out) / f"{args.model}-seed{args.seed}.json"
    result = json.loads(path.read_text())
    model = build(args.model)
    model.load_state_dict(torch.load(Path(args.out) / "checkpoints" / f"{args.model}-seed{args.seed}.pt"))
    result["active_parameters"] = getattr(model, "active_parameters", lambda: result["parameters"])()
    result["routing"] = routing(model, mb.fixed_set("r1.01", 100, "id"))
    torch.manual_seed(args.seed)  # the same router before training: the reference for specialisation
    result["routing_init"] = routing(build(args.model), mb.fixed_set("r1.01", 100, "id"))
    path.write_text(json.dumps(result, indent=1))
    print(json.dumps({"model": args.model, "active": result["active_parameters"], "routing": {k: v for k, v in result["routing"].items() if k != "layers"}}))


def report(args) -> None:
    base.report(args)  # writes the R1.01-style table with seed statistics
    out = Path(args.out)
    runs = [json.loads(p.read_text()) for p in sorted(out.glob("*-seed*.json"))]
    table = json.loads((out / "summary.json").read_text())
    for m in [m for m in base.SETUP["models"] if m in table]:
        rs = [r for r in runs if r["model"] == m]
        table[m]["active_parameters"] = rs[0].get("active_parameters", rs[0]["parameters"])
        if rs[0].get("routing"):
            for key in ("task_expert_nmi", "nmi_given_token", "token_entropy", "min_load"):
                table[m][key] = stats.summary([r["routing"][key] for r in rs])
            table[m]["nmi_given_token_init"] = stats.summary([r["routing_init"]["nmi_given_token"] for r in rs])
    table["decision"] = decide(table)
    (out / "summary.json").write_text(json.dumps(table, indent=1))
    extra = ["", "| | total params | active params | FLOPs/example (ID) | task-expert NMI | NMI given token (trained / init) | router entropy | min expert load |",
             "|---|---|---|---|---|---|---|---|"]
    for m in [m for m in base.SETUP["models"] if m in table]:
        r = table[m]
        f = lambda k, fmt: fmt.format(r[k]["mean"]) if k in r else "-"  # noqa: E731
        extra.append(f"| {m} | {r['parameters']:,} | {r['active_parameters']:,} | {r['flops_per_example_id'] / 1e6:.1f} M | "
                     f"{f('task_expert_nmi', '{:.3f}')} | {f('nmi_given_token', '{:.3f}')} / {f('nmi_given_token_init', '{:.3f}')} | "
                     f"{f('token_entropy', '{:.3f}')} | {f('min_load', '{:.3f}')} |")
    extra += ["", f"R1.04 decision: `{json.dumps(table['decision'])}`"]
    text = (out / "report.md").read_text() + "\n".join(extra) + "\n"
    (out / "report.md").write_text(text)
    print("\n".join(extra))


def decide(table: dict) -> dict:
    role = base.PREREG["roles"]
    need = {role["candidate"], role["active_matched"], role["total_matched"]}
    if not need <= set(table):
        return {"complete": False, "missing": sorted(need - set(table))}
    c, a, t = table[role["candidate"]], table[role["active_matched"]], table[role["total_matched"]]
    g = base.SETUP["gate"]
    acc = lambda r, k: r["stats"][k]["mean"]  # noqa: E731
    checks = {
        "S1_vs_active_matched": acc(c, "id_all") >= acc(a, "id_all") + g["active_margin"]
                                and acc(c, "ood_all") >= acc(a, "ood_all") - 0.01
                                and c["flops_per_example_id"] <= 1.15 * a["flops_per_example_id"],
        "S2_vs_total_matched": acc(c, "id_all") >= acc(t, "id_all") - 0.02 and c["flops_per_example_id"] <= 0.5 * t["flops_per_example_id"],
        "S3_specialisation": c["nmi_given_token"]["mean"] >= g["nmi_min"]
                             and c["nmi_given_token"]["mean"] >= 2 * c["nmi_given_token_init"]["mean"]
                             and c["min_load"]["mean"] >= g["min_load"],
    }
    benefit = checks["S1_vs_active_matched"] or checks["S2_vs_total_matched"]
    result = "PASS" if benefit and checks["S3_specialisation"] else "PARTIAL" if benefit or checks["S3_specialisation"] else "FAIL"
    return {"complete": True, "roles": role, "checks": checks, "result": result}


if __name__ == "__main__":
    base.build = build
    base.decide = lambda table, runs: {"note": "R1.01 predictions do not apply to R1.04"}
    import argparse
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
    args.steps = args.steps or base.SETUP["steps"]
    args.out = args.out or str(base.ROOT / "results" / base.PREREG["id"].lower())
    (train if args.command == "train" else report)(args)
