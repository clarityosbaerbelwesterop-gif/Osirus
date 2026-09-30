"""Full-parameter training of the pinned base on several GPUs (FSDP2), with exact resume.

Every language-model weight is trained; the vision tower stays frozen. One
process per GPU:

    torchrun --nproc-per-node 8 -m rouge_train.cli train --config configs/full-001.json

(`"mode": "full"` in the run config). One process without torchrun works too
(tests, CPU).

Memory. Master weights, gradients and AdamW moments are fp32 and sharded
across ranks (FSDP2); compute runs in bf16 with fp32 gradient reduction. A
27B base needs about 16 bytes per parameter (~440 GB) plus activations, so
8 x H200 (1128 GB) holds it with room for 8k-token sequences.

Loading. Only rank 0 reads the base from disk. Every rank builds the model on
the meta device, shards it, and receives its shard from rank 0; buffers that
are not in the state dict (rotary tables) are broadcast too. Host memory
stays at one copy of the base, whatever the number of GPUs.

Data. A step is `grad_accum` micro-batches on each rank. The global order is
the seeded per-epoch shuffle of data.epoch_order; micro-batch i of a step
goes to rank i % world, so a resumed run continues exactly where it stopped.
The loss is the mean over every labelled token of the step, across ranks.

Checkpoints (output_dir/checkpoints/step-NNNNNN/) hold the sharded model and
optimizer (torch.distributed.checkpoint), the scheduler, per-rank RNG states
and state.json; a checkpoint directory appears only when complete. The final
model is exported by rank 0 as a Hugging Face checkpoint of the base's class
(bf16 safetensors), with the tokenizer, the base's generation files and the
base-only tensors (multi-token-prediction head) carried over unchanged.
"""

from __future__ import annotations

import json
import math
import os
import shutil
import time
from pathlib import Path

import torch

from . import data as data_module
from .config import RunConfig
from .hashing import hash_tree
from .merge import carry_missing_tensors
from .modeling import causal_lm_loss, torch_dtype
from .train import _dataset_revision, _scheduler, _tokenizer, environment
from .seeds import seed_everything

TRAINED_PREFIXES = ("model.language_model.", "lm_head.")
EXTRA_FILES = ("chat_template.jinja", "generation_config.json", "preprocessor_config.json", "video_preprocessor_config.json")


def _dist() -> bool:
    return torch.distributed.is_available() and torch.distributed.is_initialized()


def init_distributed() -> tuple[int, int, torch.device]:
    if "RANK" in os.environ and not _dist():
        backend = "nccl" if torch.cuda.is_available() else "gloo"
        torch.distributed.init_process_group(backend)
    rank = torch.distributed.get_rank() if _dist() else 0
    world = torch.distributed.get_world_size() if _dist() else 1
    if torch.cuda.is_available():
        local = int(os.environ.get("LOCAL_RANK", 0))
        torch.cuda.set_device(local)
        return rank, world, torch.device("cuda", local)
    return rank, world, torch.device("cpu")


class LossModel(torch.nn.Module):
    """The FSDP root: forward returns the chunked causal-LM loss."""

    def __init__(self, model, chunk_tokens: int):
        super().__init__()
        self.model = model
        self.chunk_tokens = chunk_tokens

    def forward(self, input_ids, labels, attention_mask):
        loss, _ = causal_lm_loss(self.model, input_ids, labels, attention_mask, self.chunk_tokens)
        return loss


def trainable(name: str) -> bool:
    return name.startswith(TRAINED_PREFIXES)


def build(config: RunConfig, rank: int, world: int, device: torch.device) -> LossModel:
    """The base, sharded over the ranks, fp32 master weights, vision frozen."""
    from transformers import AutoConfig, AutoModelForImageTextToText

    model_config = AutoConfig.from_pretrained(config.base_path)
    source = None
    if rank == 0:
        source = AutoModelForImageTextToText.from_pretrained(config.base_path, config=model_config, dtype=torch_dtype(config.dtype))
    with torch.device("meta"):
        model = AutoModelForImageTextToText.from_config(model_config, dtype=torch.float32)
    for name, param in model.named_parameters():
        param.requires_grad_(trainable(name))
    if config.gradient_checkpointing:
        model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    root = LossModel(model, config.loss_chunk_tokens)

    if world > 1:
        from torch.distributed.fsdp import MixedPrecisionPolicy, fully_shard

        policy = MixedPrecisionPolicy(param_dtype=torch_dtype(config.dtype), reduce_dtype=torch.float32)
        for layer in model.model.language_model.layers:
            fully_shard(layer, mp_policy=policy)
        if getattr(model.model, "visual", None) is not None:
            fully_shard(model.model.visual, mp_policy=policy)          # frozen and unused in text training: never gathered
        fully_shard(root, mp_policy=policy)
    root.to_empty(device=device)

    from torch.distributed.checkpoint.state_dict import StateDictOptions, set_model_state_dict

    full = {f"model.{k}": v for k, v in source.state_dict().items()} if rank == 0 else {}
    set_model_state_dict(root, full, options=StateDictOptions(full_state_dict=True, broadcast_from_rank0=world > 1))
    persistent = set(root.state_dict().keys())
    for name, buffer in root.named_buffers():
        if name in persistent:
            continue
        if rank == 0:
            buffer.copy_(source.get_buffer(name.removeprefix("model.")).to(buffer.dtype))
        if world > 1:
            torch.distributed.broadcast(buffer, src=0)
    del source, full
    return root


def _params(root) -> list[torch.nn.Parameter]:
    return [p for p in root.parameters() if p.requires_grad]


def _local(tensor) -> torch.Tensor:
    return tensor.full_tensor() if hasattr(tensor, "full_tensor") else tensor


def _rng_state(device: torch.device) -> dict:
    import random

    state = {"python": random.getstate(), "torch": torch.get_rng_state()}
    if device.type == "cuda":
        state["cuda"] = torch.cuda.get_rng_state(device)
    return state


def _set_rng_state(state: dict, device: torch.device) -> None:
    import random

    random.setstate(state["python"])
    torch.set_rng_state(state["torch"])
    if "cuda" in state and device.type == "cuda":
        torch.cuda.set_rng_state(state["cuda"], device)


def _barrier() -> None:
    if _dist():
        torch.distributed.barrier()


def save_checkpoint(root, optimizer, scheduler, state: dict, output: Path, rank: int, keep: int, device) -> Path:
    import torch.distributed.checkpoint as dcp
    from torch.distributed.checkpoint.state_dict import get_state_dict

    ckpts = output / "checkpoints"
    final = ckpts / f"step-{state['step']:06d}"
    tmp = ckpts / f".tmp-step-{state['step']:06d}"
    if rank == 0:
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir(parents=True)
    _barrier()
    model_sd, optim_sd = get_state_dict(root, optimizer)
    dcp.save({"model": model_sd, "optim": optim_sd}, checkpoint_id=str(tmp / "dcp"))
    torch.save(_rng_state(device), tmp / f"rng-{rank}.pt")
    _barrier()
    if rank == 0:
        torch.save(scheduler.state_dict(), tmp / "scheduler.pt")
        (tmp / "state.json").write_text(json.dumps(state))
        shutil.rmtree(final, ignore_errors=True)
        os.replace(tmp, final)                                   # a checkpoint is either complete or absent
        for old in sorted(ckpts.glob("step-*"))[:-keep]:
            shutil.rmtree(old, ignore_errors=True)
    _barrier()
    return final


def load_checkpoint(path: Path, root, optimizer, scheduler, rank: int, world: int, device) -> dict:
    import torch.distributed.checkpoint as dcp
    from torch.distributed.checkpoint.state_dict import get_state_dict, set_state_dict

    state = json.loads((path / "state.json").read_text())
    if state.get("world", 1) != world:
        raise ValueError(f"checkpoint was written by {state.get('world')} ranks, this run has {world}")
    model_sd, optim_sd = get_state_dict(root, optimizer)
    loaded = {"model": model_sd, "optim": optim_sd}
    dcp.load(loaded, checkpoint_id=str(path / "dcp"))
    set_state_dict(root, optimizer, model_state_dict=loaded["model"], optim_state_dict=loaded["optim"])
    scheduler.load_state_dict(torch.load(path / "scheduler.pt", weights_only=False))
    _set_rng_state(torch.load(path / f"rng-{rank}.pt", weights_only=False), device)
    return state


def export(root, config: RunConfig, out: Path, rank: int) -> dict | None:
    """Rank 0 writes the trained model as a Hugging Face checkpoint of the base's class."""
    from torch.distributed.checkpoint.state_dict import StateDictOptions, get_model_state_dict

    full = get_model_state_dict(root, options=StateDictOptions(full_state_dict=True, cpu_offload=True))
    if rank != 0:
        return None
    from transformers import AutoConfig, AutoModelForImageTextToText

    dtype = torch_dtype(config.dtype)
    weights = {}
    for key in list(full):                                        # one fp32 copy at a time, never two
        weights[key.removeprefix("model.")] = full.pop(key).to(dtype)
    with torch.device("meta"):
        model = AutoModelForImageTextToText.from_config(AutoConfig.from_pretrained(config.base_path), dtype=dtype)
    model.load_state_dict(weights, assign=True, strict=True)
    for name, buffer in root.named_buffers():
        target = name.removeprefix("model.")
        if target not in weights:
            module_name, _, buffer_name = target.rpartition(".")
            model.get_submodule(module_name).register_buffer(buffer_name, _local(buffer).detach().cpu(), persistent=False)
    if out.exists():
        shutil.rmtree(out)
    model.save_pretrained(out, safe_serialization=True, max_shard_size="5GB")
    _tokenizer(config).save_pretrained(out)
    for extra in EXTRA_FILES:
        source = Path(config.base_path) / extra
        if source.exists():
            shutil.copy(source, out / extra)
    carried = carry_missing_tensors(Path(config.base_path), out)
    return {"files": hash_tree(out), "carried_from_base": carried}


def train(config: RunConfig) -> dict:
    rank, world, device = init_distributed()
    output = Path(config.output_dir)
    if rank == 0:
        output.mkdir(parents=True, exist_ok=True)
    _barrier()
    seed_everything(config.seed)
    tokenizer = _tokenizer(config)
    examples, stats = data_module.load_examples(config.train_file, tokenizer, config.max_seq_len)
    if not examples:
        raise ValueError("no usable training examples")

    root = build(config, rank, world, device)
    params = _params(root)
    n_trainable = sum(p.numel() for p in params)
    optimizer = torch.optim.AdamW(params, lr=config.learning_rate, weight_decay=config.weight_decay,
                                  betas=(0.9, 0.95), fused=device.type == "cuda")
    per_step = config.grad_accum * world * config.micro_batch_size
    steps_per_epoch = math.ceil(len(examples) / per_step)
    total_steps = config.max_steps or steps_per_epoch * config.epochs
    scheduler = _scheduler(optimizer, total_steps, config.warmup_ratio)

    state = {"step": 0, "epoch": 0, "cursor": 0, "losses": [], "tokens": 0, "world": world}
    resumed_from = None
    checkpoints = sorted((output / "checkpoints").glob("step-*"))
    if checkpoints:
        state = load_checkpoint(checkpoints[-1], root, optimizer, scheduler, rank, world, device)
        resumed_from = checkpoints[-1].name

    log = (output / "metrics.jsonl").open("a") if rank == 0 else None
    peak = float(os.environ.get("ROUGE_PEAK_TFLOPS", "0")) * 1e12
    root.train()
    steps_this_process, started = 0, time.time()
    while state["step"] < total_steps:
        order = data_module.epoch_order(len(examples), config.seed, state["epoch"])
        micro = [[examples[i] for i in order[b : b + config.micro_batch_size]]
                 for b in range(0, len(order), config.micro_batch_size)]
        while state["cursor"] < len(micro) and state["step"] < total_steps:
            window = micro[state["cursor"] : state["cursor"] + config.grad_accum * world]
            mine = window[rank::world]
            counts = torch.tensor([sum(sum(1 for label in e.labels[1:] if label != -100) for e in batch) for batch in mine]
                                  + [0] * (config.grad_accum - len(mine)), dtype=torch.float64, device=device)
            local_tokens = torch.tensor([sum(len(e.input_ids) for batch in mine for e in batch)], dtype=torch.float64, device=device)
            totals = torch.stack([counts.sum(), local_tokens[0]])
            if world > 1:
                torch.distributed.all_reduce(totals)
            labelled, step_tokens = float(totals[0]), int(totals[1])
            step_loss = torch.zeros((), dtype=torch.float64, device=device)
            for index in range(config.grad_accum):
                if index < len(mine):
                    ids, labels, mask = data_module.collate(mine[index], tokenizer.pad_token_id)
                    ids, labels, mask = ids.to(device), labels.to(device), mask.to(device)
                    weight = float(counts[index]) / max(1.0, labelled)
                    loss = root(ids, labels, mask)
                else:                                             # the last window of an epoch can be short on some ranks
                    ids, labels, mask = data_module.collate([mine[0][0] if mine else window[0][0]], tokenizer.pad_token_id)
                    loss, weight = root(ids.to(device), labels.to(device), mask.to(device)), 0.0
                # FSDP averages gradients over ranks; scale by world so the step is the token mean over all ranks
                (loss * weight * world).backward()
                step_loss += loss.detach().double() * weight
            if world > 1:
                torch.distributed.all_reduce(step_loss)
            grad_norm = _local(torch.nn.utils.clip_grad_norm_(params, config.max_grad_norm))
            optimizer.step()
            scheduler.step()
            optimizer.zero_grad(set_to_none=True)
            state["cursor"] += len(window)
            state["step"] += 1
            state["tokens"] += step_tokens
            state["losses"].append(round(float(step_loss), 6))
            steps_this_process += 1
            elapsed = time.time() - started
            last = state["step"] == total_steps
            if log and (state["step"] % config.log_every == 0 or last):
                record = {"step": state["step"], "loss": float(step_loss), "lr": scheduler.get_last_lr()[0],
                          "grad_norm": float(grad_norm), "tokens": state["tokens"], "elapsed_s": round(elapsed, 2)}
                if peak:
                    record["mfu"] = round(6 * n_trainable * state["tokens"] / max(elapsed, 1e-9) / (world * peak), 4)
                log.write(json.dumps(record) + "\n")
                log.flush()
            stopping = config.stop_after is not None and steps_this_process >= config.stop_after
            projection = None
            if config.max_train_hours is not None and steps_this_process == config.budget_check_step and not last:
                hours = elapsed / steps_this_process * (total_steps - state["step"] + steps_this_process) / 3600
                projection = {"step": state["step"], "elapsed_s": round(elapsed, 1), "projected_total_h": round(hours, 3),
                              "max_train_hours": config.max_train_hours, "over": hours > config.max_train_hours}
                flag = torch.tensor([1.0 if projection["over"] else 0.0], device=device)
                if world > 1:
                    torch.distributed.broadcast(flag, src=0)       # every rank takes rank 0's decision
                projection["over"] = bool(flag.item())
                if log:
                    log.write(json.dumps({"budget_check": projection}) + "\n")
                    log.flush()
                stopping = stopping or projection["over"]
            if (state["step"] % config.save_every == 0 and not last) or (stopping and not last):
                save_checkpoint(root, optimizer, scheduler, state, output, rank, config.keep_checkpoints, device)
            if stopping and not last:
                if log:
                    log.close()
                over = projection is not None and projection["over"]
                return {"status": "over-budget" if over else "stopped", "step": state["step"],
                        "resumed_from": resumed_from, "budget_check": projection}
        if state["cursor"] >= len(micro):
            state["epoch"] += 1
            state["cursor"] = 0
    if log:
        log.close()

    exported = export(root, config, output / "model", rank)
    _barrier()
    if rank != 0:
        return {"status": "completed", "rank": rank}
    report = {
        "status": "completed",
        "mode": "full",
        "name": config.name,
        "resumed_from": resumed_from,
        "world": world,
        "steps": state["step"],
        "epochs_seen": state["epoch"] + (1 if state["cursor"] else 0),
        "first_loss": state["losses"][0],
        "final_loss": state["losses"][-1],
        "losses": state["losses"],
        "tokens": state["tokens"],
        "trainable_parameters": n_trainable,
        "data": stats.__dict__,
        "dataset": _dataset_revision(config),
        "model_files": exported["files"],
        "carried_from_base": exported["carried_from_base"],
        "environment": environment(),
        "config": config.to_dict(),
    }
    (output / "train-report.json").write_text(json.dumps(report, indent=1))
    return report
