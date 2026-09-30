"""Hard spend ceiling for Rouge on Lightning AI (owner decisions 2026-09-30: 50 EUR in total; Lightning
replaces RunPod for GPU training, storage and the model repository).

The ceiling covers every Lightning job of Rouge, small (tournament, dry runs) and large (training
rungs), as recorded in `ledger.json` (written by job.py: actual cost of finished jobs, worst case of
running ones). Lightning bills USD-equivalent credits; the ceiling is converted at 1 EUR = 1.05 USD,
below the market rate, so a USD figure that passes here stays under 50 EUR. A launch must fit:
    committed + worst case of the new job <= ceiling, and worst case <= teamspace balance - margin.

    python training/rouge/lightning_ai/cost.py status
    python training/rouge/lightning_ai/cost.py estimate --config configs/native/rouge-v1-100m.json --tokens 2e9 --machine H100

Standard library only.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

CEILING_EUR = 50.0
EUR_TO_USD = 1.05
CEILING_USD = CEILING_EUR * EUR_TO_USD
LEDGER = Path(__file__).with_name("ledger.json")
# Conservative ceilings per machine-hour for the paid path (published on-demand prices are lower:
# H100 about $3.29/h, H200 about $6.53/h; the ledger records the actual cost Lightning reports).
PAID_PRICE_CEILING = {"H100": 4.00, "H200": 7.00}
PEAK_BF16_TFLOPS = {"H100": 989.0, "H200": 989.0}   # dense; equal compute, H200 has more memory
DEFAULT_MFU = 0.30                                  # planning assumption until the first run measures it


def load(path: Path = LEDGER) -> dict:
    return json.loads(path.read_text()) if path.exists() else {"schema": "rouge.lightning-ledger/1", "months": {}}


def committed(ledger: dict) -> float:
    """Actual cost of finished jobs plus the worst case of open ones, over every month."""
    return round(sum(j["cost_usd"] if j.get("cost_usd") is not None else j.get("worst_case_usd", 0.0)
                     for m in ledger.get("months", {}).values() for j in m.get("jobs", [])), 4)


def check(ledger: dict, worst_case_usd: float) -> float:
    """USD left under the ceiling after this launch; SystemExit when the ceiling would be exceeded."""
    if not math.isfinite(worst_case_usd) or worst_case_usd <= 0:
        raise SystemExit(f"invalid worst case {worst_case_usd}")
    used = committed(ledger)
    remaining = CEILING_USD - used - worst_case_usd
    if remaining < 0:
        raise SystemExit(f"refused: {used:.2f} USD committed + {worst_case_usd:.2f} USD worst case exceeds the ceiling of "
                         f"{CEILING_USD:.2f} USD ({CEILING_EUR:.0f} EUR at {EUR_TO_USD})")
    return remaining


def worst_case(machine: str, hours: float) -> float:
    if machine not in PAID_PRICE_CEILING:
        raise SystemExit(f"{machine} is not a training machine (allowed: {sorted(PAID_PRICE_CEILING)})")
    return PAID_PRICE_CEILING[machine] * hours


def estimate(flops_per_token_train: float, tokens: float, price: float, mfu: float = DEFAULT_MFU,
             peak_tflops: float = 989.0, overhead_hours: float = 0.5) -> dict:
    """Hours and USD for a training run on one GPU (overhead: boot, install, data transfer, evaluation, upload)."""
    train_hours = flops_per_token_train * tokens / (mfu * peak_tflops * 1e12) / 3600
    hours = train_hours + overhead_hours
    return {"train_flops": flops_per_token_train * tokens, "train_hours": round(train_hours, 3), "hours": round(hours, 3),
            "usd": round(hours * price, 2), "mfu_assumed": mfu}


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    e = sub.add_parser("estimate")
    e.add_argument("--config", required=True)
    e.add_argument("--tokens", type=float, required=True)
    e.add_argument("--machine", default="H100", choices=sorted(PAID_PRICE_CEILING))
    e.add_argument("--mfu", type=float, default=DEFAULT_MFU)
    args = parser.parse_args()
    ledger = load()
    if args.cmd == "status":
        print(json.dumps({"ceiling_usd": CEILING_USD, "committed_usd": committed(ledger),
                          "remaining_usd": round(CEILING_USD - committed(ledger), 2)}, indent=1))
        return
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from native import spec
    from native.config import RougeConfig

    s = spec.summary(RougeConfig.load(args.config))
    print(json.dumps({"params": s["params_physical"], "machine": args.machine,
                      **estimate(s["flops_per_token_train"], args.tokens, PAID_PRICE_CEILING[args.machine], args.mfu,
                                 PEAK_BF16_TFLOPS[args.machine])}, indent=1))


if __name__ == "__main__":
    main()
