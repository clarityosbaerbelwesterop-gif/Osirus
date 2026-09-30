"""Self-generated, verifier-filtered training data (RSI iteration: ReST-EM style).

    sample:  the current model answers every verifiable prompt k times (thinking on, T=1.0)
    select:  every answer is checked by code (evaluate.check); verified-correct answers of
             prompts the model does not always solve become training records

No model judges another and no answer is kept unverified. Prompts the model solves every
time teach little, so only a deterministic fraction of them contributes one answer;
prompts it never solves contribute nothing. The held-out primary suite comes from the same
sources but never from these prompts (datasets/build.py), so the gain it measures is
generalisation, not memorised answers.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

from .evaluate import check


def sample(model_path: str, prompts: list[dict], settings: dict) -> list[list[str]]:
    """k responses per prompt from one vLLM engine (one GPU; the job runs one per GPU)."""
    from vllm import LLM, SamplingParams

    llm = LLM(model=model_path, seed=settings.get("seed", 0), max_model_len=settings.get("max_model_len", 16384),
              gpu_memory_utilization=settings.get("gpu_memory_utilization", 0.9))
    params = SamplingParams(n=settings["k"], temperature=settings.get("temperature", 1.0), top_p=settings.get("top_p", 0.95),
                            top_k=settings.get("top_k", 20), max_tokens=settings["max_new_tokens"], seed=settings.get("seed", 0))
    tokenizer = llm.get_tokenizer()
    texts = [tokenizer.apply_chat_template(p["messages"], tokenize=False, add_generation_prompt=True,
                                           enable_thinking=settings.get("enable_thinking", True)) for p in prompts]
    return [[o.text for o in out.outputs] for out in llm.generate(texts, params)]


def keep_easy(prompt_id: str, fraction: float) -> bool:
    digest = int(hashlib.sha256(prompt_id.encode()).hexdigest()[:8], 16)
    return digest / 0xFFFFFFFF < fraction


def select(prompts: list[dict], samples: dict[str, list[str]], *, max_per_prompt: int = 2,
           easy_fraction: float = 0.25, opens_thinking: bool = True) -> tuple[list[dict], dict]:
    records, buckets, by_source = [], Counter(), Counter()
    correct_total = answered = 0
    for prompt in prompts:
        responses = samples.get(prompt["id"])
        if not responses:
            continue
        verdicts = [check(prompt["check"], r) for r in responses]
        answered += len(responses)
        correct_total += sum(verdicts)
        rate = sum(verdicts) / len(verdicts)
        bucket = "never" if rate == 0 else "always" if rate == 1 else "sometimes"
        buckets[bucket] += 1
        if bucket == "never" or (bucket == "always" and not keep_easy(prompt["id"], easy_fraction)):
            continue
        limit = 1 if bucket == "always" else max_per_prompt
        kept = [r for r, ok in zip(responses, verdicts) if ok][:limit]
        for n, response in enumerate(kept):
            content = ("<think>\n" + response.lstrip("\n")) if (opens_thinking and "</think>" in response and "<think>" not in response) else response
            records.append({"id": f"rft-{prompt['id']}-{n}", "source": f"rft-{prompt.get('source', 'self')}",
                            "messages": [*prompt["messages"], {"role": "assistant", "content": content}],
                            "meta": {"pass_rate": rate, "k": len(responses)}})
            by_source[prompt.get("source", "self")] += 1
    stats = {"prompts": len(prompts), "samples": answered, "sample_accuracy": correct_total / max(1, answered),
             "buckets": dict(buckets), "records": len(records), "records_by_source": dict(by_source),
             "max_per_prompt": max_per_prompt, "easy_fraction": easy_fraction}
    return records, stats


def read_jsonl(path: str | Path) -> list[dict]:
    with open(path, encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def write_jsonl(path: str | Path, rows: list[dict]) -> None:
    Path(path).write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
