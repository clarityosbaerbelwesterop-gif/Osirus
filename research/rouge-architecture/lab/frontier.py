"""R1.31: the measured Pareto frontiers of every suite-v3 model trained so far.

All suite-v3 experiments share one training budget (batch 64, 15,000 steps,
lr 1e-3, 3 seeds), so their models can be placed on one chart. For each
cost axis (stored weight bytes, inference FLOPs per example, inference
memory) a model is on the frontier when no other model reaches at least its
dev accuracy at no more cost. A configuration that appears in several
experiments (the baseline Transformer) keeps its latest measurement.

    python lab/frontier.py            # prints markdown, writes results/r1.31/frontier.json

The 1 / 5 / 40 GB table is capacity arithmetic (how many weights of each
format fit), not a capability measurement.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AXES = {"stored_bytes": "stored weights", "flops": "inference FLOPs / example", "total_bytes": "inference memory"}
FORMATS = {"fp32": 4.0, "bf16": 2.0, "int8": 1.0, "int4": 0.5, "ternary, 2-bit packed": 0.25, "ternary, 1.58-bit ideal": 1.58 / 8}


def _value(m):
    return m["mean"] if isinstance(m, dict) else m


def points() -> list[dict]:
    seen: dict[str, dict] = {}
    for prereg_path in sorted(ROOT.glob("experiments/r1_*.json")):
        prereg = json.loads(prereg_path.read_text())
        if "suite3" not in (prereg.get("benchmarks") or [""])[0]:
            continue
        summary_path = ROOT / "results" / prereg["id"].lower() / "summary.json"
        if not summary_path.exists():
            continue
        summary = json.loads(summary_path.read_text())
        for name, row in summary["models"].items():
            config = prereg["setup"]["models"][name]
            key = json.dumps(config, sort_keys=True)
            mt = row["metrics"]
            seen[key] = {
                "model": name, "experiment": prereg["id"], "config": config,
                "dev": mt["dev.all"]["mean"], "dev_sd": mt["dev.all"]["sd"], "ood": mt["ood.all"]["mean"],
                "stored_bytes": _value(mt.get("stored_bytes", 4 * mt["params"])), "flops": _value(mt["flops"]),
                "total_bytes": _value(mt["total_bytes"]),
            }
    return sorted(seen.values(), key=lambda p: p["stored_bytes"])


def frontier(pts: list[dict], axis: str) -> list[dict]:
    """Points not dominated on (cost on `axis` lower or equal, dev higher or equal, one strictly)."""
    out = []
    for p in pts:
        dominated = any(q is not p and q[axis] <= p[axis] and q["dev"] >= p["dev"] and (q[axis] < p[axis] or q["dev"] > p["dev"])
                        for q in pts)
        if not dominated:
            out.append(p)
    return sorted(out, key=lambda p: p[axis])


def _fmt(axis, v):
    return f"{v / 1e6:.1f} M" if axis == "flops" else f"{v / 1024:.0f} KiB"


def markdown(pts: list[dict]) -> str:
    lines = []
    for axis, label in AXES.items():
        lines += [f"### Frontier: dev accuracy vs {label}", "", f"| model (experiment) | {label} | dev | OOD |", "|---|---|---|---|"]
        for p in frontier(pts, axis):
            lines.append(f"| {p['model']} ({p['experiment']}) | {_fmt(axis, p[axis])} | {100 * p['dev']:.1f} ± {100 * p['dev_sd']:.1f} | {100 * p['ood']:.1f} |")
        lines.append("")
    lines += ["### Weights that fit a storage budget (arithmetic, not capability)", "",
              "| format | bytes / weight | 1 GB | 5 GB | 40 GB |", "|---|---|---|---|---|"]
    for name, b in FORMATS.items():
        lines.append(f"| {name} | {b:g} | " + " | ".join(f"{gb * 1e9 / b / 1e9:.2f} B" for gb in (1, 5, 40)) + " |")
    return "\n".join(lines) + "\n"


def main() -> None:
    pts = points()
    out = ROOT / "results" / "r1.31"
    out.mkdir(parents=True, exist_ok=True)
    (out / "frontier.json").write_text(json.dumps(
        {"points": pts, "frontiers": {a: [p["model"] + " (" + p["experiment"] + ")" for p in frontier(pts, a)] for a in AXES}}, indent=1) + "\n")
    print(f"{len(pts)} distinct configurations\n")
    print(markdown(pts))


if __name__ == "__main__":
    main()
