#!/usr/bin/env python3
"""Build a Rouge training mixture and its hidden eval set, per recipe.

Recipes:
    sft-v0   the full first mixture (18k conversations, 8k tokens, reasoning
             traces kept)
    exp-001  the smallest credible experiment: ~9k verified conversations,
             4k tokens, answers without reasoning traces (non-thinking
             mode), self-correction, and a pre-registered eval whose
             primary suite uses templates that never appear in training

Runs on a CI runner with Hub access (rouge-data.yml, task=build). Every
training source must be `approved` in datasets/registry.json and is read at
its pinned revision; eval-only sources never enter training. Filters,
quotas, deduplication and decontamination are all recorded in manifest.json
next to the sha256 of every output file.

Outputs (in --out):
    train.jsonl     {"id", "source", "messages", "meta"}
    eval.jsonl      {"id", "category", "source", "messages", "check"}
    manifest.json   counts, filters, revisions, token stats, hashes
    samples.md      a few records per source, for human review
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from rouge_train import generators, ifeval, registry  # noqa: E402

SEED = 20260928
MAX_TOKENS = 7500  # leaves room for the chat template inside 8k sequences
GERMAN = {
    "der", "die", "das", "und", "ist", "nicht", "mit", "ein", "eine", "zu", "auf", "für", "ich", "sie", "es", "wir", "auch", "sich", "von", "den", "dass", "wie", "wird",
}

QUOTAS: dict = {}  # set from the recipe in main()
SFT_V0_QUOTAS = {
    "nemotron-math": 2500,
    "nemotron-stem": 2500,
    "openr1-math": 1500,
    "openmath-cot": 1200,
    "opencode": 3000,
    "tulu-oasst1": 2500,
    "tulu-oasst1-de": 800,
    "tulu-sciriff": 800,
    "aya-de": 1500,
    "oasst2-de": 1500,
    "rouge-generated": 3000,
}
# Records are measured with the pinned tokenizer at read time, so quotas
# fill with records that fit the 8k training window. Anything longer than
# this many characters is skipped before tokenising (it cannot fit).
MAX_RECORD_CHARS = 40_000
# Nemotron v1 "code" is not used: 150,001 rows scanned in build v1 gave one
# usable record (70% over length, 30% repeated prompts); its prompts are the
# OpenCodeReasoning set, which is read directly instead.
RECIPES = {
    "sft-v0": {"quotas": SFT_V0_QUOTAS, "max_tokens": 7500, "strip_thinking": False,
               "generated": {"seed": "sft-v0", "self_correction": 0.0}},
    "exp-001": {
        "quotas": {
            "nemotron-math": 800, "nemotron-stem": 800, "openr1-math": 1000, "openmath-cot": 600, "opencode": 800,
            "tulu-oasst1": 1500, "tulu-oasst1-de": 800, "tulu-sciriff": 400, "aya-de": 1500, "oasst2-de": 1500,
            "rouge-generated": 1800,
        },
        # 4k training sequences: content plus template stays below 4,096.
        "max_tokens": 3800,
        # Non-thinking mode: the answer after a reasoning trace is kept, the
        # trace is dropped (reasoning post-training is M59).
        "strip_thinking": True,
        "generated": {"seed": "exp-001", "self_correction": 0.3},
    },
}
RECIPE = "sft-v0"
STRIP_THINKING = False
MIN_ANSWER_CHARS = 80  # stripped answers shorter than this carry no solution
ALLOWED_GENERATORS = ("Qwen3-235B-A22B", "DeepSeek-R1")
ALLOWED_OPENMATH = ("DeepSeek-R1", "QwQ-32B")


TOKENIZER = None  # the pinned base tokenizer, loaded in main()


def n_tokens(record: dict) -> int:
    """Tokens of a record: contents plus 8 per message for the template."""
    return sum(len(TOKENIZER.encode(m["content"]).ids) + 8 for m in record["messages"])


def prompt_key(record: dict) -> str:
    """Deduplication key: every user turn, normalised. Multi-turn
    conversations that share an opening are different conversations."""
    return generators.normalise("\n".join(m["content"] for m in record["messages"] if m["role"] == "user"))


def german(text: str) -> bool:
    words = re.findall(r"[a-zäöüß]+", text.lower())
    return len(words) >= 8 and sum(w in GERMAN for w in words) / len(words) > 0.12


def pinned(reg: dict, source_id: str) -> tuple[str, str]:
    entry = next(e for e in reg["datasets"] if e["id"] == source_id)
    if entry["role"] == "train" and entry["status"] != "approved":
        raise SystemExit(f"{source_id} is not approved for training")
    return entry["source"].removeprefix("hf:"), entry["revision"]


def stream(repo: str, revision: str, config: str | None, split: str, buffer: int = 5000):
    from datasets import load_dataset

    ds = load_dataset(repo, config, split=split, streaming=True, revision=revision)
    return ds.shuffle(seed=SEED, buffer_size=buffer)


def clean_messages(messages: list[dict]) -> list[dict] | None:
    out = []
    for message in messages:
        role, content = message.get("role"), (message.get("content") or "").strip()
        if role == "assistant" and STRIP_THINKING and "</think>" in content:
            content = content.rsplit("</think>", 1)[1].strip()
            if len(content) < MIN_ANSWER_CHARS:
                return None
        if role not in ("system", "user", "assistant") or not content or (STRIP_THINKING and "<think>" in content):
            return None
        out.append({"role": role, "content": content})
    if len(out) < 2 or out[-1]["role"] != "assistant" or not any(m["role"] == "user" for m in out):
        return None
    return out


def take(name: str, rows, adapt, quota: int, max_scan: int, stats: dict):
    kept, scanned, reasons, prompts = [], 0, Counter(), set()
    for row in rows:
        scanned += 1
        if scanned > max_scan or len(kept) >= quota:
            break
        record, reason = adapt(row)
        if record is None:
            reasons[reason] += 1
            continue
        if sum(len(m["content"]) for m in record["messages"]) > MAX_RECORD_CHARS or n_tokens(record) > MAX_TOKENS:
            reasons["too-long"] += 1
            continue
        prompt = prompt_key(record)
        if prompt in prompts:
            reasons["duplicate-prompt"] += 1
            continue
        prompts.add(prompt)
        record["source"] = name
        kept.append(record)
    stats[name] = {"kept": len(kept), "scanned": scanned, "quota": quota, "rejected": dict(reasons)}
    print(f"{name}: kept {len(kept)}/{quota} after scanning {scanned}; rejected {dict(reasons)}", flush=True)
    return kept


def build_train(reg: dict, stats: dict) -> list[dict]:
    records: list[dict] = []

    repo, rev = pinned(reg, "nemotron-post-training-v1")
    for split in ("math", "stem"):
        def adapt(row):
            if not str(row.get("generator", "")).startswith(ALLOWED_GENERATORS):
                return None, "generator"
            messages = clean_messages(row["messages"])
            if not messages:
                return None, "shape"
            return {"id": f"nemotron-{row['uuid']}", "messages": messages,
                    "meta": {"generator": row["generator"], "reasoning": row.get("reasoning"), "split": split}}, None
        records += take(f"nemotron-{split}", stream(repo, rev, None, split), adapt, QUOTAS[f"nemotron-{split}"], 60 * QUOTAS[f"nemotron-{split}"], stats)

    repo, rev = pinned(reg, "openr1-math-220k")
    def adapt_openr1(row):
        verified = [g for g, ok, done in zip(row["generations"] or [], row["correctness_math_verify"] or [], row["is_reasoning_complete"] or []) if ok and done]
        if not verified:
            return None, "unverified"
        messages = clean_messages([{"role": "user", "content": row["problem"]}, {"role": "assistant", "content": verified[0]}])
        return ({"id": f"openr1-{row['uuid']}", "messages": messages, "meta": {"answer": row["answer"]}}, None) if messages else (None, "shape")
    records += take("openr1-math", stream(repo, rev, "default", "train"), adapt_openr1, QUOTAS["openr1-math"], 20 * QUOTAS["openr1-math"], stats)

    repo, rev = pinned(reg, "open-math-reasoning")
    def adapt_openmath(row):
        if row.get("generation_model") not in ALLOWED_OPENMATH:
            return None, "generator"
        if row.get("problem_type") != "has_answer_extracted":
            return None, "no-answer"
        messages = clean_messages([{"role": "user", "content": row["problem"]}, {"role": "assistant", "content": row["generated_solution"]}])
        key = hashlib.sha256(row["problem"].encode()).hexdigest()[:16]
        return ({"id": f"openmath-{key}", "messages": messages, "meta": {"generator": row["generation_model"], "expected": row["expected_answer"]}}, None) if messages else (None, "shape")
    records += take("openmath-cot", stream(repo, rev, None, "cot"), adapt_openmath, QUOTAS["openmath-cot"], 20 * QUOTAS["openmath-cot"], stats)

    repo, rev = pinned(reg, "open-code-reasoning")
    def adapt_opencode(row):
        if not row.get("input") or row["input"].strip() == "-":
            return None, "no-input"
        messages = clean_messages([{"role": "user", "content": row["input"]}, {"role": "assistant", "content": row["output"]}])
        return ({"id": f"opencode-{row['id']}", "messages": messages, "meta": {"dataset": row.get("dataset"), "license": row.get("license")}}, None) if messages else (None, "shape")
    records += take("opencode", stream(repo, rev, "split_0", "split_0"), adapt_opencode, QUOTAS["opencode"], 20 * QUOTAS["opencode"], stats)

    repo, rev = pinned(reg, "tulu-3-sft-mixture")
    tulu_sources: Counter = Counter()
    buckets = {"tulu-oasst1": [], "tulu-oasst1-de": [], "tulu-sciriff": []}
    scanned = 0
    for row in stream(repo, rev, None, "train", buffer=20000):
        scanned += 1
        source = row["source"]
        tulu_sources[source] += 1
        if scanned > 400_000 or all(len(buckets[b]) >= QUOTAS[b] for b in buckets):
            break
        messages = clean_messages(row["messages"])
        if not messages:
            continue
        text = " ".join(m["content"] for m in messages)
        if "oasst1" in source:
            bucket = "tulu-oasst1-de" if german(text) else "tulu-oasst1"
        elif "sciriff" in source:
            bucket = "tulu-sciriff"
        else:
            continue
        record = {"id": f"tulu-{row['id']}", "source": bucket, "messages": messages, "meta": {"tulu_source": source}}
        if len(buckets[bucket]) < QUOTAS[bucket] and sum(len(m["content"]) for m in messages) <= MAX_RECORD_CHARS and n_tokens(record) <= MAX_TOKENS:
            buckets[bucket].append(record)
    for bucket, rows in buckets.items():
        stats[bucket] = {"kept": len(rows), "quota": QUOTAS[bucket], "scanned_tulu_rows": scanned}
        print(f"{bucket}: kept {len(rows)}/{QUOTAS[bucket]}", flush=True)
        records += rows
    stats["tulu_sources_seen"] = dict(tulu_sources.most_common(40))

    from datasets import load_dataset

    repo, rev = pinned(reg, "aya-dataset")
    aya = load_dataset(repo, "default", split="train", revision=rev)
    def adapt_aya(row):
        if row["language"] != "German":
            return None, "language"
        if len((row["targets"] or "").strip()) < 20:
            return None, "short"
        messages = clean_messages([{"role": "user", "content": row["inputs"]}, {"role": "assistant", "content": row["targets"]}])
        key = hashlib.sha256((row["inputs"] + row["targets"]).encode()).hexdigest()[:16]
        return ({"id": f"aya-{key}", "messages": messages, "meta": {"annotation": row["annotation_type"]}}, None) if messages else (None, "shape")
    records += take("aya-de", aya.shuffle(seed=SEED), adapt_aya, QUOTAS["aya-de"], len(aya), stats)

    repo, rev = pinned(reg, "oasst2")
    tree = load_dataset(repo, split="train", revision=rev)
    by_id = {row["message_id"]: row for row in tree}
    def path_to_root(row):
        chain = [row]
        while chain[-1]["parent_id"]:
            parent = by_id.get(chain[-1]["parent_id"])
            if parent is None:
                return None
            chain.append(parent)
        return list(reversed(chain))
    def adapt_oasst2(row):
        if row["role"] != "assistant" or row["lang"] != "de":
            return None, "not-german-assistant"
        if row["rank"] != 0 or row["deleted"] or row["synthetic"] or row["review_result"] is False:
            return None, "not-top-ranked"
        chain = path_to_root(row)
        if not chain or len(chain) > 6:
            return None, "path"
        roles = {"prompter": "user", "assistant": "assistant"}
        messages = clean_messages([{"role": roles[m["role"]], "content": m["text"]} for m in chain])
        return ({"id": f"oasst2-{row['message_id']}", "messages": messages, "meta": {"turns": len(chain)}}, None) if messages else (None, "shape")
    records += take("oasst2-de", tree.shuffle(seed=SEED), adapt_oasst2, QUOTAS["oasst2-de"], len(tree), stats)

    spec = RECIPES[RECIPE]["generated"]
    generated = list(generators.sft_records(spec["seed"], QUOTAS["rouge-generated"], spec["self_correction"]))
    for record in generated:
        record["source"] = "rouge-generated"
        record["meta"] = {"family": record.pop("family"), "lang": record.pop("lang")}
    stats["rouge-generated"] = {"kept": len(generated), "quota": QUOTAS["rouge-generated"]}
    records += generated
    return records


def build_eval(reg: dict, stats: dict) -> list[dict]:
    items: list[dict] = []
    rng = random.Random(f"eval-v0:{SEED}")

    repo, rev = pinned(reg, "mgsm")
    for lang, category in (("en", "reasoning"), ("de", "german")):
        from datasets import load_dataset

        rows = list(load_dataset(repo, lang, split="test", revision=rev))
        for row in rng.sample(rows, 100):
            prompt = row["question"].split(":", 1)[-1].strip()
            suffix = "Gib am Ende eine Zeile \"Antwort: <Zahl>\" aus." if lang == "de" else 'End with a line "Answer: <number>".'
            items.append({"id": f"mgsm-{lang}-{len(items)}", "category": category, "source": "mgsm", "suite": "guard",
                          "messages": [{"role": "user", "content": f"{prompt}\n\n{suffix}"}],
                          "check": {"type": "numeric", "answer": row["answer_number"]}})

    repo, rev = pinned(reg, "mbpp")
    from datasets import load_dataset

    rows = list(load_dataset(repo, "sanitized", split="test", revision=rev))
    for row in rng.sample(rows, 100):
        tests = "\n".join(row["test_imports"] + row["test_list"])
        prompt = f"{row['prompt']}\nYour code should pass these tests:\n{tests}\nReturn the complete Python code in one ```python block."
        items.append({"id": f"mbpp-{row['task_id']}", "category": "coding", "source": "mbpp", "suite": "guard",
                      "messages": [{"role": "user", "content": prompt}], "check": {"type": "python_tests", "tests": tests}})

    repo, rev = pinned(reg, "ifeval")
    rows = list(load_dataset(repo, split="train", revision=rev))
    supported = [r for r in rows if all(i in ifeval.SUPPORTED for i in r["instruction_id_list"])]
    stats["ifeval"] = {"total": len(rows), "supported": len(supported)}
    for row in rng.sample(supported, min(200, len(supported))):
        instructions = [{"id": i, "kwargs": {k: v for k, v in (kw or {}).items() if v is not None}} for i, kw in zip(row["instruction_id_list"], row["kwargs"])]
        items.append({"id": f"ifeval-{row['key']}", "category": "instruction", "source": "ifeval", "suite": "guard",
                      "messages": [{"role": "user", "content": row["prompt"]}], "check": {"type": "ifeval", "instructions": instructions}})

    if RECIPE == "sft-v0":
        for item in generators.eval_items("eval-v0", 150):
            item["source"] = "rouge-eval-generated"
            item["suite"] = "report"
            item.pop("lang", None)
            items.append(item)
    else:
        # Primary suite: held-out templates (missing information and its
        # specified twin, claims to check), English and German.
        for item in generators.experiment_eval_items(RECIPE, 80, 120):
            item["source"] = "rouge-eval-generated"
            items.append(item)
        for item in generators.eval_items(f"{RECIPE}-format", 30):
            if item["category"] in ("format", "german"):
                item["source"] = "rouge-eval-generated"
                item["suite"] = "report"
                item.pop("lang", None)
                items.append(item)
    for i, (q, lang) in enumerate([("Who are you?", "en"), ("Which model are you based on?", "en"), ("Wer bist du?", "de"), ("Auf welchem Modell basierst du?", "de")]):
        items.append({"id": f"identity-{i}", "category": "identity", "source": "rouge-eval-generated", "suite": "report",
                      "messages": [{"role": "user", "content": q}], "check": {"type": "contains_all", "terms": ["Rouge"]}})
    stats["eval_by_category"] = dict(Counter(i["category"] for i in items))
    stats["eval_by_suite"] = dict(Counter(i["suite"] for i in items))
    return items


def token_filter(records: list[dict], stats: dict) -> list[dict]:
    """Final length gate (every source is already measured at read time)."""
    kept, lengths = [], []
    for record in records:
        n = n_tokens(record)
        if n <= MAX_TOKENS:
            record["meta"]["approx_tokens"] = n
            kept.append(record)
            lengths.append(n)
    lengths.sort()
    stats["tokens"] = {"dropped_too_long": len(records) - len(kept), "total": sum(lengths),
                       "mean": round(sum(lengths) / max(1, len(lengths))), "p50": lengths[len(lengths) // 2] if lengths else 0,
                       "p95": lengths[int(len(lengths) * 0.95)] if lengths else 0}
    return kept


def is_german(record: dict) -> bool:
    if record["meta"].get("lang"):
        return record["meta"]["lang"] == "de"
    return german(" ".join(m["content"] for m in record["messages"] if m["role"] == "assistant"))


def code_commit() -> str | None:
    if os.environ.get("GITHUB_SHA"):
        return os.environ["GITHUB_SHA"]
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True, cwd=HERE).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def main() -> None:
    global TOKENIZER, QUOTAS, MAX_TOKENS, STRIP_THINKING, RECIPE
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--tokenizer", help="tokenizer.json of the pinned base (fetched if absent)")
    parser.add_argument("--recipe", default="sft-v0", choices=sorted(RECIPES))
    args = parser.parse_args()
    RECIPE = args.recipe
    QUOTAS, MAX_TOKENS, STRIP_THINKING = RECIPES[RECIPE]["quotas"], RECIPES[RECIPE]["max_tokens"], RECIPES[RECIPE]["strip_thinking"]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    reg = registry.load()
    stats: dict = {}

    tokenizer_file = Path(args.tokenizer) if args.tokenizer else out / "tokenizer" / "tokenizer.json"
    if not tokenizer_file.exists():
        subprocess.run([sys.executable, str(HERE.parent / "scripts" / "fetch_tokenizer.py"), str(tokenizer_file.parent)], check=True)

    from tokenizers import Tokenizer

    TOKENIZER = Tokenizer.from_file(str(tokenizer_file))
    eval_items = build_eval(reg, stats)
    train = build_train(reg, stats)

    seen, unique = set(), []
    for record in train:
        key = prompt_key(record)
        if key in seen:
            continue
        seen.add(key)
        unique.append(record)
    stats["deduplicated"] = len(train) - len(unique)
    eval_prompts = {i["messages"][0]["content"] for i in eval_items}
    clean, removed = generators.decontaminate(unique, eval_prompts)
    prefixes = {generators.normalise(p)[:120] for p in eval_prompts}
    final = [r for r in clean if generators.normalise(next(m["content"] for m in r["messages"] if m["role"] == "user"))[:120] not in prefixes]
    stats["decontaminated_exact"] = removed
    stats["decontaminated_prefix"] = len(clean) - len(final)
    final = token_filter(final, stats)
    random.Random(SEED).shuffle(final)

    def write(name: str, rows: list[dict]) -> str:
        path = out / name
        path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n")
        return hashlib.sha256(path.read_bytes()).hexdigest()

    manifest = {
        "schema": "rouge.dataset-manifest/1",
        "name": "rouge-sft-v0" if RECIPE == "sft-v0" else f"rouge-{RECIPE}",
        "recipe": RECIPE,
        "strip_thinking": STRIP_THINKING,
        "registry_version": reg["version"],
        "code_commit": code_commit(),
        "max_tokens": MAX_TOKENS,
        "seed": SEED,
        "sources": {e["id"]: {"source": e["source"], "revision": e.get("revision"), "license": e["license"], "role": e["role"]}
                    for e in reg["datasets"] if e["status"] == "approved" or e["role"] == "eval-only"},
        "train": {"file": "train.jsonl", "sha256": write("train.jsonl", final), "records": len(final),
                  "by_source": dict(Counter(r["source"] for r in final)),
                  "german": sum(is_german(r) for r in final)},
        "eval": {"file": "eval.jsonl", "sha256": write("eval.jsonl", eval_items), "items": len(eval_items),
                 "by_category": dict(Counter(i["category"] for i in eval_items)),
                 "by_suite": dict(Counter(i["suite"] for i in eval_items))},
        "stats": stats,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False))
    samples = [f"# {manifest['name']} samples\n"]
    for source in sorted({r["source"] for r in final}):
        for record in [r for r in final if r["source"] == source][:2]:
            samples.append(f"## {source} — {record['id']}\n")
            for m in record["messages"]:
                samples.append(f"**{m['role']}**: {m['content'][:1200]}\n")
    (out / "samples.md").write_text("\n".join(samples))
    print(json.dumps({k: manifest[k] for k in ("train", "eval")}, indent=1))
    print(json.dumps(stats, indent=1)[:6000])


if __name__ == "__main__":
    main()
