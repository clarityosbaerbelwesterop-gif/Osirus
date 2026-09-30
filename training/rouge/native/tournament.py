"""Run a level of the Architecture v1 tournament on one machine (all its GPUs, or the CPU).

    python -m native.tournament run --tournament configs/native/tournament-v1.json --level B \
        --data DATA --out OUT [--finalists A,B,D] [--r1-29b pass|fail] [--only A:1,B:1]

Every (candidate, seed) is one `native.train` process; a queue hands them to
the GPUs one at a time (CUDA_VISIBLE_DEVICES). A run that stops with exit 75
resumes from its checkpoint; a finished run (result.json) is never rerun.
Each finished run appends one record to OUT/runs.jsonl and prints it as
`ROUGE_RUN {json}` (the Lightning launcher collects these lines from the log).

Smoke tests shrink the tournament with --size-override and --tokens.
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PEAK_TFLOPS = {"L4": 121, "T4": 65, "A10G": 125, "L40S": 362, "A100": 312, "H100": 989, "H200": 989}


def peak_tflops() -> float:
    try:
        import torch

        if not torch.cuda.is_available():
            return 0.0
        name = torch.cuda.get_device_name()
        return next((v for k, v in PEAK_TFLOPS.items() if k in name), 0.0)
    except Exception:
        return 0.0


def gpu_count() -> int:
    try:
        import torch

        return torch.cuda.device_count()
    except Exception:
        return 0


def candidate_config(t: dict, level: str, cand: str, r1_29b: str, size_override: dict) -> dict:
    size = t["levels"][level]["size"]
    c = t["candidates"][cand]
    arch = c["if_r1_29b_fails"] if (r1_29b == "fail" and "if_r1_29b_fails" in c) else c["config"]
    return {"name": f"tournament-v1-{level}-{cand}", **t["sizes"][size], **arch, **size_override}


def jobs_for(t: dict, level: str, finalists: list[str] | None, only: list[str] | None) -> list[tuple[str, int]]:
    spec = t["levels"][level]
    cands = spec["candidates"] if spec["candidates"] != "finalists" else finalists
    if not cands:
        raise SystemExit(f"level {level} needs --finalists")
    jobs = [(c, s) for s in spec["seeds"] for c in cands]
    if only:
        jobs = [j for j in jobs if f"{j[0]}:{j[1]}" in only]
    return jobs


def train_args(t: dict, level: str, tokens: float | None) -> dict:
    size = t["levels"][level]["size"]
    tr = {**t["training"]["common"], **t["training"][size]}
    if tokens:
        tr["tokens"] = tokens
    tr["steps"] = max(1, int(tr["tokens"] // (tr["batch"] * tr["accum"] * tr["seq"])))
    tr["warmup"] = min(tr["warmup"], max(1, tr["steps"] // 10))
    return tr


def run_one(args, t, cand: str, seed: int, device: str | None, lock: threading.Lock) -> dict | None:
    level = args.level
    run_dir = Path(args.out) / f"{level}-{cand}-seed{seed}"
    run_dir.mkdir(parents=True, exist_ok=True)
    result_path = run_dir / "result.json"
    if not result_path.exists():
        cfg = candidate_config(t, level, cand, args.r1_29b, json.loads(args.size_override or "{}"))
        (run_dir / "config.json").write_text(json.dumps(cfg, indent=1))
        tr = train_args(t, level, args.tokens)
        cmd = [sys.executable, "-m", "native.train", "--config", str(run_dir / "config.json"), "--data", args.data,
               "--out", str(run_dir), "--steps", str(tr["steps"]), "--batch", str(tr["batch"]), "--accum", str(tr["accum"]),
               "--seq", str(tr["seq"]), "--lr", str(tr["lr"]), "--warmup", str(tr["warmup"]), "--schedule", tr["schedule"],
               "--decay-frac", str(tr["decay_frac"]), "--min-lr-frac", str(tr["min_lr_frac"]),
               "--weight-decay", str(tr["weight_decay"]), "--clip", str(tr["clip"]), "--seed", str(seed),
               "--eval-every", "0", "--ckpt-every", str(max(100, tr["steps"] // 5)), "--final-eval", tr["final_eval"]]
        peak = peak_tflops()
        if peak:
            cmd += ["--peak-tflops", str(peak)]
        env = dict(os.environ)
        if device is not None:
            env["CUDA_VISIBLE_DEVICES"] = device
        for attempt in range(1, 6):
            with open(run_dir / "train.log", "a") as log:
                code = subprocess.call(cmd, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
            with lock:
                print(f"[tournament] {level} {cand} seed {seed} on {device or 'cpu'}: exit {code} (attempt {attempt})", flush=True)
            if code == 0 or code != 75:
                break
        if not result_path.exists():
            with lock:
                tail = (run_dir / "train.log").read_text()[-2000:]
                print(f"[tournament] {level} {cand} seed {seed} FAILED:\n{tail}", flush=True)
            record = {"level": level, "candidate": cand, "seed": seed, "size": t["levels"][level]["size"], "failed": True}
            with lock, open(Path(args.out) / "runs.jsonl", "a") as f:
                f.write(json.dumps(record) + "\n")
            print("ROUGE_RUN " + json.dumps(record), flush=True)
            return record
    result = json.loads(result_path.read_text())
    record = {"level": level, "candidate": cand, "seed": seed, "size": t["levels"][level]["size"],
              "r1_29b": args.r1_29b, **result}
    with lock:
        with open(Path(args.out) / "runs.jsonl", "a") as f:
            f.write(json.dumps(record) + "\n")
        print("ROUGE_RUN " + json.dumps(record), flush=True)
    return record


def run(args) -> None:
    t = json.loads(Path(args.tournament).read_text())
    Path(args.out).mkdir(parents=True, exist_ok=True)
    jobs = jobs_for(t, args.level, args.finalists.split(",") if args.finalists else None,
                    args.only.split(",") if args.only else None)
    n_gpu = gpu_count()
    devices = [str(i) for i in range(n_gpu)] or [None]
    print(f"[tournament] level {args.level}: {len(jobs)} runs on {n_gpu or 'no'} GPU(s); r1_29b={args.r1_29b}", flush=True)
    work: queue.Queue = queue.Queue()
    for j in jobs:
        work.put(j)
    lock = threading.Lock()

    def worker(device):
        while True:
            try:
                cand, seed = work.get_nowait()
            except queue.Empty:
                return
            run_one(args, t, cand, seed, device, lock)

    start = time.time()
    threads = [threading.Thread(target=worker, args=(d,)) for d in devices]
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    print(f"[tournament] level {args.level} done in {(time.time() - start) / 60:.1f} min", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--tournament", required=True)
    r.add_argument("--level", choices=["B", "C"], required=True)
    r.add_argument("--data", required=True)
    r.add_argument("--out", required=True)
    r.add_argument("--finalists", help="comma-separated candidates for level C")
    r.add_argument("--only", help="comma-separated candidate:seed subset")
    r.add_argument("--r1-29b", choices=["pass", "fail"], required=True,
                   help="R1.29b outcome: candidate C uses ternary weights on pass, the int8 control on fail")
    r.add_argument("--tokens", type=float, help="override the token budget (smoke tests)")
    r.add_argument("--size-override", help="JSON merged into the size (smoke tests)")
    args = parser.parse_args()
    run(args)


if __name__ == "__main__":
    main()
