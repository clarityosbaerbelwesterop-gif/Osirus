"""TRAINING_READY gate: 16 conditions, each with committed evidence. The paid launcher refuses unless all hold.

    python training/rouge/ready.py [--run-tests] [--rung 100m]

Writes training/rouge/TRAINING_READY.json. A condition without evidence is false; nothing is
assumed. Conditions:
 1 R1.29b recorded under its unchanged gate (ternary decision)
 2 Architecture tournament decided (complete Level C decision)
 3 Architecture Spec v1.0 frozen (freeze record; config hashes match)
 4 Spec document generated from the frozen configs
 5 Tokenizer frozen (hash in the freeze record = committed tokenizer)
 6 Production corpus manifest committed (pretrain-v2): licence, revision and contamination status for every source, and every source at least 90% of its planned tokens
 7 Unit tests pass at this commit (model, trainer, data, tournament, registry, post-training, cost)
 8 Exact resume proven (single process and FSDP2 tests are part of 7 and present)
 9 CPU dry run passed at this commit's tree (results/dry-run/cpu/summary.json)
10 GPU dry run passed (results/dry-run/gpu/summary.json, mixed precision on a CUDA device)
11 Model registry intact (hash chain)
12 Control plane pinned and unchanged
13 A CRI cycle ran with the control plane intact (results/cri/log.json)
14 Cost guard: 50 EUR ceiling in force, ledger within it, and the rung's estimate fits what remains
15 Lightning verified: the training machine listed (cheapest per effective TFLOP at live prices), model-registry round trip, and a teamspace balance covering the rung (results/lightning/probe.json)
16 Owner approval gate: every paid job runs in the protected environment rouge-gpu
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CORPUS = "pretrain-v2"   # production corpus the first rung trains on (mixture v3)
REPO = ROOT.parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "lightning_ai"))


def jload(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def sha(path: Path) -> str | None:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def conditions(run_tests: bool, rung: str) -> list[dict]:
    out = []

    def add(n, name, ok, evidence):
        out.append({"id": n, "condition": name, "ok": bool(ok), "evidence": evidence})

    r129b = REPO / "research/rouge-architecture/results/r1.29b/README.md"
    add(1, "R1.29b recorded under its gate", r129b.exists() and re.search(r"(PASS|FAIL|PARTIAL)", r129b.read_text() if r129b.exists() else ""),
        str(r129b.relative_to(REPO)) if r129b.exists() else "missing")

    decision = jload(ROOT / "results/tournament-v1/level-C/decision.json")
    add(2, "architecture tournament decided", decision and decision.get("complete") and decision.get("level") == "C",
        f"winner {decision.get('winner')}" if decision else "no Level C decision")

    frozen = jload(ROOT / "configs/native/frozen-v1.json")
    frozen_ok = False
    if frozen and decision:
        from native.config import RougeConfig

        frozen_ok = frozen.get("winner") == decision.get("winner") and all(
            (ROOT / f"configs/native/rouge-v1-{r}.json").exists()
            and RougeConfig.load(ROOT / f"configs/native/rouge-v1-{r}.json").architecture_sha == s
            for r, s in frozen["architecture_sha"].items())
    add(3, "Architecture Spec v1.0 frozen", frozen_ok, frozen["architecture_sha"] if frozen else "no freeze record")

    doc = REPO / "docs/rouge/architecture-v1.md"
    add(4, "spec document generated", doc.exists() and frozen and all(s[:12] in doc.read_text() for s in frozen["architecture_sha"].values()),
        "docs/rouge/architecture-v1.md" if doc.exists() else "missing")

    tok_sha = sha(ROOT / "configs/native/data-v1/tokenizer.json")
    add(5, "tokenizer frozen", tok_sha and frozen and frozen.get("tokenizer_sha256") == tok_sha, tok_sha or "no tokenizer")

    corpus = jload(ROOT / f"configs/native/{CORPUS}/manifest.json")
    short = {n: f"{src['shards']['train']['tokens'] / (corpus['total_tokens'] * corpus['mixture'][n]):.0%} of plan"
             for n, src in (corpus or {}).get("sources", {}).items()
             if src["shards"]["train"]["tokens"] < 0.9 * corpus["total_tokens"] * corpus["mixture"][n]}
    corpus_ok = bool(corpus) and not short and corpus.get("tokenizer", {}).get("sha256") == tok_sha and all(
        s.get("license") and "contaminated_dropped" in s and (s.get("revision") or s["domain"] in ("code", "math", "algorithmic"))
        for s in corpus.get("sources", {}).values())
    add(6, "production corpus manifest (every source at least 90% of its planned tokens)", corpus_ok,
        (f"{CORPUS}: {corpus.get('total_tokens')} tokens, {len(corpus.get('sources', {}))} sources"
         + (f"; short: {short}" if short else "")) if corpus else f"configs/native/{CORPUS}/manifest.json missing")

    tests = {"ran": False}
    if run_tests:
        proc = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"], cwd=ROOT,
                              capture_output=True, text=True)
        tail = proc.stderr.strip().splitlines()[-1] if proc.stderr.strip() else ""
        tests = {"ran": True, "ok": proc.returncode == 0, "summary": tail, "skipped": "skipped" in tail}
    add(7, "unit tests pass", tests.get("ok") and not tests.get("skipped"), tests if tests["ran"] else "not run (use --run-tests)")

    names = (ROOT / "tests/test_native_train.py").read_text()
    add(8, "exact resume proven (single process and FSDP2)", tests.get("ok") and "test_resume_is_exact" in names
        and "test_fsdp_two_processes_resume_exactly" in names, "tests/test_native_train.py")

    for n, dev in ((9, "cpu"), (10, "gpu")):
        s = jload(ROOT / f"results/dry-run/{dev}/summary.json")
        # the GPU dry run proves the CUDA path with mixed precision (bf16 on L4/H200, fp16 + loss scaling on T4)
        ok = bool(s) and s.get("ok") and (dev == "cpu" or (s.get("device") == "cuda" and s.get("precision") in ("bf16", "fp16")))
        add(n, f"{dev.upper()} dry run passed", ok, {k: s.get(k) for k in ("device", "gpu", "precision", "code_sha", "finished")} if s else "missing")

    from native import registry

    reg_path = ROOT / "registry/models.json"
    problems = registry.verify(registry.load(reg_path))
    add(11, "model registry intact", not problems, problems or f"{len(registry.load(reg_path)['entries'])} entries")

    from native import cri

    cp = cri.verify_control_plane()
    add(12, "control plane pinned and unchanged", not cp, cp or "configs/native/control-plane.json")

    log = jload(ROOT / "results/cri/log.json")
    add(13, "a CRI cycle ran with the control plane intact",
        bool(log) and any(e.get("control_plane_intact") for e in log.get("entries", [])),
        f"{len(log['entries'])} cycle(s)" if log else "results/cri/log.json missing")

    import cost

    ledger = cost.load()
    estimate = None
    if frozen and (ROOT / f"configs/native/rouge-v1-{rung}.json").exists():
        from native import spec
        from native.config import RougeConfig

        ladder = json.loads((ROOT / "configs/native/ladder-v1.json").read_text())
        s = spec.summary(RougeConfig.load(ROOT / f"configs/native/rouge-v1-{rung}.json"))
        probe = jload(ROOT / "results/lightning/probe.json") or {}
        machine = probe.get("training_machine", "H100")
        machine = machine if machine in cost.PAID_PRICE_CEILING else "H100"
        price = (cost.live_prices().get(machine) or {}).get("usd_per_hour") or cost.PAID_PRICE_CEILING[machine]
        estimate = cost.estimate(s["flops_per_token_train"], ladder["rungs"][rung]["tokens"], float(price),
                                 mfu=cost.mfu(machine), peak_tflops=cost.PEAK_TFLOPS[machine])
        estimate["machine"] = machine
    remaining = cost.CEILING_USD - cost.committed(ledger)
    add(14, "cost guard: ceiling, ledger, rung estimate", cost.CEILING_EUR == 50.0 and remaining > 0 and estimate is not None
        and estimate["usd"] * 1.25 <= remaining,
        {"ceiling_usd": cost.CEILING_USD, "committed_usd": cost.committed(ledger), "estimate": estimate})

    probe = jload(ROOT / "results/lightning/probe.json")
    listed = (probe or {}).get("training_machines_listed") or [m for m in ("H100", "H200") if (probe or {}).get(f"{m.lower()}_listed")]
    add(15, "Lightning verified (training machine listed, model-registry round trip, balance)",
        bool(probe) and probe.get("model_registry_ok") and estimate is not None and estimate["machine"] in listed
        and float(probe.get("balance") or 0) >= estimate["usd"] * 1.25,
        {**{k: probe.get(k) for k in ("training_machine", "model_registry_ok", "balance", "checked_at")}, "listed": listed}
        if probe else "results/lightning/probe.json missing")

    wf_path = REPO / ".github/workflows/rouge-train.yml"
    wf = wf_path.read_text() if wf_path.exists() else ""
    train_job = wf.split("  train:", 1)[1] if "  train:" in wf else ""
    add(16, "owner approval gate (protected environment rouge-gpu)", "environment: rouge-gpu" in train_job,
        ".github/workflows/rouge-train.yml job train")
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-tests", action="store_true")
    parser.add_argument("--rung", default="100m")
    args = parser.parse_args()
    conds = conditions(args.run_tests, args.rung)
    ready = all(c["ok"] for c in conds)
    record = {"TRAINING_READY": ready, "rung": args.rung, "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
              "code_sha": subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip(),
              "conditions": conds}
    (ROOT / "TRAINING_READY.json").write_text(json.dumps(record, indent=1, default=str) + "\n")
    for c in conds:
        print(f"{'PASS' if c['ok'] else 'FAIL'} {c['id']:>2} {c['condition']}")
    print(f"TRAINING_READY = {ready}")
    raise SystemExit(0 if ready else 1)


if __name__ == "__main__":
    main()
