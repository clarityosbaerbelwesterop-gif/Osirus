"""Base vs Rouge on the same hidden eval set, with the same settings.

Eval items (JSONL):
    {"id": "...", "category": "reasoning|instruction|coding|german|english|writing|format",
     "messages": [{"role": "user", "content": "..."}],
     "check": {"type": "...", ...}}

Every check is code: exact or numeric answers, required terms, regexes,
JSON shape, word and bullet counts, language, endings, and Python unit
tests executed in a subprocess with a timeout. No model grades another.
Thinking blocks (<think>...</think>) are removed before checking.
"""

from __future__ import annotations

import json
import math
import random
import re
import subprocess
import sys
import tempfile
from pathlib import Path

THINK = re.compile(r"<think>.*?</think>", re.S)
GERMAN = {"der", "die", "das", "und", "ist", "nicht", "mit", "ein", "eine", "zu", "auf", "für", "ich", "sie", "es", "wir", "auch", "sich", "von", "den"}
ENGLISH = {"the", "and", "is", "not", "with", "a", "an", "to", "of", "for", "it", "that", "this", "are", "be", "on", "in", "as", "by", "you"}


def visible(text: str) -> str:
    text = THINK.sub("", text)
    if "</think>" in text:  # an opening tag consumed by the template
        text = text.split("</think>", 1)[1]
    return text.strip()


def final_answer(text: str) -> str:
    marked = re.findall(r"answer\s*[:：]\s*(.+)", text, re.I)
    line = marked[-1] if marked else (text.strip().splitlines() or [""])[-1]
    return re.sub(r"[*`$]", "", line).strip().rstrip(".")


NUMBER = re.compile(r"-?\d{1,3}(?:[ \u202f\u00a0]\d{3})+(?:[.,]\d+)?|-?\d[\d.,]*")


def parse_number(token: str):
    """English and German notation: 3,600 / 3.600 / 3 600 / 2.5 / 2,5."""
    token = re.sub(r"[ \u202f\u00a0]", "", token).rstrip(".,")
    if re.fullmatch(r"-?\d{1,3}(\.\d{3})+(,\d+)?", token):  # German thousands
        token = token.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"-?\d{1,3}(,\d{3})+(\.\d+)?", token):  # English thousands
        token = token.replace(",", "")
    elif re.fullmatch(r"-?\d+,\d+", token):  # German decimal comma
        token = token.replace(",", ".")
    try:
        return float(token)
    except ValueError:
        return None


def _number(text: str):
    match = NUMBER.search(final_answer(text))
    return parse_number(match.group()) if match else None


def _words(text: str) -> list[str]:
    return re.findall(r"[\wÄÖÜäöüß'-]+", text)


def _language(text: str) -> str:
    words = [w.lower() for w in _words(text)]
    de = sum(w in GERMAN for w in words) + 2 * len(re.findall(r"[äöüß]", text.lower()))
    en = sum(w in ENGLISH for w in words)
    return "de" if de > en else "en"


def _code(text: str) -> str:
    blocks = re.findall(r"```(?:python)?\n(.*?)```", text, re.S)
    return blocks[-1] if blocks else text


def run_python_tests(code: str, tests: str, timeout: float = 10.0) -> bool:
    """Run model-written code against tests in an isolated subprocess."""
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "candidate.py"
        path.write_text(code + "\n\n" + tests + "\n")
        try:
            result = subprocess.run(
                [sys.executable, "-I", str(path)],
                cwd=tmp,
                capture_output=True,
                timeout=timeout,
                env={"PATH": "/usr/bin:/bin"},
            )
        except subprocess.TimeoutExpired:
            return False
        return result.returncode == 0


def check(spec: dict, response: str) -> bool:
    text = visible(response)
    kind = spec["type"]
    if kind == "all":
        return all(check(part, response) for part in spec["checks"])
    if kind == "exact":
        return final_answer(text).lower() == str(spec["answer"]).strip().lower()
    if kind == "numeric":
        value = _number(text)
        return value is not None and abs(value - float(spec["answer"])) <= spec.get("tolerance", 1e-9)
    if kind == "contains_all":
        return all(term.lower() in text.lower() for term in spec["terms"])
    if kind == "excludes":
        return not any(term.lower() in text.lower() for term in spec["terms"])
    if kind == "regex":
        return re.search(spec["pattern"], text, re.S | re.M) is not None
    if kind == "json_keys":
        body = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        try:
            value = json.loads(body)
        except json.JSONDecodeError:
            return False
        return isinstance(value, dict) and set(spec["keys"]) <= set(value)
    if kind == "word_count":
        n = len(_words(text))
        return spec.get("min", 0) <= n <= spec.get("max", 10**9)
    if kind == "bullets":
        n = sum(1 for line in text.splitlines() if re.match(r"\s*([-*•]|\d+[.)])\s+", line))
        return n == spec["n"]
    if kind == "language":
        return _language(text) == spec["lang"]
    if kind == "ends_with":
        return text.rstrip().endswith(spec["text"])
    if kind == "no_commas":
        return "," not in text
    if kind == "python_tests":
        return run_python_tests(_code(text), spec["tests"], spec.get("timeout", 10.0))
    if kind == "ifeval":
        from .ifeval import check as ifeval_check

        return ifeval_check(spec, text)
    raise ValueError(f"unknown check type {kind!r}")


def _chat_openai(base_url: str, model: str, messages: list[dict], settings: dict) -> str:
    """One chat completion from an OpenAI-compatible server: Rouge Server
    (vLLM / SGLang) or Rouge Edge (llama.cpp llama-server)."""
    import os
    import urllib.request

    body = {
        "model": model, "messages": messages, "temperature": settings.get("temperature", 0.0),
        "max_tokens": settings["max_new_tokens"], "seed": settings.get("seed", 0),
        "chat_template_kwargs": {"enable_thinking": settings.get("enable_thinking", False)},
    }
    headers = {"Content-Type": "application/json"}
    if os.environ.get("ROUGE_API_KEY"):
        headers["Authorization"] = f"Bearer {os.environ['ROUGE_API_KEY']}"
    request = urllib.request.Request(f"{base_url.rstrip('/')}/chat/completions", json.dumps(body).encode(), headers)
    with urllib.request.urlopen(request, timeout=settings.get("timeout", 600)) as response:
        return json.loads(response.read())["choices"][0]["message"].get("content") or ""


def generate(model_path: str, items: list[dict], settings: dict) -> list[str]:
    """Responses from one model; identical settings for every model compared.

    Backends: `vllm` (offline engine), `transformers`, and `openai` -- any
    OpenAI-compatible endpoint at settings["base_url"], so Rouge Server and
    Rouge Edge are scored by the same harness as the training host.
    """
    if settings.get("backend") == "openai":
        from concurrent.futures import ThreadPoolExecutor

        with ThreadPoolExecutor(max_workers=settings.get("concurrency", 8)) as pool:
            return list(pool.map(lambda item: _chat_openai(settings["base_url"], model_path, item["messages"], settings), items))

    if settings.get("backend") == "vllm":
        from vllm import LLM, SamplingParams

        llm = LLM(model=model_path, seed=settings.get("seed", 0), max_model_len=settings.get("max_model_len", 16384))
        params = SamplingParams(temperature=settings.get("temperature", 0.0), max_tokens=settings["max_new_tokens"], seed=settings.get("seed", 0))
        prompts = [
            llm.get_tokenizer().apply_chat_template(
                item["messages"], tokenize=False, add_generation_prompt=True,
                enable_thinking=settings.get("enable_thinking", False),
            )
            for item in items
        ]
        return [out.outputs[0].text for out in llm.generate(prompts, params)]

    import torch
    from transformers import AutoModelForImageTextToText, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(model_path)
    model = AutoModelForImageTextToText.from_pretrained(model_path, dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32)
    if torch.cuda.is_available():
        model = model.to("cuda")
    model.eval()
    torch.manual_seed(settings.get("seed", 0))
    responses = []
    for item in items:
        text = tokenizer.apply_chat_template(
            item["messages"], tokenize=False, add_generation_prompt=True,
            enable_thinking=settings.get("enable_thinking", False),
        )
        ids = tokenizer(text, return_tensors="pt", add_special_tokens=False).to(model.device)
        with torch.no_grad():
            out = model.generate(
                **ids,
                max_new_tokens=settings["max_new_tokens"],
                do_sample=settings.get("temperature", 0.0) > 0,
                temperature=settings.get("temperature") or None,
                pad_token_id=tokenizer.pad_token_id or tokenizer.eos_token_id,
            )
        responses.append(tokenizer.decode(out[0, ids["input_ids"].shape[1] :], skip_special_tokens=True))
    return responses


def score(items: list[dict], responses: list[str]) -> list[bool]:
    return [check(item["check"], response) for item, response in zip(items, responses)]


def mcnemar_exact(b: int, c: int) -> float:
    n = b + c
    if n == 0:
        return 1.0
    tail = sum(math.comb(n, i) for i in range(min(b, c) + 1)) / 2**n
    return min(1.0, 2 * tail)


def compare(items: list[dict], base: list[bool], rouge: list[bool], seed: int = 0) -> dict:
    """Per-category and overall base-vs-Rouge comparison, regressions listed."""
    categories = sorted({item["category"] for item in items})
    per = {}
    for category in categories + ["overall"]:
        idx = [i for i, item in enumerate(items) if category == "overall" or item["category"] == category]
        wins = [items[i]["id"] for i in idx if rouge[i] and not base[i]]
        losses = [items[i]["id"] for i in idx if base[i] and not rouge[i]]
        per[category] = {
            "n": len(idx),
            "base": sum(base[i] for i in idx),
            "rouge": sum(rouge[i] for i in idx),
            "wins": len(wins),
            "regressions": len(losses),
            "regressed_ids": losses,
            "mcnemar_p": mcnemar_exact(len(wins), len(losses)),
        }
    deltas = [int(r) - int(b) for b, r in zip(base, rouge)]
    rng = random.Random(seed)
    means = sorted(
        sum(deltas[rng.randrange(len(deltas))] for _ in deltas) / len(deltas)
        for _ in range(2000)
    ) if deltas else [0.0]
    per["overall"]["diff"] = sum(deltas) / max(1, len(deltas))
    per["overall"]["ci95"] = [means[int(0.025 * len(means))], means[int(0.975 * len(means)) - 1]]
    return per


def verdict(items: list[dict], base: list[bool], rouge: list[bool], rule: dict) -> dict:
    """Apply a pre-registered decision rule (experiments/<name>.json).

    PASS needs both:
    - the primary suite improves: Rouge > base with McNemar p < alpha;
    - no guard category regresses: a drop of `guard_max_drop` or more, or
      any drop with p < alpha, fails the experiment.
    Report-only categories are listed, never decisive.
    """
    alpha, max_drop = rule["alpha"], rule["guard_max_drop"]

    def summary(idx: list[int]) -> dict:
        wins = sum(1 for i in idx if rouge[i] and not base[i])
        losses = sum(1 for i in idx if base[i] and not rouge[i])
        n = len(idx)
        return {"n": n, "base": sum(base[i] for i in idx), "rouge": sum(rouge[i] for i in idx), "wins": wins,
                "regressions": losses, "delta": (wins - losses) / max(1, n), "mcnemar_p": mcnemar_exact(wins, losses)}

    primary = summary([i for i, item in enumerate(items) if item.get("suite") == "primary"])
    primary_ok = primary["n"] > 0 and primary["rouge"] > primary["base"] and primary["mcnemar_p"] < alpha
    guards = {}
    for category in sorted({item["category"] for item in items if item.get("suite") == "guard"}):
        row = summary([i for i, item in enumerate(items) if item.get("suite") == "guard" and item["category"] == category])
        row["regressed"] = row["delta"] <= -max_drop or (row["delta"] < 0 and row["mcnemar_p"] < alpha)
        guards[category] = row
    report = {category: summary([i for i, item in enumerate(items) if item.get("suite") == "report" and item["category"] == category])
              for category in sorted({item["category"] for item in items if item.get("suite") == "report"})}
    passed = primary_ok and not any(row["regressed"] for row in guards.values())
    return {"result": "PASS" if passed else "FAIL", "primary": primary, "primary_improved": primary_ok,
            "guards": guards, "report_only": report, "rule": rule}
