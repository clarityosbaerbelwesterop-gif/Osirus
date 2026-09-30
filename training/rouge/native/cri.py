"""Controlled recursive improvement (CRI) for native Rouge.

Loop: evaluate the champion -> find its weakest domain -> a structured hypothesis (proposal)
-> experiment at Level A (smoke), B (development, 1 seed), C (promotion, 3 seeds) -> blind
evaluation by an independent evaluator -> regression check -> promote or reject -> log.

What CRI may change (ALLOWLIST, with bounds): the data mixture, and training hyperparameters
(learning rate, warmup, schedule, decay fraction, weight decay, clip, batch, accumulation), and
the MoE balancing rate. Nothing else: the architecture is frozen (Architecture Spec v1.0),
and every file of the control plane is pinned by sha256 (configs/native/control-plane.json):
evaluation code and data rules, the selection rules, budget limits, approvals (workflows),
provenance (registry), promotion rules (this file) and rollback. A cycle refuses to start, and
a result is void, when any pinned file changed. A candidate never decides whether it passed:
decide() reads only the evaluator's metrics, never a run's self-reported numbers.

    python -m native.cri pin          # owner action: pin the control plane (commit the file)
    python -m native.cri verify
    python -m native.cri propose --champion RESULT.json
    python -m native.cri smoke        # one full Level-A cycle on CPU (dry run)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
PIN = ROOT / "configs/native/control-plane.json"
LOG = ROOT / "results/cri/log.json"

CONTROL_PLANE = [
    "training/rouge/native/evaluate.py", "training/rouge/native/pareto.py", "training/rouge/native/cri.py",
    "training/rouge/native/registry.py", "training/rouge/native/data/synth.py", "training/rouge/native/data/build.py",
    "training/rouge/native/data/verify.py", "training/rouge/configs/native/tournament-v1.json",
    "training/rouge/runpod/cost.py", "training/rouge/runpod/session.py", "training/rouge/lightning_ai/job.py",
    "training/rouge/ready.py", ".github/workflows/rouge-h200.yml", ".github/workflows/rouge-native.yml",
]

ALLOWLIST = {
    "training": {"lr": (1e-4, 1e-2), "warmup": (0, 20000), "decay_frac": (0.05, 0.5), "weight_decay": (0.0, 0.3),
                 "clip": (0.1, 5.0), "min_lr_frac": (0.0, 0.5), "batch": (1, 1024), "accum": (1, 256),
                 "schedule": ("wsd", "cosine")},
    "model": {"moe_bias_rate": (1e-4, 1e-2)},
    "mixture": (0.02, 0.8),                    # every source share within bounds, shares sum to 1
}

# promotion rule (Level C): mean over 3 seeds of the evaluator's numbers
PROMOTE_MARGIN_BPB = 0.01                      # challenger must improve val_bpb_mean by at least this much
MAX_DOMAIN_REGRESSION_BPB = 0.02               # and may not worsen any single domain by more
MAX_TASK_REGRESSION = 0.02                     # nor the task accuracy by more than 2 points


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else "missing"


def pin() -> dict:
    record = {"schema": "rouge.control-plane/1", "pinned_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
              "files": {f: sha256(REPO / f) for f in CONTROL_PLANE}}
    PIN.write_text(json.dumps(record, indent=1) + "\n")
    return record


def verify_control_plane() -> list[str]:
    if not PIN.exists():
        return ["control plane not pinned (configs/native/control-plane.json missing)"]
    pinned = json.loads(PIN.read_text())["files"]
    return [f"{f}: changed since pinned" for f in CONTROL_PLANE if pinned.get(f) != sha256(REPO / f)]


def validate(proposal: dict, sources: list[str]) -> list[str]:
    """Problems with a proposal; empty when every change is on the allowlist and within bounds."""
    problems = []
    for key in ("id", "weakness", "hypothesis", "change", "falsifier"):
        if key not in proposal:
            problems.append(f"missing {key}")
    change = proposal.get("change", {})
    for section, values in change.items():
        if section not in ALLOWLIST:
            problems.append(f"'{section}' is not changeable by CRI")
            continue
        if section == "mixture":
            lo, hi = ALLOWLIST["mixture"]
            if set(values) - set(sources):
                problems.append(f"unknown sources {sorted(set(values) - set(sources))}")
            if abs(sum(values.values()) - 1) > 1e-6:
                problems.append("mixture shares must sum to 1")
            problems += [f"mixture {k}={v} outside [{lo}, {hi}]" for k, v in values.items() if not lo <= v <= hi]
            continue
        for k, v in values.items():
            bound = ALLOWLIST[section].get(k)
            if bound is None:
                problems.append(f"{section}.{k} is not changeable by CRI")
            elif isinstance(bound[0], str):
                if v not in bound:
                    problems.append(f"{section}.{k}={v} not in {bound}")
            elif not bound[0] <= v <= bound[1]:
                problems.append(f"{section}.{k}={v} outside {bound}")
    return problems


def weakest_domain(evals: dict, reference: dict | None = None) -> str:
    """Domain with the largest bits-per-byte (relative to a reference model's, when given)."""
    val = evals["val"]
    score = {k: v["bpb"] / (reference["val"][k]["bpb"] if reference and k in reference.get("val", {}) else 1.0) for k, v in val.items()}
    return max(score, key=score.get)


def propose(champion: dict, mixture: dict, seed: int = 0) -> dict:
    """Default hypothesis: more data from the weakest domain (a data-mixture change, inside the allowlist)."""
    weak = weakest_domain(champion["eval"])
    if weak not in mixture:
        weak = max(mixture, key=lambda k: 0)
    new = dict(mixture)
    shift = min(0.05, 0.8 - new[weak])
    donors = sorted((k for k in new if k != weak), key=lambda k: -new[k])[:2]
    new[weak] += shift
    for d in donors:
        new[d] -= shift / len(donors)
    new = {k: round(v, 6) for k, v in new.items()}
    new[donors[0]] = round(1 - sum(v for k, v in new.items() if k != donors[0]), 6)
    return {"id": f"cri-{time.strftime('%Y%m%d%H%M%S', time.gmtime())}-{seed}", "weakness": weak,
            "hypothesis": f"{weak} has the highest bits per byte; raising its share by {shift:.2f} lowers it without "
                          f"worsening other domains by more than {MAX_DOMAIN_REGRESSION_BPB} BPB",
            "change": {"mixture": new}, "expected": f"{weak} BPB down, val_bpb_mean down by >= {PROMOTE_MARGIN_BPB}",
            "falsifier": f"val_bpb_mean does not improve by {PROMOTE_MARGIN_BPB} at Level C, or any domain regresses"}


def blind_labels(champion_runs: list[str], challenger_runs: list[str], seed: int) -> dict:
    """Shuffle runs under neutral labels for the evaluator; the mapping is revealed only to decide()."""
    runs = [("champion", r) for r in champion_runs] + [("challenger", r) for r in challenger_runs]
    random.Random(seed).shuffle(runs)
    return {f"X{i:02d}": {"role": role, "run": run} for i, (role, run) in enumerate(runs)}


def decide(metrics: dict, labels: dict, level: str) -> dict:
    """Promotion decision from the evaluator's metrics per blind label (never from the runs' own reports)."""
    by = {"champion": [], "challenger": []}
    for label, m in metrics.items():
        by[labels[label]["role"]].append(m)
    need = {"A": 1, "B": 1, "C": 3}[level]
    if any(len(v) < need for v in by.values()):
        return {"level": level, "decision": "void", "reason": f"needs {need} evaluated run(s) per side"}
    if any(m is None or m.get("val_bpb_mean") is None for v in by.values() for m in v):
        return {"level": level, "decision": "reject", "reason": "a run has no evaluation (diverged or failed)"}

    def mean(role, f):
        return statistics.mean(f(m) for m in by[role])

    q_ch, q_c = mean("champion", lambda m: m["val_bpb_mean"]), mean("challenger", lambda m: m["val_bpb_mean"])
    domains = sorted(by["champion"][0]["val"])
    worst = max(mean("challenger", lambda m, d=d: m["val"][d]["bpb"]) - mean("champion", lambda m, d=d: m["val"][d]["bpb"])
                for d in domains)
    tasks = lambda m: statistics.mean(m["tasks"].values()) if m.get("tasks") else 0.0
    task_drop = mean("champion", tasks) - mean("challenger", tasks)
    gain = q_ch - q_c
    out = {"level": level, "champion_bpb": round(q_ch, 4), "challenger_bpb": round(q_c, 4), "gain_bpb": round(gain, 4),
           "worst_domain_regression_bpb": round(worst, 4), "task_drop": round(task_drop, 4)}
    if level == "A":
        out["decision"] = "continue"                                   # smoke: it ran and was evaluated
    elif level == "B":
        out["decision"] = "continue" if gain > 0 and worst <= MAX_DOMAIN_REGRESSION_BPB else "reject"
    else:
        ok = gain >= PROMOTE_MARGIN_BPB and worst <= MAX_DOMAIN_REGRESSION_BPB and task_drop <= MAX_TASK_REGRESSION
        out["decision"] = "promote" if ok else "reject"
    return out


def log_cycle(record: dict, path: Path = LOG) -> dict:
    """Append to the hash-chained CRI log (same chaining as the model registry)."""
    log = json.loads(path.read_text()) if path.exists() else {"schema": "rouge.cri-log/1", "entries": []}
    prev = log["entries"][-1]["entry_hash"] if log["entries"] else "0" * 64
    entry = {**record, "logged": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "prev_hash": prev}
    entry["entry_hash"] = hashlib.sha256(json.dumps(entry, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    log["entries"].append(entry)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(log, indent=1) + "\n")
    return entry


def evaluate_blind(run_dirs: dict, data: str, seq: int) -> dict:
    """Independent evaluator: loads each labelled checkpoint (hash-verified) and measures it. Separate process."""
    out = subprocess.run([sys.executable, "-m", "native.cri", "_evaluate", "--runs", json.dumps(run_dirs), "--data", data,
                          "--seq", str(seq)], cwd=ROOT, capture_output=True, text=True, check=True)
    return json.loads(out.stdout.strip().splitlines()[-1])


def _evaluate(args) -> None:
    import torch

    from . import checkpoint, evaluate
    from .config import RougeConfig
    from .data.loader import ShardSet
    from .model import RougeModel

    val = ShardSet(args.data, "val", None)
    metrics = {}
    for label, run in json.loads(args.runs).items():
        found = checkpoint.latest(run)
        if found is None:
            metrics[label] = None
            continue
        path, meta = found
        model = RougeModel(RougeConfig(**meta["config"]))
        model.load_state_dict(torch.load(Path(path) / "model.pt", map_location="cpu", weights_only=True))
        model.eval()
        metrics[label] = evaluate.full(model, val, args.data, args.seq, torch.device("cpu"), tasks=True)
    print(json.dumps(metrics))


def smoke(args) -> dict:
    """One complete Level-A cycle on CPU with a tiny model and generated data (the dry-run evidence)."""
    problems = verify_control_plane()
    if problems:
        raise SystemExit("control plane changed: " + "; ".join(problems))
    tmp = Path(args.work or tempfile.mkdtemp())
    data = tmp / "data"
    if not (data / "manifest.json").exists():
        subprocess.run([sys.executable, "-m", "native.data.build", "--out", str(data), "--tokens", "3e5", "--vocab", "512",
                        "--only", "math_synth", "algo_synth"], cwd=ROOT, check=True, capture_output=True)
    cfg = tmp / "cfg.json"
    cfg.write_text(json.dumps({"name": "cri-smoke", "vocab_size": 512, "d_model": 32, "n_layers": 2, "n_heads": 2,
                               "n_kv_heads": 2, "max_seq": 64}))

    def train(out: Path, lr: float):
        subprocess.run([sys.executable, "-m", "native.train", "--config", str(cfg), "--data", str(data), "--out", str(out),
                        "--steps", "40", "--batch", "8", "--seq", "64", "--lr", str(lr), "--warmup", "4", "--eval-every", "0",
                        "--ckpt-every", "0", "--final-eval", "none"], cwd=ROOT, check=True, capture_output=True)

    train(tmp / "champion", 3e-3)
    proposal = {"id": "cri-smoke", "weakness": "algo_synth", "hypothesis": "a higher learning rate trains the tiny model faster",
                "change": {"training": {"lr": 6e-3}}, "expected": "lower loss", "falsifier": "no lower loss"}
    problems = validate(proposal, ["math_synth", "algo_synth"])
    if problems:
        raise SystemExit(f"proposal rejected: {problems}")
    train(tmp / "challenger", proposal["change"]["training"]["lr"])
    labels = blind_labels([str(tmp / "champion")], [str(tmp / "challenger")], seed=0)
    metrics = evaluate_blind({k: v["run"] for k, v in labels.items()}, str(data), 64)
    for m in metrics.values():                                            # smoke data has no web domains
        if m is not None and m.get("val_bpb_mean") is None:
            m["val_bpb_mean"] = statistics.mean(v["bpb"] for v in m["val"].values())
    decision = decide(metrics, labels, "A")
    record = {"proposal": proposal, "labels": labels, "metrics": metrics, "decision": decision,
              "control_plane_intact": not verify_control_plane()}
    if args.log:
        log_cycle({"kind": "smoke", **{k: record[k] for k in ("proposal", "decision", "control_plane_intact")}})
    print(json.dumps({"decision": decision, "control_plane_intact": record["control_plane_intact"]}))
    return record


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("pin")
    sub.add_parser("verify")
    p = sub.add_parser("propose")
    p.add_argument("--champion", required=True)
    p.add_argument("--mixture", default=str(ROOT / "configs/native/data-v1/manifest.json"))
    s = sub.add_parser("smoke")
    s.add_argument("--work")
    s.add_argument("--log", action="store_true")
    e = sub.add_parser("_evaluate")
    e.add_argument("--runs", required=True)
    e.add_argument("--data", required=True)
    e.add_argument("--seq", type=int, required=True)
    args = parser.parse_args()
    if args.cmd == "pin":
        print(json.dumps(pin(), indent=1))
    elif args.cmd == "verify":
        problems = verify_control_plane()
        print("control plane intact" if not problems else "\n".join(problems))
        raise SystemExit(1 if problems else 0)
    elif args.cmd == "propose":
        champion = json.loads(Path(args.champion).read_text())
        mixture = json.loads(Path(args.mixture).read_text())["mixture"]
        print(json.dumps(propose(champion, mixture), indent=1))
    elif args.cmd == "smoke":
        smoke(args)
    else:
        _evaluate(args)


if __name__ == "__main__":
    main()
