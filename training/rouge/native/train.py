"""Rouge native trainer: single device, DDP or FSDP2 (torchrun), resumable.

    python -m native.train --config configs/native/tiny.json --data DATA --out RUN --steps 2000
    torchrun --nproc-per-node 8 -m native.train ... [--fsdp]

Features:
- bf16 autocast on GPUs that support it (fp16 with a gradient scaler otherwise; fp32 on CPU);
- gradient accumulation, activation checkpointing (--grad-ckpt), optional torch.compile;
- AdamW (decay only on matrices), warmup-stable-decay or cosine schedule;
- loss-spike guard: a step whose loss exceeds 3x the running median after
  warmup is skipped (not applied); 20 consecutive spikes abort the run;
- checkpoints every --ckpt-every steps and at the time budget (--budget-min):
  the run then exits with code 75 and resumes exactly where it stopped
  (batches are a pure function of seed and step);
- JSONL telemetry: loss, learning rate, gradient norm, tokens/s, MFU
  (against --peak-tflops), memory, MoE load balance;
- evaluation hooks (native.evaluate) and a final result JSON.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import sys
import time
from contextlib import nullcontext
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from native import checkpoint, evaluate, spec  # noqa: E402
from native.config import RougeConfig  # noqa: E402
from native.data.loader import ShardSet  # noqa: E402
from native.model import MoE, RougeModel  # noqa: E402

EXIT_RESUME = 75


def native_bf16() -> bool:
    """bf16 only where tensor cores run it natively (compute capability >= 8.0: A100, L4, H100, H200).
    Older GPUs such as the T4 (7.5) report bf16 as supported but emulate it several times slower
    than fp16, so they train in fp16 with loss scaling."""
    return torch.cuda.is_available() and torch.cuda.get_device_capability()[0] >= 8


def lr_at(step: int, args) -> float:
    if step < args.warmup:
        return args.lr * (step + 1) / args.warmup
    if args.schedule == "cosine":
        p = (step - args.warmup) / max(1, args.steps - args.warmup)
        return args.lr * (args.min_lr_frac + (1 - args.min_lr_frac) * 0.5 * (1 + math.cos(math.pi * min(1.0, p))))
    decay_start = int(args.steps * (1 - args.decay_frac))                        # warmup-stable-decay
    if step < decay_start:
        return args.lr
    p = (step - decay_start) / max(1, args.steps - decay_start)
    return args.lr * (1 - (1 - args.min_lr_frac) * min(1.0, p))


def setup():
    if int(os.environ.get("WORLD_SIZE", "1")) > 1:
        backend = "nccl" if torch.cuda.is_available() else "gloo"
        torch.distributed.init_process_group(backend)
        rank, world = torch.distributed.get_rank(), torch.distributed.get_world_size()
        if torch.cuda.is_available():
            torch.cuda.set_device(int(os.environ.get("LOCAL_RANK", rank)))
        return rank, world
    return 0, 1


def build(args, device):
    cfg = RougeConfig.load(args.config)
    overrides = json.loads(args.override) if args.override else {}
    if overrides:
        cfg = cfg.replace(**overrides)
    torch.manual_seed(args.seed)
    model = RougeModel(cfg).to(device)
    model.gradient_checkpointing = args.grad_ckpt
    return cfg, model


def optimizer_for(model, args, device):
    decay = [p for n, p in model.named_parameters() if p.dim() >= 2]
    no_decay = [p for n, p in model.named_parameters() if p.dim() < 2]
    return torch.optim.AdamW([{"params": decay, "weight_decay": args.weight_decay}, {"params": no_decay, "weight_decay": 0.0}],
                             lr=args.lr, betas=(0.9, 0.95), eps=1e-8, fused=device.type == "cuda")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--config", required=True)
    p.add_argument("--override", default="")
    p.add_argument("--data", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--steps", type=int, required=True)
    p.add_argument("--batch", type=int, default=16, help="sequences per rank per micro-step")
    p.add_argument("--accum", type=int, default=1)
    p.add_argument("--seq", type=int, default=1024)
    p.add_argument("--lr", type=float, default=3e-3)
    p.add_argument("--min-lr-frac", type=float, default=0.1)
    p.add_argument("--warmup", type=int, default=200)
    p.add_argument("--schedule", choices=["wsd", "cosine"], default="wsd")
    p.add_argument("--decay-frac", type=float, default=0.2)
    p.add_argument("--weight-decay", type=float, default=0.1)
    p.add_argument("--clip", type=float, default=1.0)
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--eval-every", type=int, default=500)
    p.add_argument("--eval-windows", type=int, default=64)
    p.add_argument("--ckpt-every", type=int, default=1000)
    p.add_argument("--budget-min", type=float, default=0)
    p.add_argument("--grad-ckpt", action="store_true")
    p.add_argument("--compile", action="store_true")
    p.add_argument("--fsdp", action="store_true")
    p.add_argument("--peak-tflops", type=float, default=0, help="accelerator peak for MFU (0: not reported)")
    p.add_argument("--final-eval", default="full", choices=["full", "loss", "none"])
    p.add_argument("--stop-after", type=int, default=0, help="tests: checkpoint and exit 75 after this many steps")
    args = p.parse_args()

    rank, world = setup()
    device = torch.device(f"cuda:{torch.cuda.current_device()}" if torch.cuda.is_available() else "cpu")
    use_bf16 = device.type == "cuda" and native_bf16()
    amp_dtype = torch.bfloat16 if use_bf16 else torch.float16
    autocast = torch.autocast(device.type, dtype=amp_dtype) if device.type == "cuda" else nullcontext()
    scaler = torch.amp.GradScaler("cuda", enabled=device.type == "cuda" and not use_bf16)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    cfg, model = build(args, device)
    raw = model
    if args.fsdp and world > 1:
        from torch.distributed.fsdp import fully_shard

        for block in model.blocks:
            fully_shard(block)
        fully_shard(model)
    elif world > 1:
        model = torch.nn.parallel.DistributedDataParallel(model, find_unused_parameters=bool(cfg.moe_experts))
    if args.compile:
        model = torch.compile(model)
    opt = optimizer_for(raw, args, device)
    train = ShardSet(args.data, "train")
    val = ShardSet(args.data, "val")
    manifest = train.manifest
    data_sha = __import__("hashlib").sha256(json.dumps(manifest["sources"], sort_keys=True).encode()).hexdigest()
    s = spec.summary(cfg, args.seq)
    tokens_per_step = args.batch * args.accum * args.seq * world

    state = {"step": 0, "tokens": 0, "spikes": 0, "skipped": 0, "elapsed": 0.0, "losses": []}
    found = checkpoint.latest(out)
    if found:
        path, meta = found
        assert meta["architecture_sha"] == cfg.architecture_sha, "checkpoint belongs to another architecture"
        assert meta["data_sha"] == data_sha, "checkpoint was trained on another corpus"
        checkpoint.load(path, model, opt, meta)
        state.update(meta["state"])  # MoE balancing biases are buffers: restored with the model state
        if rank == 0:
            print(f"[train] resumed at step {state['step']} from {path.name}", flush=True)

    log = open(out / "telemetry.jsonl", "a") if rank == 0 else None
    deadline = time.time() + args.budget_min * 60 if args.budget_min else None
    start = time.time() - state["elapsed"]
    model.train()
    step = state["step"]
    t_last, tok_last = time.time(), state["tokens"]
    while step < args.steps:
        lr = lr_at(step, args)
        for group in opt.param_groups:
            group["lr"] = lr
        opt.zero_grad(set_to_none=True)
        total = 0.0
        for micro in range(args.accum):
            x, y = train.batch(args.seed, step * args.accum + micro, rank, args.batch, args.seq)
            x, y = x.to(device, non_blocking=True), y.to(device, non_blocking=True)
            ctx = model.no_sync() if (world > 1 and not args.fsdp and micro < args.accum - 1) else nullcontext()
            with ctx, autocast:
                loss = model(x, y) / args.accum
            scaler.scale(loss).backward()
            total += loss.item()
        if world > 1:
            t = torch.tensor([total], device=device)
            torch.distributed.all_reduce(t)
            total = t.item() / world
        recent = state["losses"][-200:]
        spike = step > args.warmup and len(recent) >= 20 and total > 3 * statistics.median(recent)
        scaler.unscale_(opt)
        gnorm = torch.nn.utils.clip_grad_norm_(raw.parameters(), args.clip).item()
        if spike or not math.isfinite(total) or not math.isfinite(gnorm):
            state["spikes"] += 1
            state["skipped"] += 1
            opt.zero_grad(set_to_none=True)
            scaler.update()
            if state["spikes"] >= 20:
                raise SystemExit("[train] 20 consecutive loss spikes: aborting (last good checkpoint kept)")
        else:
            state["spikes"] = 0
            scaler.step(opt)
            scaler.update()
            state["losses"] = (state["losses"] + [total])[-400:]
        step += 1
        state["step"], state["tokens"] = step, state["tokens"] + tokens_per_step

        if log and (step % 10 == 0 or step == args.steps):
            now = time.time()
            tps = (state["tokens"] - tok_last) / max(1e-9, now - t_last)
            t_last, tok_last = now, state["tokens"]
            moe = [m.load for m in raw.modules() if isinstance(m, MoE)]
            rec = {"step": step, "loss": round(total, 4), "lr": lr, "grad_norm": round(gnorm, 3), "tokens": state["tokens"],
                   "tokens_per_s": round(tps, 1), "elapsed_s": round(now - start, 1), "skipped": state["skipped"]}
            if args.peak_tflops:
                rec["mfu"] = round(tps * s["flops_per_token_train"] / (args.peak_tflops * 1e12 * world), 4)
            if device.type == "cuda":
                rec["mem_gb"] = round(torch.cuda.max_memory_allocated() / 2**30, 2)
            if moe:
                rec["moe_min_load"] = round(min(float(l.min()) for l in moe), 4)
            log.write(json.dumps(rec) + "\n")
            log.flush()
            if step % 100 == 0 or step == args.steps:
                print("[train]", json.dumps(rec), flush=True)
        if rank == 0 and args.eval_every and step % args.eval_every == 0 and step < args.steps:
            raw.eval()
            with autocast:
                ev = evaluate.val_losses(raw, val, args.seq, args.eval_windows, device)
            raw.train()
            log.write(json.dumps({"step": step, "eval": ev}) + "\n")
            log.flush()
            print("[eval]", step, json.dumps(ev), flush=True)
        stop = ((deadline is not None and time.time() > deadline) or (args.stop_after and step == args.stop_after)) and step < args.steps
        if (args.ckpt_every and step % args.ckpt_every == 0 and step < args.steps) or stop:
            state["elapsed"] = time.time() - start
            meta = {"architecture_sha": cfg.architecture_sha, "config": json.loads(cfg.to_json()), "data_sha": data_sha,
                    "state": state, "args": vars(args), "world": world}
            checkpoint.save(out, step, model, opt, meta, sharded=args.fsdp and world > 1)
            if stop:
                if rank == 0:
                    print(f"[train] time budget reached at step {step}: checkpoint saved, exit {EXIT_RESUME} to resume", flush=True)
                raise SystemExit(EXIT_RESUME)

    state["elapsed"] = time.time() - start
    meta = {"architecture_sha": cfg.architecture_sha, "config": json.loads(cfg.to_json()), "data_sha": data_sha,
            "state": state, "args": vars(args), "world": world}
    final = checkpoint.save(out, step, model, opt, meta, sharded=args.fsdp and world > 1)
    if args.fsdp and world > 1:
        # a sharded model cannot run on one rank: every rank joins the gather, rank 0 evaluates an unsharded copy
        from torch.distributed.checkpoint.state_dict import StateDictOptions, get_model_state_dict

        full = get_model_state_dict(model, options=StateDictOptions(full_state_dict=True, cpu_offload=True))
        if rank == 0:
            raw = RougeModel(cfg).to(device)
            raw.load_state_dict(full)
    if rank == 0:
        raw.eval()
        result = {"architecture_sha": cfg.architecture_sha, "config": json.loads(cfg.to_json()), "data_sha": data_sha,
                  "spec": s, "steps": step, "tokens": state["tokens"], "train_seconds": round(state["elapsed"], 1),
                  "skipped_steps": state["skipped"], "world": world, "device": str(device),
                  "gpu": torch.cuda.get_device_name() if device.type == "cuda" else "cpu",
                  "final_train_loss": statistics.mean(state["losses"][-50:]) if state["losses"] else None,
                  "checkpoint": final.name, "measured": {"params": raw.num_params(), "active_params": raw.active_params(),
                                                          "stored_bytes": raw.stored_bytes(), "kv_bytes_4k": raw.kv_bytes(4096),
                                                          "kv_bytes_128k": raw.kv_bytes(131072)}}
        if args.final_eval != "none":
            with autocast:
                result["eval"] = evaluate.full(raw, val, args.data, args.seq, device, tasks=args.final_eval == "full")
        (out / "result.json").write_text(json.dumps(result, indent=1))
        print("ROUGE_RESULT " + json.dumps(result), flush=True)
    if world > 1:
        torch.distributed.destroy_process_group()


if __name__ == "__main__":
    main()
