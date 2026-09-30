"""Hard spend ceiling for Rouge training on RunPod (owner decision 2026-09-30: 50 EUR in total).

The ceiling covers everything billed for Rouge: GPU pods, CPU pods for data
preparation, and network-volume storage. RunPod bills USD; the ceiling is
converted at 1 EUR = 1.05 USD, below the market rate, so a USD figure that
passes here stays under 50 EUR. Every launch is checked against the
committed ledger (`ledger.json`): recorded actual costs, plus the worst case
of anything still running, plus the new launch's worst case, must fit.

    python training/rouge/runpod/cost.py status
    python training/rouge/runpod/cost.py check --price 3.99 --hours 1.5 [--volume-gb 40 --volume-months 1]
    python training/rouge/runpod/cost.py estimate --config configs/rouge-v1-100m.json --tokens 2e9 --price 3.99

Standard library only (the launcher imports it before any API call).
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

CEILING_EUR = 50.0
EUR_TO_USD = 1.05                       # conservative: the market rate is higher, so USD spend stays below the EUR ceiling
CEILING_USD = CEILING_EUR * EUR_TO_USD
VOLUME_USD_PER_GB_MONTH = 0.07          # RunPod network volume (published rate; the ledger records the billed amount)
LEDGER = Path(__file__).with_name("ledger.json")
H200_PEAK_BF16_TFLOPS = 989.0           # dense
DEFAULT_MFU = 0.30                      # planning assumption until the first run measures it


def load(path: Path = LEDGER) -> dict:
    return json.loads(path.read_text()) if path.exists() else {"schema": "rouge.runpod-ledger/1", "ceiling_eur": CEILING_EUR,
                                                               "eur_to_usd": EUR_TO_USD, "entries": []}


def save(ledger: dict, path: Path = LEDGER) -> None:
    path.write_text(json.dumps(ledger, indent=1) + "\n")


def committed(ledger: dict) -> float:
    """Actual cost of finished entries plus the worst case of open ones."""
    return round(sum(e["cost_usd"] if e.get("cost_usd") is not None else e["worst_case_usd"] for e in ledger["entries"]), 4)


def check(ledger: dict, worst_case_usd: float) -> float:
    """Remaining USD after this launch; raises SystemExit when the ceiling would be exceeded."""
    if not math.isfinite(worst_case_usd) or worst_case_usd <= 0:
        raise SystemExit(f"invalid worst case {worst_case_usd}")
    used = committed(ledger)
    remaining = CEILING_USD - used - worst_case_usd
    if remaining < 0:
        raise SystemExit(f"refused: {used:.2f} USD committed + {worst_case_usd:.2f} USD worst case exceeds the ceiling of "
                         f"{CEILING_USD:.2f} USD ({CEILING_EUR:.0f} EUR at {EUR_TO_USD})")
    return remaining


def worst_case(price_per_hour: float, hours: float, volume_gb: float = 0.0, volume_months: float = 0.0) -> float:
    return price_per_hour * hours + volume_gb * VOLUME_USD_PER_GB_MONTH * volume_months


def open_entry(ledger: dict, kind: str, name: str, price_per_hour: float, hours: float, worst: float, **extra) -> dict:
    entry = {"kind": kind, "name": name, "opened": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
             "price_per_hour": price_per_hour, "max_hours": hours, "worst_case_usd": round(worst, 4), "cost_usd": None, **extra}
    ledger["entries"].append(entry)
    return entry


def close_entry(entry: dict, seconds: float, price_per_hour: float | None = None) -> None:
    price = price_per_hour if price_per_hour is not None else entry["price_per_hour"]
    entry["seconds"] = round(seconds)
    entry["cost_usd"] = round(price * seconds / 3600, 4)   # RunPod bills pods per second
    entry["closed"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def estimate(flops_per_token_train: float, tokens: float, price: float, mfu: float = DEFAULT_MFU,
             peak_tflops: float = H200_PEAK_BF16_TFLOPS, overhead_hours: float = 0.5) -> dict:
    """Hours and USD for a training run on one H200 (overhead: boot, data check, evaluation, upload)."""
    train_hours = flops_per_token_train * tokens / (mfu * peak_tflops * 1e12) / 3600
    hours = train_hours + overhead_hours
    return {"train_flops": flops_per_token_train * tokens, "train_hours": round(train_hours, 3), "hours": round(hours, 3),
            "usd": round(hours * price, 2), "mfu_assumed": mfu}


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    c = sub.add_parser("check")
    c.add_argument("--price", type=float, required=True)
    c.add_argument("--hours", type=float, required=True)
    c.add_argument("--volume-gb", type=float, default=0.0)
    c.add_argument("--volume-months", type=float, default=0.0)
    e = sub.add_parser("estimate")
    e.add_argument("--config", required=True)
    e.add_argument("--tokens", type=float, required=True)
    e.add_argument("--price", type=float, required=True)
    e.add_argument("--mfu", type=float, default=DEFAULT_MFU)
    args = parser.parse_args()
    ledger = load()
    if args.cmd == "status":
        print(json.dumps({"ceiling_usd": CEILING_USD, "committed_usd": committed(ledger),
                          "remaining_usd": round(CEILING_USD - committed(ledger), 2), "entries": len(ledger["entries"])}, indent=1))
    elif args.cmd == "check":
        remaining = check(ledger, worst_case(args.price, args.hours, args.volume_gb, args.volume_months))
        print(f"ok: {remaining:.2f} USD would remain under the ceiling")
    else:
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from native import spec
        from native.config import RougeConfig

        s = spec.summary(RougeConfig.load(args.config))
        print(json.dumps({"params": s["params_physical"], **estimate(s["flops_per_token_train"], args.tokens, args.price, args.mfu)}, indent=1))


if __name__ == "__main__":
    main()
