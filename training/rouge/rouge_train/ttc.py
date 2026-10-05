"""Test-time compute: more answers per question, one chosen without looking at the solution.

The model writes k answers; the chosen one is the most frequent final answer (self-consistency,
Wang et al. 2022, arXiv 2203.11171). Only the model's own answers decide; the checker that knows the
solution scores the choice afterwards. The report also gives pass@k, which DOES look at the
solution: it is an upper bound for a perfect selector, never a result.

Only items whose answer can be compared (numbers, exact strings, a regex-checked value such as a
date) can vote; for the others (code, free text) the first answer counts, so the report states the
votable share. Compute grows k-fold per question; the report states that too, so a gain is never
quoted without its cost (Snell et al. 2024, arXiv 2408.03314).
"""

from __future__ import annotations

import re
from collections import Counter

from .evaluate import NUMBER, check, final_answer, parse_number, visible

VOTABLE = ("numeric", "exact", "regex")


def answer_key(spec: dict, response: str):
    """The comparable final answer of one response, or None when it has none."""
    text = visible(response)
    kind = spec["type"]
    if kind == "numeric":
        match = NUMBER.search(final_answer(text))
        value = parse_number(match.group()) if match else None
        return None if value is None else round(value, 9)
    if kind == "exact":
        return final_answer(text).strip().lower() or None
    if kind == "regex":
        # a regex check marks a value inside free text (e.g. an ISO date): vote on the last such value
        dates = re.findall(r"\d{4}-\d{2}-\d{2}", text)
        return dates[-1] if dates else (final_answer(text).strip().lower() or None)
    return None


def choose(spec: dict, responses: list[str]) -> int:
    """Index of the majority answer; ties go to the earliest; no comparable answer -> the first response."""
    if spec["type"] not in VOTABLE:
        return 0
    keys = [answer_key(spec, r) for r in responses]
    counts = Counter(k for k in keys if k is not None)
    if not counts:
        return 0
    best = max(counts.values())
    winner = next(k for k in keys if k is not None and counts[k] == best)
    return keys.index(winner)


def report(items: list[dict], samples: dict[str, list[str]]) -> dict:
    """pass@1 (first answer), maj@k (majority choice) and the oracle pass@k bound, per category and overall."""
    rows, by_cat = [], {}
    for item in items:
        responses = samples.get(item["id"])
        if not responses:
            continue
        spec = item["check"]
        correct = [check(spec, r) for r in responses]
        chosen = choose(spec, responses)
        row = {"id": item["id"], "category": item.get("category", "all"), "k": len(responses),
               "votable": spec["type"] in VOTABLE, "pass1": correct[0], "maj": correct[chosen],
               "oracle": any(correct)}
        rows.append(row)
        by_cat.setdefault(row["category"], []).append(row)

    def summary(rs: list[dict]) -> dict:
        n = len(rs)
        return {"n": n, "pass@1": round(sum(r["pass1"] for r in rs) / n, 4), "maj@k": round(sum(r["maj"] for r in rs) / n, 4),
                "oracle_pass@k (bound, not a result)": round(sum(r["oracle"] for r in rs) / n, 4),
                "votable_share": round(sum(r["votable"] for r in rs) / n, 4),
                "maj_better": sum(r["maj"] and not r["pass1"] for r in rs),
                "maj_worse": sum(r["pass1"] and not r["maj"] for r in rs)}

    if not rows:
        raise SystemExit("no item has samples")
    ks = sorted({r["k"] for r in rows})
    return {"schema": "rouge.ttc-report/1", "k": ks[0] if len(ks) == 1 else ks,
            "compute_multiplier": f"{ks[-1]}x generated tokens per question vs. one answer",
            "overall": summary(rows), "by_category": {c: summary(rs) for c, rs in sorted(by_cat.items())}, "items": rows}
