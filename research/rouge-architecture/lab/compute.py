#!/usr/bin/env python3
"""Compute router: which runner may run a pre-registered experiment.

    python lab/compute.py experiments/r1_02.json [--runner auto|github|self-hosted|gpu]

Prints one JSON line: tier, runs_on (a GitHub Actions `runs-on` value) and
the reason. Tiers, lowest first; an experiment always gets the lowest one
that fits:

- 0  GitHub-hosted CPU (free): <= 300M parameters, fits the runner's RAM
     and its 6 h job limit.
- 1  owner's server, CPU or Apple silicon: self-hosted runner with labels
     [self-hosted, rouge-research].
- 2  owner's GPU: [self-hosted, rouge-research, gpu].
- 3  rented H200: NEVER selected here. The router refuses; renting needs
     the evidence list in docs/rouge/research and the owner's approval,
     outside any automation.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path

GITHUB_CPU_FLOPS = 34e9          # sustained training FLOP/s per 4-vCPU runner: lowest measured (R1.02b, 105 tokens); 58-78 G at 40-60 tokens
GITHUB_RAM_GB = 14               # 16 GB runner, 2 GB headroom
GITHUB_HOURS = 5.3               # train budget per job (--budget-min 320), inside the 6 h job limit
MAX_CHUNKS = 3                   # a longer run resumes across up to 3 attempts ("Re-run failed jobs")
TIER0_PARAMS = 300e6
RUNS_ON = {
    0: "ubuntu-latest",
    1: ["self-hosted", "rouge-research"],
    2: ["self-hosted", "rouge-research", "gpu"],
}


def estimate(prereg: dict) -> dict:
    setup = prereg["setup"]
    est = prereg.get("compute", {})
    params = max(setup.get("parameters", {}).values(), default=0) or est.get("parameters", 0)
    tokens = setup["steps"] * setup["batch"] * est.get("tokens_per_example", 40)
    # 6 N T is the dense-Transformer rule; recurrent models declare their own
    # measured per-run figure in compute.train_flops_per_run.
    flops = est.get("train_flops_per_run", 6 * params * tokens)
    return {"parameters": params, "train_flops_per_run": flops,
            "cpu_hours": flops / GITHUB_CPU_FLOPS / 3600, "memory_gb": est.get("memory_gb", 1),
            "needs_gpu": bool(est.get("needs_gpu", False)), "needs_h200": bool(est.get("needs_h200", False))}


def route(prereg: dict, runner: str = "auto", self_hosted: bool | None = None) -> dict:
    if self_hosted is None:  # repository variable ROUGE_SELF_HOSTED=1 once the server runner is registered
        self_hosted = os.environ.get("ROUGE_SELF_HOSTED") == "1"
    e = estimate(prereg)
    if e["needs_h200"]:
        return {"tier": 3, "runs_on": None, "estimate": e,
                "reason": "tier 3 (H200) is never selected automatically; it needs the owner's approval"}
    if e["needs_gpu"]:
        tier, why = 2, "declares needs_gpu"
    elif e["parameters"] > TIER0_PARAMS or e["memory_gb"] > GITHUB_RAM_GB:
        tier, why = 1, f"too large for a GitHub runner ({e['parameters']:.3g} params, {e['memory_gb']} GB)"
    elif e["cpu_hours"] > GITHUB_HOURS:
        chunks = math.ceil(e["cpu_hours"] / GITHUB_HOURS)
        if self_hosted:
            tier, why = 1, f"{e['cpu_hours']:.1f} CPU h per run: the owner's server"
        elif chunks <= MAX_CHUNKS:
            tier, why = 0, f"{e['cpu_hours']:.1f} CPU h per run: free GitHub runner in {chunks} resumable attempts (no self-hosted runner registered)"
        else:
            tier, why = 1, f"{e['cpu_hours']:.1f} CPU h per run needs the owner's server (> {MAX_CHUNKS} GitHub attempts)"
    else:
        tier, why = 0, f"fits a free GitHub runner ({e['cpu_hours']:.2f} CPU h per run)"
    forced = {"github": 0, "self-hosted": 1, "gpu": 2}.get(runner)
    if forced is not None:
        if forced < tier:
            why += f"; forced to {runner} although tier {tier} is estimated (the run may hit its limits)"
        else:
            why = f"{runner} requested; {why}"
        tier = forced
    return {"tier": tier, "runs_on": RUNS_ON[tier], "estimate": e, "reason": why}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("prereg")
    parser.add_argument("--runner", default="auto", choices=["auto", "github", "self-hosted", "gpu"])
    args = parser.parse_args()
    decision = route(json.loads(Path(args.prereg).read_text()), args.runner)
    print(json.dumps(decision))
    if decision["runs_on"] is None:
        sys.exit(decision["reason"])


if __name__ == "__main__":
    main()
