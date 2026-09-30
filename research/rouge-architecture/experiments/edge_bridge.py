#!/usr/bin/env python3
"""R1.73a format audit, using native Rouge and the existing gate/statistics harness.

The CPU phase uses seeded, untrained C fixtures. It tests serialization and
kernel timings; it cannot establish learned quality or tablet performance.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import resource
import subprocess
import sys
import time
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
sys.path[:0] = [str(ROOT), str(REPO / "training/rouge")]

from benchmarks import text
from lab import gate, stats
from native import bench, evaluate, packed
from native.config import RougeConfig
from native.layers import BitLinear, pack_ternary, quantize_ternary, unpack_ternary
from native.model import RougeModel


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(prereg: dict, args) -> None:
    setup = prereg["setup"]
    if args.seed not in setup["seeds"] or args.model not in setup["models"]:
        raise ValueError("model/seed is outside the pre-registration")
    torch.manual_seed(args.seed)
    torch.set_num_threads(setup["threads"])
    corpus = text.Corpus()
    if corpus.source != "enwik8" or corpus.sha256 != prereg["data"]["sha256"]:
        raise ValueError("the format audit requires the registered enwik8 bytes")
    cfg = RougeConfig(**setup["models"][args.model]["config"])
    model = RougeModel(cfg).eval()
    out = Path(args.out)
    ckpts = out / "checkpoints"
    ckpts.mkdir(parents=True, exist_ok=True)
    master = ckpts / f"master-seed{args.seed}.pt"
    exported = ckpts / f"packed-seed{args.seed}.pt"
    torch.save(model.state_dict(), master)
    t0 = time.perf_counter()
    info = packed.save(model, exported)
    recovered = packed.load(exported)
    encoding_s = time.perf_counter() - t0
    segs = text.segments(corpus.splits["valid"], setup["length"], setup["eval"]["segments"])
    max_error, bpb_delta, equal_codes = 0.0, 0.0, True
    with torch.no_grad():
        for module in model.modules():
            if isinstance(module, BitLinear):
                q, _ = quantize_ternary(module.weight)
                equal_codes &= torch.equal(q.to(torch.int8).flatten(), unpack_ternary(pack_ternary(q), q.numel()))
        for seg in segs:
            x, y = seg[None, :-1], seg[None, 1:]
            a, _ = model(x)
            b, _ = recovered(x)
            max_error = max(max_error, (a - b).abs().max().item())
            bpb_delta = max(bpb_delta, abs((model(x, y) - recovered(x, y)).item()) / math.log(2))
    throughput = {"fakequant": evaluate.decode_speed(model, torch.device("cpu"), context=128, new=64),
                  "packed_unfused": evaluate.decode_speed(recovered, torch.device("cpu"), context=128, new=64)}
    kernels = bench.run(setup["kernel"]["tokens"], setup["kernel"]["d"], torch.device("cpu"))
    metrics = {"packed_to_master_file_ratio": info["file_bytes"] / master.stat().st_size,
               "max_logit_error": max_error, "max_abs_bpb_delta": bpb_delta,
               "code_roundtrip_exact": float(equal_codes), "packed_file_bytes": info["file_bytes"],
               "master_file_bytes": master.stat().st_size, "tensor_payload_bytes": info["tensor_payload_bytes"],
               "fakequant_tokens_s": throughput["fakequant"], "packed_tokens_s": throughput["packed_unfused"],
               "export_load_s": encoding_s}
    row = {"model": args.model, "seed": args.seed, "params": model.num_params(), "params_active": model.active_params(),
           "train_seconds": 0.0, "training_tokens": 0, "fixture": "untrained serialization audit",
           "measurement_seconds": time.perf_counter() - t0, "metrics": metrics, "kernels": kernels,
           "hardware": {"machine": platform.machine(), "cpus": os.cpu_count(), "threads": setup["threads"],
                        "torch": torch.__version__, "cuda": torch.cuda.is_available(), "mps": torch.backends.mps.is_available()},
           "dataset": {"source": corpus.source, "sha256": corpus.sha256, "evaluated_bytes": segs[:, 1:].numel()},
           "prereg_sha256": file_hash(Path(args.prereg)),
           "code_sha": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip(),
           "checkpoint_sha256": file_hash(master), "packed_sha256": file_hash(exported),
           "peak_process_rss_mib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024,
           "rss_scope": "whole audit including two models; not inference-only or tablet memory",
           "cost_usd": 0.0, "ipad_result": None, "learned_quality_result": None}
    (out / f"{args.model}-seed{args.seed}.json").write_text(json.dumps(row, indent=2) + "\n")
    print(json.dumps({"seed": args.seed, "metrics": metrics}), flush=True)


def report(prereg: dict, out: Path) -> None:
    runs = sorted((json.loads(p.read_text()) for p in out.glob("*-seed*.json")), key=lambda r: (r["model"], r["seed"]))
    table = {}
    for model in prereg["setup"]["models"]:
        rs = [r for r in runs if r["model"] == model]
        if not rs:
            continue
        if len({r["seed"] for r in rs}) != len(rs):
            raise ValueError("duplicate seed")
        if {r["prereg_sha256"] for r in rs} != {file_hash(Path(ARGS.prereg))}:
            raise ValueError("pre-registration differs from measured runs")
        if len({r["code_sha"] for r in rs}) != 1:
            raise ValueError("code changed between seeds")
        table[model] = {"seeds": [r["seed"] for r in rs],
                        "metrics": {k: stats.summary([r["metrics"][k] for r in rs]) for k in rs[0]["metrics"]}}
    missing = gate.missing_seeds(table, prereg["setup"])
    decision = {"complete": False, "missing": missing} if missing else gate.decide(table, prereg["setup"]["gate"])
    summary = {"experiment": prereg["id"], "scope": "CPU serialization/reference kernels, untrained fixtures",
               "table": table, "decision": decision, "runs": runs,
               "cost_usd": 0.0, "ipad_measurements": None, "learned_quality_measurements": None}
    (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    lines = [f"# {prereg['id']}: {decision.get('result', 'INCOMPLETE')} (CPU format gate only)", "",
             "Three untrained native C fixtures. No pretraining, learned-quality, iPad, joule or fused-kernel claim.", "",
             "| Metric | Mean | Sample SD | 95% Student-t CI |", "|---|---:|---:|---|"]
    for model, row in table.items():
        for name, s in row["metrics"].items():
            lines.append(f"| {model}:{name} | {s['mean']:.8g} | {s['sd']:.8g} | [{s['ci95'][0]:.8g}, {s['ci95'][1]:.8g}] |")
    lines += ["", "Checks: `" + json.dumps(decision) + "`.", "",
              "The packed reference expands each projection into a dense tensor during execution. File bytes are physical; runtime savings require a fused backend.",
              "The RSS measurement includes both models and all audit work. Checkpoints remain artifacts; SHA-256 hashes are in the seed records."]
    (out / "report.md").write_text("\n".join(lines) + "\n")
    print(json.dumps(decision))


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--prereg", required=True)
    sub = p.add_subparsers(dest="command", required=True)
    train = sub.add_parser("train")
    train.add_argument("--model", required=True)
    train.add_argument("--seed", required=True, type=int)
    train.add_argument("--out", required=True)
    for opt in ("--steps", "--threads", "--budget-min", "--eval-every", "--ckpt-every"):
        train.add_argument(opt)  # existing workflow interface; setup fixes the audit dimensions
    rep = sub.add_parser("report")
    rep.add_argument("--out", required=True)
    ARGS = p.parse_args()
    prereg = json.loads(Path(ARGS.prereg).read_text())
    if ARGS.command == "train":
        run(prereg, ARGS)
    else:
        report(prereg, Path(ARGS.out))
