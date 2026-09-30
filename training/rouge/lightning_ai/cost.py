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

# Owner, 2026-09-30: after the free resources, 125 credits for training on B200 GPUs. The ceiling counts every
# Rouge job on Lightning: 125 USD-equivalent credits for that phase plus the 3.66 USD spent before it.
EUR_TO_USD = 1.05
CEILING_USD = 128.66
LEDGER = Path(__file__).with_name("ledger.json")
# Training machines: one large GPU or a node of several small ones (owner, 2026-09-30: "several small
# GPUs with the same total performance do it too"). Per GPU family: dense fp16/bf16 tensor TFLOPS
# (NVIDIA datasheets; T4 has no bf16 and trains in fp16 with loss scaling), memory in GB, and a price
# ceiling per GPU-hour: about 1.25x the cheapest live on-demand price this account was offered on
# 2026-09-30 (results/lightning/machines.json: T4 0.69, L4 0.79, L40S 3.54, H100 5.68, H200 4.50 on a
# second cloud account and 6.53 on the default one). The launcher takes the cheapest cloud account
# at the live price, refuses a price above the ceiling, and books the live price as the worst case.
GPU = {  # family: (peak TFLOPS, memory GB, price ceiling USD per GPU-hour)
    "T4": (65.0, 16, 0.90), "L4": (121.0, 24, 1.55), "L40S": (362.0, 48, 4.45),
    "H100": (989.0, 80, 7.10), "H200": (989.0, 141, 7.00),
    # A100: Lightning's free hours cover it (pricing page 2026-09-30: A100 40 GB 10 h, 80 GB 5 h; H100/H200 none)
    "A100_40GB": (312.0, 40, 2.75), "A100_80GB": (312.0, 80, 3.40),
    # B200: 2.25 PFLOPS dense bf16 per GPU (NVIDIA datasheet; FP8 doubles it); live 9.86 USD/h, no interruptible
    "B200": (2250.0, 180, 12.30),
}
TRAINING_MACHINES = ("T4_X_4", "T4_X_8", "L4_X_4", "L4_X_8", "L40S", "L40S_X_4", "A100_40GB", "A100_80GB", "H100", "H200", "B200", "B200_X_8")
MULTI_GPU_EFFICIENCY = 0.90   # planning assumption for data parallel over PCIe (no NVLink) until measured
DEFAULT_MFU = 0.30            # planning assumption per GPU until a run on that family measures it


def gpus(machine: str) -> tuple[str, int]:
    """'T4_X_4' -> ('T4', 4); 'H100' -> ('H100', 1)."""
    family, _, count = machine.partition("_X_")
    return family, int(count or 1)


def mfu(machine: str, path: Path = Path(__file__).resolve().parents[1] / "results/lightning/mfu.json") -> float:
    """MFU measured on this GPU family by an earlier run (results/lightning/mfu.json), else DEFAULT_MFU."""
    try:
        return float(json.loads(path.read_text())[gpus(machine)[0]]["mfu"])
    except (OSError, KeyError, ValueError, TypeError):
        return DEFAULT_MFU


PAID_PRICE_CEILING = {m: round(GPU[gpus(m)[0]][2] * gpus(m)[1], 2) for m in TRAINING_MACHINES}
PEAK_TFLOPS = {m: GPU[gpus(m)[0]][0] * gpus(m)[1] * (MULTI_GPU_EFFICIENCY if gpus(m)[1] > 1 else 1.0)
               for m in TRAINING_MACHINES}   # effective peak of the whole machine


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
                         f"{CEILING_USD:.2f} USD")
    return remaining


def worst_case(machine: str, hours: float, price: float | None = None) -> float:
    """USD for `hours` at the live `price` plus 5% (price changes, rounding), or at the ceiling when unknown."""
    if machine not in PAID_PRICE_CEILING:
        raise SystemExit(f"{machine} is not a training machine (allowed: {sorted(PAID_PRICE_CEILING)})")
    if price is not None and float(price) > PAID_PRICE_CEILING[machine]:
        raise SystemExit(f"{machine}: live price {price} USD/h exceeds its ceiling {PAID_PRICE_CEILING[machine]} USD/h")
    return (float(price) * 1.05 if price else PAID_PRICE_CEILING[machine]) * hours


def estimate(flops_per_token_train: float, tokens: float, price: float, mfu: float = DEFAULT_MFU,
             peak_tflops: float = 989.0, overhead_hours: float = 0.5) -> dict:
    """Hours and USD for a training run on one machine (`peak_tflops`: whole machine, see PEAK_TFLOPS;
    overhead: boot, install, data transfer, evaluation, upload)."""
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
    c = sub.add_parser("compare", help="every training machine for one run, cheapest first (live prices if probed)")
    c.add_argument("--config", required=True)
    c.add_argument("--tokens", type=float, required=True)
    c.add_argument("--mfu", type=float, help="override the measured or default MFU of every family")
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
    if args.cmd == "estimate":
        print(json.dumps({"params": s["params_physical"], "machine": args.machine,
                          **estimate(s["flops_per_token_train"], args.tokens, PAID_PRICE_CEILING[args.machine], args.mfu,
                                     PEAK_TFLOPS[args.machine])}, indent=1))
        return
    print(json.dumps(compare(s["flops_per_token_train"], args.tokens, args.mfu), indent=1))


def live_prices(path: Path = Path(__file__).resolve().parents[1] / "results/lightning/machines.json") -> dict:
    """{machine: {"usd_per_hour": .., "interruptible_usd_per_hour": ..}} from the last probe, or {}."""
    if not path.exists():
        return {}
    return {m["name"]: m for m in json.loads(path.read_text()).get("machines", []) if m.get("name")}


def compare(flops_per_token_train: float, tokens: float, assumed_mfu: float | None = None) -> list:
    live, rows = live_prices(), []
    for m in TRAINING_MACHINES:
        seen = live.get(m, {})
        for mode, price in (("on-demand", seen.get("usd_per_hour") or PAID_PRICE_CEILING[m]),
                            ("interruptible", seen.get("interruptible_usd_per_hour"))):
            if not price:
                continue
            e = estimate(flops_per_token_train, tokens, float(price), assumed_mfu or mfu(m), PEAK_TFLOPS[m])
            rows.append({"machine": m, "mode": mode, "usd_per_hour": float(price), "price": "live" if seen else "ceiling",
                         "mfu": e["mfu_assumed"], "hours": e["hours"], "usd": e["usd"], "gpu_memory_gb": GPU[gpus(m)[0]][1]})
    return sorted(rows, key=lambda r: r["usd"])


if __name__ == "__main__":
    main()
