"""Post-training for native Rouge: SFT, reasoning SFT, rejection sampling, DPO, RLVR (GRPO).

Stages and their inputs:
- sft / reasoning_sft: chat records {"messages": [{"role", "content"}], "reasoning"?}; the loss covers
  assistant tokens only (and the <|think|> span for reasoning SFT);
- rejection: sample k answers per verifiable prompt, keep the verified ones as SFT data;
- dpo: preference pairs {"prompt", "chosen", "rejected"} against a frozen reference model;
- grpo: verifiable prompts {"prompt", "answer"}; G samples per prompt, reward 1 when the verifier
  accepts, group-normalised advantages, KL to the reference. Only from an SFT checkpoint:
  R1.39 and R1.39b showed reward-only learning from scratch fails, so `grpo` refuses a base
  (pretraining-only) or random model.

Every stage writes a checkpoint through native/checkpoint.py with `stage` in its meta, so the
lineage says what each model went through. Datasets need licence and source records
(datasets/registry.json of M58); safety data enters through the same records (no data is
invented here).

    python -m native.posttrain sft --init RUN_DIR --data sft.jsonl --tokenizer tokenizer.json --out OUT --steps 1000
"""

from __future__ import annotations

import argparse
import copy
import json
import math
import random
import re
from pathlib import Path

import torch
import torch.nn.functional as F

from . import checkpoint
from .config import RougeConfig
from .model import RougeModel

ROLE_TOKENS = {"system": "<|system|>", "user": "<|user|>", "assistant": "<|assistant|>", "tool": "<|tool|>"}
THINK, END_THINK, EOS = "<|think|>", "<|/think|>", "<|eos|>"
SFT_STAGES = {"sft", "reasoning_sft", "rejection", "dpo", "grpo"}


# --- formatting ------------------------------------------------------------------------------
def encode_chat(tok, messages: list[dict], reasoning: str | None = None) -> tuple[list[int], list[int]]:
    """Token ids and a 0/1 loss mask (1 on assistant content, its end token and any reasoning span)."""
    ids, mask = [], []

    def add(text: str, learn: bool):
        piece = tok.encode(text).ids
        ids.extend(piece)
        mask.extend([int(learn)] * len(piece))

    def special(name: str, learn: bool):
        ids.append(tok.token_to_id(name))
        mask.append(int(learn))

    last_assistant = max((i for i, m in enumerate(messages) if m["role"] == "assistant"), default=-1)
    for i, m in enumerate(messages):
        special(ROLE_TOKENS[m["role"]], False)
        learn = m["role"] == "assistant"
        if learn and reasoning is not None and i == last_assistant:
            special(THINK, True)
            add(reasoning, True)
            special(END_THINK, True)
        add(m["content"], learn)
        special(EOS, learn)
    return ids, mask


def masked_loss(model, ids: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    """Mean cross-entropy over positions whose target is marked in `mask`."""
    logits = model(ids[:, :-1])[0]
    target, m = ids[:, 1:], mask[:, 1:].float()
    ce = F.cross_entropy(logits.float().reshape(-1, logits.size(-1)), target.reshape(-1), reduction="none").view_as(m)
    return (ce * m).sum() / m.sum().clamp_min(1)


def sequence_logprob(model, prompt: list[int], completion: list[int], device) -> torch.Tensor:
    ids = torch.tensor([prompt + completion], device=device)
    logits = model(ids[:, :-1])[0].float()
    logp = torch.log_softmax(logits, -1)
    tgt = ids[:, 1:]
    lp = logp.gather(-1, tgt.unsqueeze(-1)).squeeze(-1)
    return lp[:, len(prompt) - 1:].sum()


# --- stages ----------------------------------------------------------------------------------
def sft_step(model, opt, tok, records: list[dict], device, reasoning: bool = False, max_len: int = 512) -> float:
    batch = [encode_chat(tok, r["messages"], r.get("reasoning") if reasoning else None) for r in records]
    width = min(max_len, max(len(i) for i, _ in batch))
    pad = tok.token_to_id("<|pad|>")
    ids = torch.full((len(batch), width), pad, dtype=torch.long)
    mask = torch.zeros((len(batch), width), dtype=torch.long)
    for k, (i, m) in enumerate(batch):
        i, m = i[:width], m[:width]
        ids[k, :len(i)] = torch.tensor(i)
        mask[k, :len(m)] = torch.tensor(m)
    loss = masked_loss(model, ids.to(device), mask.to(device))
    opt.zero_grad(set_to_none=True)
    loss.backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
    opt.step()
    return loss.item()


def dpo_step(model, ref, opt, tok, pairs: list[dict], device, beta: float = 0.1) -> float:
    losses = []
    for p in pairs:
        prompt = tok.encode(p["prompt"]).ids
        chosen, rejected = tok.encode(p["chosen"]).ids, tok.encode(p["rejected"]).ids
        pc, pr = sequence_logprob(model, prompt, chosen, device), sequence_logprob(model, prompt, rejected, device)
        with torch.no_grad():
            rc, rr = sequence_logprob(ref, prompt, chosen, device), sequence_logprob(ref, prompt, rejected, device)
        losses.append(-F.logsigmoid(beta * ((pc - rc) - (pr - rr))))
    loss = torch.stack(losses).mean()
    opt.zero_grad(set_to_none=True)
    loss.backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
    opt.step()
    return loss.item()


@torch.no_grad()
def sample(model, prompt: list[int], max_new: int, device, temperature: float = 1.0, stop: int | None = None,
           generator: torch.Generator | None = None) -> list[int]:
    ids = torch.tensor([prompt], device=device)
    cache = model.init_cache()
    logits, cache = model(ids, cache=cache, start=0)
    out, pos = [], ids.size(1)
    for _ in range(max_new):
        probs = torch.softmax(logits[0, -1].float() / max(temperature, 1e-4), -1)
        nxt = int(torch.multinomial(probs, 1, generator=generator))
        if stop is not None and nxt == stop:
            break
        out.append(nxt)
        logits, cache = model(torch.tensor([[nxt]], device=device), cache=cache, start=pos)
        pos += 1
    return out


def verify_answer(text: str, answer: str) -> bool:
    """Verifier for generated math/algorithmic items: the first number-like token must equal the answer."""
    m = re.search(r"-?\d+(?:/\d+)?|empty", text)
    return m is not None and m.group(0) == answer.strip()


def rejection_sample(model, tok, items: list[dict], k: int, device, seed: int = 0) -> list[dict]:
    gen = torch.Generator(device="cpu").manual_seed(seed)
    kept = []
    stop = tok.token_to_id(EOS)
    for it in items:
        prompt = tok.encode(it["prompt"]).ids
        for _ in range(k):
            text = tok.decode(sample(model, prompt, 12, device, 1.0, stop, gen))
            if verify_answer(text, it["answer"]):
                kept.append({"messages": [{"role": "user", "content": it["prompt"]}, {"role": "assistant", "content": text.strip()}],
                             "source": "rejection_sampling", "verified": True})
                break
    return kept


def grpo_step(model, ref, opt, tok, items: list[dict], device, group: int = 4, beta: float = 0.02,
              max_new: int = 12, seed: int = 0) -> dict:
    gen = torch.Generator(device="cpu").manual_seed(seed)
    stop = tok.token_to_id(EOS)
    losses, rewards = [], []
    for it in items:
        prompt = tok.encode(it["prompt"]).ids
        comps = [sample(model, prompt, max_new, device, 1.0, stop, gen) for _ in range(group)]
        r = torch.tensor([float(verify_answer(tok.decode(c), it["answer"])) for c in comps])
        rewards.extend(r.tolist())
        adv = (r - r.mean()) / (r.std() + 1e-6) if r.std() > 0 else torch.zeros_like(r)
        for c, a in zip(comps, adv):
            if not c:
                continue
            lp = sequence_logprob(model, prompt, c, device)
            with torch.no_grad():
                ref_lp = sequence_logprob(ref, prompt, c, device)
            kl = lp - ref_lp                                   # sequence-level estimate of KL(policy || reference)
            losses.append(-(a * lp) / len(c) + beta * kl / len(c))
    if losses:
        loss = torch.stack(losses).mean()
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
    return {"loss": float(loss) if losses else 0.0, "reward": sum(rewards) / max(1, len(rewards))}


# --- driver ----------------------------------------------------------------------------------
def load_init(init: str, device):
    found = checkpoint.latest(init)
    if found is None:
        raise SystemExit(f"no verified checkpoint in {init}")
    path, meta = found
    cfg = RougeConfig(**meta["config"])
    model = RougeModel(cfg).to(device)
    model.load_state_dict(torch.load(Path(path) / "model.pt", map_location=device, weights_only=True))
    return model, cfg, meta


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=["sft", "reasoning_sft", "rejection", "dpo", "grpo"])
    parser.add_argument("--init", required=True, help="run directory with a verified checkpoint")
    parser.add_argument("--data", required=True, help="JSONL records for the stage")
    parser.add_argument("--tokenizer", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--steps", type=int, default=100)
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--lr", type=float, default=1e-5)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()
    from tokenizers import Tokenizer

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    tok = Tokenizer.from_file(args.tokenizer)
    model, cfg, meta = load_init(args.init, device)
    stage_before = meta.get("stage", "pretrain")
    if args.stage == "grpo" and stage_before not in SFT_STAGES:
        raise SystemExit(f"grpo needs an SFT checkpoint (this one is '{stage_before}'): reward-only learning from a base "
                         "model failed in R1.39/R1.39b")
    records = [json.loads(l) for l in Path(args.data).read_text().splitlines() if l.strip()]
    rng = random.Random(args.seed)
    ref = copy.deepcopy(model).eval() if args.stage in ("dpo", "grpo") else None
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.0)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    log = open(out / "posttrain.jsonl", "a")
    if args.stage == "rejection":
        kept = rejection_sample(model, tok, records, k=8, device=device, seed=args.seed)
        (out / "rejection_sft.jsonl").write_text("".join(json.dumps(r) + "\n" for r in kept))
        print(f"[posttrain] rejection sampling kept {len(kept)} of {len(records)}")
        return
    for step in range(1, args.steps + 1):
        batch = rng.sample(records, min(args.batch, len(records)))
        if args.stage in ("sft", "reasoning_sft"):
            rec = {"step": step, "loss": sft_step(model, opt, tok, batch, device, reasoning=args.stage == "reasoning_sft")}
        elif args.stage == "dpo":
            rec = {"step": step, "loss": dpo_step(model, ref, opt, tok, batch, device)}
        else:
            rec = {"step": step, **grpo_step(model, ref, opt, tok, batch, device, seed=args.seed + step)}
        log.write(json.dumps(rec) + "\n")
        if not math.isfinite(rec["loss"]):
            raise SystemExit(f"non-finite loss at step {step}")
    checkpoint.save(out, args.steps, model, opt, {"architecture_sha": cfg.architecture_sha, "config": json.loads(cfg.to_json()),
                                                   "stage": args.stage, "parent": str(args.init), "parent_stage": stage_before})
    print(f"[posttrain] {args.stage} done: {args.steps} steps")


if __name__ == "__main__":
    main()
