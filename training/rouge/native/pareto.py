"""Pre-registered selection rule of the Architecture v1 tournament (configs/native/tournament-v1.json).

Input: run records, one per (level, candidate, seed), each the trainer's
result JSON plus {"level", "candidate", "seed", "size"}. Output: per-
candidate metrics, eligibility, weighted rank sums, the decision and a
Markdown table. The rule is data in the tournament file; this module only
applies it, so a candidate never decides whether it passed.

    python -m native.pareto --tournament configs/native/tournament-v1.json --runs runs.jsonl --level B
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
from pathlib import Path

LOWER_IS_BETTER = {"quality": True, "tasks": False, "long_context": False, "stored_bytes": True, "train_flops": True,
                   "kv_32k": True, "throughput": False, "scaling": False, "stability": True}


def run_metrics(r: dict) -> dict | None:
    """Metrics of one run, or None when the run diverged or has no evaluation."""
    ev = r.get("eval") or {}
    q = ev.get("val_bpb_mean")
    loss = r.get("final_train_loss")
    if q is None or not math.isfinite(q) or loss is None or not math.isfinite(loss):
        return None
    tasks = ev.get("tasks") or {}
    passkey = ev.get("passkey") or {}
    spec = r["spec"]
    return {
        "quality": q,
        "tasks": statistics.mean(tasks.values()) if tasks else 0.0,
        "long_context": statistics.mean(passkey.values()) if passkey else 0.0,
        "stored_bytes": spec["stored_bytes"],
        "train_flops": spec["flops_per_token_train"],
        "kv_32k": spec["kv_bytes"]["32k"],
        "throughput": r["tokens"] / max(1e-9, r["train_seconds"]),
    }


def ranks(values: dict, lower_better: bool) -> dict:
    """Average ranks (1 = best) over candidates."""
    order = sorted(values, key=lambda c: values[c] if lower_better else -values[c])
    out, i = {}, 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        for c in order[i:j + 1]:
            out[c] = (i + j) / 2 + 1
        i = j + 1
    return out


def decide(tournament: dict, runs: list[dict], level: str, level_b_runs: list[dict] | None = None) -> dict:
    rule = tournament["pareto"]
    spec = tournament["levels"][level]
    seeds = spec["seeds"]
    by_cand: dict[str, list] = {}
    for r in runs:
        if r["level"] == level:
            by_cand.setdefault(r["candidate"], []).append(r)
    table, disqualified = {}, {}
    for cand, rs in sorted(by_cand.items()):
        got = {r["seed"] for r in rs}
        per = [run_metrics(r) for r in rs]
        if set(seeds) - got:
            disqualified[cand] = f"missing seeds {sorted(set(seeds) - got)}"
            continue
        if any(m is None for m in per):
            disqualified[cand] = "a run diverged or has no evaluation"
            continue
        row = {k: statistics.mean(m[k] for m in per) for k in per[0]}
        row["quality_sd"] = statistics.stdev([m["quality"] for m in per]) if len(per) > 1 else 0.0
        row["seeds"] = sorted(got)
        table[cand] = row
    if "A" not in table:
        return {"level": level, "complete": False, "reason": "baseline A missing or disqualified",
                "table": table, "disqualified": disqualified}

    base_q = table["A"]["quality"]
    criteria = [k for k in rule["weights"] if k not in ("scaling", "stability")]
    if level == "C":
        criteria += ["stability"]
        for c, row in table.items():
            row["stability"] = row["quality_sd"]
        if level_b_runs:
            small = {r["candidate"]: run_metrics(r) for r in level_b_runs if r["level"].startswith("B") and r["seed"] == 1}
            large = {r["candidate"]: run_metrics(r) for r in runs if r["level"] == "C" and r["seed"] == 1}
            gains = {c: small[c]["quality"] - large[c]["quality"] for c in table if small.get(c) and large.get(c)}
            if "A" in gains and len(gains) == len(table):
                criteria += ["scaling"]
                for c in table:
                    table[c]["scaling"] = gains[c] - gains["A"]
    def within(q, margin):  # rounded: a difference equal to the margin passes (no float edge cases)
        return round(q - base_q, 6) <= margin

    eligible = {c for c, row in table.items() if within(row["quality"], rule["quality_gate_bpb"])}
    score = {c: 0.0 for c in eligible}
    rank_table = {}
    for k in criteria:
        rk = ranks({c: table[c][k] for c in eligible}, LOWER_IS_BETTER[k])
        rank_table[k] = rk
        for c in eligible:
            score[c] += rule["weights"][k] * rk[c]
    winner = min(eligible, key=lambda c: (score[c], table[c]["quality"]))
    result = {"level": level, "complete": True, "baseline_quality": base_q, "criteria": criteria,
              "eligible": sorted(eligible), "score": score, "ranks": rank_table, "winner": winner,
              "table": table, "disqualified": disqualified}
    if level.startswith("B"):
        others = [c for c in sorted(table, key=lambda c: (score.get(c, math.inf), table[c]["quality"]))
                  if c != "A" and within(table[c]["quality"], rule["level_b_drop_bpb"])]
        result["finalists"] = ["A"] + others[: rule["finalists"] - 1]
    return result


def markdown(d: dict) -> str:
    if not d.get("complete"):
        return f"Level {d['level']}: incomplete ({d.get('reason')})."
    cols = ["quality", "tasks", "long_context", "stored_bytes", "train_flops", "kv_32k", "throughput"]
    cols += [c for c in ("stability", "scaling") if c in d["criteria"]]
    lines = ["| candidate | " + " | ".join(cols) + " | eligible | score |", "|---" * (len(cols) + 3) + "|"]
    for c, row in sorted(d["table"].items()):
        cells = []
        for k in cols:
            v = row.get(k)
            cells.append("" if v is None else (f"{v:.4f}" if abs(v) < 100 else f"{v:.3g}"))
        lines.append(f"| {c} | " + " | ".join(cells) + f" | {'yes' if c in d['eligible'] else 'no'} | "
                     + (f"{d['score'][c]:.1f}" if c in d["score"] else "") + " |")
    for c, why in d["disqualified"].items():
        lines.append(f"| {c} | disqualified: {why} |")
    lines.append("")
    lines.append(f"Winner: **{d['winner']}**" + (f"; finalists for Level C: {', '.join(d['finalists'])}" if "finalists" in d else ""))
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tournament", required=True)
    parser.add_argument("--runs", required=True, help="JSONL of run records")
    parser.add_argument("--level", choices=["B", "B-cpu", "C"], required=True)
    parser.add_argument("--out")
    args = parser.parse_args()
    tournament = json.loads(Path(args.tournament).read_text())
    runs = [json.loads(l) for l in Path(args.runs).read_text().splitlines() if l.strip()]
    d = decide(tournament, runs, args.level, level_b_runs=runs)
    print(markdown(d))
    if args.out:
        Path(args.out).write_text(json.dumps(d, indent=1))


if __name__ == "__main__":
    main()
