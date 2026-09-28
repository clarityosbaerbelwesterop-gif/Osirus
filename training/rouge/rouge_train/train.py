"""The LoRA / QLoRA training loop, with exact checkpoint and resume.

A step is `grad_accum` micro-batches followed by one optimizer update. The
data order is a seeded shuffle per epoch, so a resumed run continues on the
very micro-batch where it stopped: an interrupted-and-resumed run and an
uninterrupted run with the same config produce the same adapter (the CI
smoke run checks this).

Checkpoint layout (output_dir/checkpoints/step-NNNNNN/):
    adapter/            PEFT adapter (safetensors) + adapter_config.json
    optimizer.pt        optimizer state
    scheduler.pt        LR scheduler state
    rng.pt              Python, torch (and CUDA) RNG states
    state.json          step, epoch, micro-batch cursor, losses so far
"""

from __future__ import annotations

import json
import math
import platform
import random
import shutil
import subprocess
import sys
import time
from pathlib import Path

import torch

from . import data as data_module
from .config import RunConfig
from .hashing import hash_tree
from .modeling import attach_lora, causal_lm_loss, load_base, trainable_parameters
from .seeds import seed_everything


def _tokenizer(config: RunConfig):
    from transformers import AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(config.tokenizer_path)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    return tokenizer


def _optimizer(model, config: RunConfig):
    params = [p for p in model.parameters() if p.requires_grad]
    if config.optimizer == "paged_adamw_8bit":
        import bitsandbytes as bnb

        return bnb.optim.PagedAdamW8bit(
            params, lr=config.learning_rate, weight_decay=config.weight_decay
        )
    return torch.optim.AdamW(params, lr=config.learning_rate, weight_decay=config.weight_decay)


def _scheduler(optimizer, total_steps: int, warmup_ratio: float):
    warmup = max(1, int(total_steps * warmup_ratio))

    def factor(step: int) -> float:
        if step < warmup:
            return (step + 1) / warmup
        progress = (step - warmup) / max(1, total_steps - warmup)
        return 0.5 * (1.0 + math.cos(math.pi * min(1.0, progress)))

    return torch.optim.lr_scheduler.LambdaLR(optimizer, factor)


def _latest_checkpoint(output: Path) -> Path | None:
    checkpoints = sorted((output / "checkpoints").glob("step-*"))
    return checkpoints[-1] if checkpoints else None


def _rng_state() -> dict:
    state = {"python": random.getstate(), "torch": torch.get_rng_state()}
    if torch.cuda.is_available():
        state["cuda"] = torch.cuda.get_rng_state_all()
    return state


def _set_rng_state(state: dict) -> None:
    random.setstate(state["python"])
    torch.set_rng_state(state["torch"])
    if "cuda" in state and torch.cuda.is_available():
        torch.cuda.set_rng_state_all(state["cuda"])


def environment() -> dict:
    """What produced the run: code commit, library versions, hardware."""
    def run(*args):
        try:
            return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL).strip()
        except (OSError, subprocess.CalledProcessError):
            return None

    freeze = run(sys.executable, "-m", "pip", "freeze") or ""
    import hashlib

    versions = {}
    for name in ("torch", "transformers", "peft", "bitsandbytes", "accelerate"):
        try:
            versions[name] = __import__(name).__version__
        except ImportError:
            pass
    return {
        "code_commit": run("git", "rev-parse", "HEAD"),
        "python": platform.python_version(),
        "libraries": versions,
        "environment_lock_sha256": hashlib.sha256(freeze.encode()).hexdigest(),
        "hardware": (
            f"{torch.cuda.device_count()} x {torch.cuda.get_device_name(0)}"
            if torch.cuda.is_available()
            else f"cpu ({platform.machine()})"
        ),
    }


def train(config: RunConfig) -> dict:
    output = Path(config.output_dir)
    output.mkdir(parents=True, exist_ok=True)
    seed_everything(config.seed)
    tokenizer = _tokenizer(config)
    examples, stats = data_module.load_examples(config.train_file, tokenizer, config.max_seq_len)
    if not examples:
        raise ValueError("no usable training examples")

    model = load_base(config, for_training=True)
    model, targets = attach_lora(model, config)
    trainable, total = trainable_parameters(model)
    device = next(p for p in model.parameters() if p.requires_grad).device

    batches_per_epoch = math.ceil(len(examples) / config.micro_batch_size)
    steps_per_epoch = math.ceil(batches_per_epoch / config.grad_accum)
    total_steps = config.max_steps or steps_per_epoch * config.epochs
    optimizer = _optimizer(model, config)
    scheduler = _scheduler(optimizer, total_steps, config.warmup_ratio)

    state = {"step": 0, "epoch": 0, "cursor": 0, "losses": [], "tokens": 0}
    resumed_from = None
    latest = _latest_checkpoint(output)
    if latest:
        from peft import set_peft_model_state_dict
        from safetensors.torch import load_file

        set_peft_model_state_dict(
            model, load_file(str(latest / "adapter" / "adapter_model.safetensors"))
        )
        optimizer.load_state_dict(torch.load(latest / "optimizer.pt", weights_only=False))
        scheduler.load_state_dict(torch.load(latest / "scheduler.pt", weights_only=False))
        _set_rng_state(torch.load(latest / "rng.pt", weights_only=False))
        state = json.loads((latest / "state.json").read_text())
        resumed_from = latest.name

    log = (output / "metrics.jsonl").open("a")
    model.train()
    steps_this_process = 0
    started = time.time()
    while state["step"] < total_steps:
        order = data_module.epoch_order(len(examples), config.seed, state["epoch"])
        micro = [
            [examples[i] for i in order[b : b + config.micro_batch_size]]
            for b in range(0, len(order), config.micro_batch_size)
        ]
        while state["cursor"] < len(micro) and state["step"] < total_steps:
            window = micro[state["cursor"] : state["cursor"] + config.grad_accum]
            labelled = sum(
                sum(1 for label in example.labels[1:] if label != -100)
                for batch in window
                for example in batch
            )
            step_loss = 0.0
            for batch in window:
                ids, labels, mask = data_module.collate(batch, tokenizer.pad_token_id)
                ids, labels, mask = ids.to(device), labels.to(device), mask.to(device)
                loss, count = causal_lm_loss(model, ids, labels, mask, config.loss_chunk_tokens)
                # Weight each micro-batch by its share of labelled tokens, so
                # the step's gradient is the mean over all of them.
                (loss * (count / max(1, labelled))).backward()
                step_loss += loss.item() * count / max(1, labelled)
                state["tokens"] += int(mask.sum())
            grad_norm = torch.nn.utils.clip_grad_norm_(
                [p for p in model.parameters() if p.requires_grad], config.max_grad_norm
            )
            optimizer.step()
            scheduler.step()
            optimizer.zero_grad(set_to_none=True)
            state["cursor"] += len(window)
            state["step"] += 1
            state["losses"].append(round(step_loss, 6))
            steps_this_process += 1
            if state["step"] % config.log_every == 0 or state["step"] == total_steps:
                log.write(
                    json.dumps(
                        {
                            "step": state["step"],
                            "loss": step_loss,
                            "lr": scheduler.get_last_lr()[0],
                            "grad_norm": float(grad_norm),
                            "tokens": state["tokens"],
                            "elapsed_s": round(time.time() - started, 2),
                        }
                    )
                    + "\n"
                )
                log.flush()
            last = state["step"] == total_steps
            stopping = config.stop_after is not None and steps_this_process >= config.stop_after
            if state["step"] % config.save_every == 0 or last or stopping:
                _save_checkpoint(model, optimizer, scheduler, state, output, config.keep_checkpoints)
            if stopping and not last:
                log.close()
                return {"status": "stopped", "step": state["step"], "resumed_from": resumed_from}
        if state["cursor"] >= len(micro):
            state["epoch"] += 1
            state["cursor"] = 0
    log.close()

    final = output / "adapter"
    if final.exists():
        shutil.rmtree(final)
    model.save_pretrained(final, safe_serialization=True)
    report = {
        "status": "completed",
        "name": config.name,
        "resumed_from": resumed_from,
        "steps": state["step"],
        "epochs_seen": state["epoch"] + (1 if state["cursor"] else 0),
        "first_loss": state["losses"][0],
        "final_loss": state["losses"][-1],
        "losses": state["losses"],
        "tokens": state["tokens"],
        "trainable_parameters": trainable,
        "total_parameters": total,
        "lora_targets": len(targets),
        "data": stats.__dict__,
        "adapter_files": hash_tree(final),
        "environment": environment(),
        "config": config.to_dict(),
    }
    (output / "train-report.json").write_text(json.dumps(report, indent=1))
    return report


def _save_checkpoint(model, optimizer, scheduler, state, output: Path, keep: int) -> None:
    path = output / "checkpoints" / f"step-{state['step']:06d}"
    tmp = path.with_name(path.name + ".tmp")
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)
    model.save_pretrained(tmp / "adapter", safe_serialization=True)
    torch.save(optimizer.state_dict(), tmp / "optimizer.pt")
    torch.save(scheduler.state_dict(), tmp / "scheduler.pt")
    torch.save(_rng_state(), tmp / "rng.pt")
    (tmp / "state.json").write_text(json.dumps(state))
    if path.exists():
        shutil.rmtree(path)
    tmp.rename(path)  # a checkpoint is either complete or absent
    for old in sorted((output / "checkpoints").glob("step-*"))[:-keep]:
        shutil.rmtree(old)
