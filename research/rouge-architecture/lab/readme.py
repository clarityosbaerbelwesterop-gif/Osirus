"""Result tables for a results/<id>/README.md, generated from summary.json
and the pre-registration so no number is typed by hand.

    python lab/readme.py experiments/r1_26.json [--extra ood.recall ...]

Prints two markdown tables:
- the scorecard (mean ± sd over seeds): dev, OOD, adversarial, extra metrics,
  FLOPs per example, stored bytes, inference memory, latency, train time;
- the pre-registered checks with both sides, the margin, and for seed-level
  comparisons the Welch 95% interval of the difference. A check that holds
  on the means while its interval includes the threshold is marked
  "within seed noise": the gate decides, the interval says how firmly.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lab.stats import T95  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
PERCENT = ("dev.", "ood.", "adv.", "holdout.", "var.", "above_cue.")


def _is_rate(metric: str) -> bool:
    return metric.startswith(PERCENT) and not metric.endswith((".flops", ".steps")) and "auroc" not in metric and ".ece" not in metric


def _fmt(metric: str, m) -> str:
    mean = m["mean"] if isinstance(m, dict) else m
    sd = m.get("sd", 0) if isinstance(m, dict) else 0
    if _is_rate(metric):
        return f"{100 * mean:.1f} ± {100 * sd:.1f}"
    if metric.endswith("flops"):
        return f"{mean / 1e6:.1f} M"
    if metric.endswith("bytes"):
        return f"{mean / 1024:.0f} KiB"
    if metric == "latency_ms":
        return f"{mean:.2f} ms"
    if metric == "throughput_bytes_s":
        return f"{mean:,.0f} B/s"
    if metric.endswith(".bpb") or metric.startswith("stream."):
        return f"{mean:.3f} ± {sd:.3f}"
    if metric == "train_seconds":
        return f"{mean / 60:.0f} min"
    return f"{mean:.3f}" if abs(mean) < 10 else f"{mean:.0f}"


def scorecard(summary: dict, extra: list[str]) -> str:
    language_model = "valid.bpb" in next(iter(summary["models"].values()))["metrics"]
    if language_model:  # bits per byte (lower is better), FLOPs per byte, throughput
        cols = ["valid.bpb", "test.bpb", *extra, "flops", "stored_bytes", "total_bytes", "throughput_bytes_s", "train_seconds"]
    else:
        cols = ["dev.all", "ood.all", "adv.all", *extra, "flops", "stored_bytes", "total_bytes", "latency_ms", "train_seconds"]
    names = {"dev.all": "dev", "ood.all": "OOD", "adv.all": "adversarial",
             "flops": "FLOPs / byte" if language_model else "FLOPs / example", "throughput_bytes_s": "stream throughput",
             "valid.bpb": "valid BPB", "test.bpb": "test BPB",
             "stored_bytes": "stored weights", "total_bytes": "inference memory", "latency_ms": "latency",
             "train_seconds": "train time"}
    lines = ["| model | " + " | ".join(names.get(c, c) for c in cols) + " |", "|---" * (len(cols) + 1) + "|"]
    for model, row in summary["models"].items():
        mt = row["metrics"]
        lines.append(f"| {model} | " + " | ".join(_fmt(c, mt[c]) if c in mt else "–" for c in cols) + " |")
    return "\n".join(lines)


def _side(table, ref):
    model, metric = ref.split(":", 1)
    return metric, table[model]["metrics"][metric]


def _welch(a: list[float], b: list[float]) -> tuple[float, float] | None:
    if len(a) < 2 or len(b) < 2:
        return None
    va = sum((x - sum(a) / len(a)) ** 2 for x in a) / (len(a) - 1) / len(a)
    vb = sum((x - sum(b) / len(b)) ** 2 for x in b) / (len(b) - 1) / len(b)
    se = math.sqrt(va + vb)
    if se == 0:
        return (0.0, 0.0)
    df = (va + vb) ** 2 / ((va ** 2 / (len(a) - 1) if va else 0) + (vb ** 2 / (len(b) - 1) if vb else 0) or 1e-12)
    t = T95.get(max(1, int(df)), 1.96)
    return (se * t, df)


def checks(summary: dict, gate: dict) -> str:
    table, result = summary["models"], summary["decision"].get("checks", {})
    lines = ["| check | left | right (threshold) | holds | difference, 95% interval |", "|---|---|---|---|---|"]
    for name, spec in gate["checks"].items():
        try:
            lm, left = _side(table, spec["left"])
        except KeyError:
            lines.append(f"| {name} | missing | | – | |")
            continue
        lmean = left["mean"] if isinstance(left, dict) else left
        if "right" in spec:
            rm, right = _side(table, spec["right"])
            rmean = right["mean"] if isinstance(right, dict) else right
            threshold = rmean * spec.get("times", 1) + spec.get("plus", 0)
            rtext = f"{spec['right']} = {_fmt(rm, right).split(' ±')[0]}"
        else:
            rm, right, threshold = lm, None, spec["value"]
            rtext = "value"
        mod = (f" × {spec['times']}" if "times" in spec else "") + (f" {spec['plus']:+g}" if "plus" in spec else "")
        interval = ""
        if isinstance(left, dict) and isinstance(right, dict) and spec.get("times", 1) == 1:
            half = _welch(left["values"], right["values"])
            if half is not None:
                diff = lmean - rmean
                if _is_rate(lm):
                    interval = f"{100 * diff:+.1f} ± {100 * half[0]:.1f}"
                else:
                    interval = f"{diff:+.3f} ± {half[0]:.3f}"
                margin = diff - spec.get("plus", 0)
                if result.get(name) and abs(margin) < half[0]:
                    interval += " (within seed noise)"
        shown = f"{100 * threshold:.1f}" if _is_rate(lm) else _fmt(lm, threshold)
        holds = {True: "**yes**", False: "no"}.get(result.get(name), "–")
        lines.append(f"| {name} | {spec['left']} = {_fmt(lm, left).split(' ±')[0]} | {spec['op']} {rtext}{mod} → {shown} | {holds} | {interval} |")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("prereg")
    parser.add_argument("--extra", nargs="*", default=[])
    args = parser.parse_args()
    prereg = json.loads(Path(args.prereg).read_text())
    summary = json.loads((ROOT / "results" / prereg["id"].lower() / "summary.json").read_text())
    print(scorecard(summary, args.extra))
    print()
    print(checks(summary, prereg["setup"]["gate"]))


if __name__ == "__main__":
    main()
