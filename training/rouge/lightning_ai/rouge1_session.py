"""Rouge 1 on Lightning: one RSI iteration on the pinned base, one owner-approved run.

    python lightning_ai/rouge1_session.py --run rouge-1-rl-001 --prereg experiments/rouge-1-rl-001.json --max-hours 2.5

The job (rouge1_job.sh) downloads the pinned base from the Hub onto the GPU machine and verifies every
sha256, evaluates it on the pre-registered eval set, lets it answer verifiable prompts, keeps only
code-verified answers, trains every language-model weight on them (FSDP2 over all GPUs), evaluates the
result on the same items with the same settings, applies the pre-registered rule and uploads the model
to the private model registry. Default machine: 8 x H200 (1128 GB, NVLink) at its live price.

Runs from GitHub Actions in the protected environment "rouge-gpu" (the owner approves every run).
Guards, all before anything is billed:
1. the base pin, the pre-registration (eval hash, rule, parent), the dataset manifest and the run config
   agree with each other (a run on anything else is not a Rouge run);
2. the machine is a training machine and its live price (cheapest cloud account) is within its ceiling;
3. the worst case (max hours x live price + 5%) fits the ceiling (cost.CEILING_USD) together with every
   job in the ledger, and the teamspace's credit balance.
This process stops the job at its deadline and records the actual cost. Weights never leave the
private teamspace; the repository keeps hashes and reports only.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT))

import cost  # noqa: E402
import job as lj  # noqa: E402
from train_session import TERMINAL, launch  # noqa: E402

JOB_SCRIPT = "lightning_ai/rouge1_job.sh"
LLAMA_CPP_COMMIT = "f1ea206218210afb913ae2f5d2c51faed35915da"   # as rouge-edge.yml (the edge pipeline's tested commit)


def preflight(args) -> dict:
    """Consistency of pin, pre-registration, dataset and config; returns the pre-registration."""
    from rouge_train.config import RunConfig
    from rouge_train.manifest import base_ref, load_base

    base = load_base()
    prereg = json.loads((ROOT / args.prereg).read_text())
    if prereg.get("status") != "pre-registered" or prereg.get("name") != args.run:
        raise SystemExit(f"{args.prereg}: not the pre-registration of {args.run} (status {prereg.get('status')})")
    expected_parent = args.parent_ref or base_ref(base)
    if prereg["parent"] != expected_parent:
        raise SystemExit(f"pre-registered parent {prereg['parent']} is not {expected_parent}")
    data = json.loads((ROOT.parents[1] / prereg["data"]["manifest"]).read_text())
    if data["eval"]["sha256"] != prereg["eval"]["sha256"] or "prompts" not in data:
        raise SystemExit("dataset manifest and pre-registration disagree (eval hash) or the dataset has no prompts")
    config = RunConfig.load(ROOT / prereg["config"])
    if config.mode != "full":
        raise SystemExit(f"{prereg['config']}: mode must be 'full'")
    family, n = cost.gpus(args.machine)
    if n < 2:
        raise SystemExit(f"{args.machine}: full training of the base needs a multi-GPU machine")
    remaining = cost.CEILING_USD - cost.committed(cost.load(HERE / "ledger.json"))
    print(f"[rouge1] {base['source']['repo']}@{base['source']['revision'][:12]} -> {args.run}; {args.machine} for at most "
          f"{args.max_hours} h; {remaining:.2f} USD left under the {cost.CEILING_USD:.2f} USD ceiling", flush=True)
    return prereg


def run(args) -> int:
    from lightning_sdk import Job, Machine

    if not os.environ.get("LIGHTNING_API_KEY"):
        raise SystemExit("LIGHTNING_API_KEY is not set")
    sha = os.environ.get("GITHUB_SHA") or args.sha
    if not sha:
        raise SystemExit("commit SHA required")
    prereg = preflight(args)
    family, n = cost.gpus(args.machine)
    ledger_path = HERE / "ledger.json"
    ledger = lj.load_ledger(ledger_path)
    env = {"PYTHONUNBUFFERED": "1", "ROUGE_RUN": args.run, "ROUGE_PREREG": args.prereg, "ROUGE_CONFIG": prereg["config"].removeprefix("training/rouge/"),
           "ROUGE_DATASET": args.dataset, "ROUGE_NPROC": str(n), "ROUGE_EXPECT_GPU": family.split("_")[0],
           "ROUGE_PEAK_TFLOPS": str(cost.GPU[family][0]), "ROUGE_RFT_PROMPTS": str(args.prompts), "ROUGE_RFT_K": str(args.k),
           "ROUGE_TRAIN_HOURS": str(args.train_hours), "ROUGE_PARENT": args.parent or "",
           "LLAMA_CPP_COMMIT": LLAMA_CPP_COMMIT,
           # the registry is the only store that persists; the key stays inside Lightning and is never printed
           "LIGHTNING_API_KEY": os.environ["LIGHTNING_API_KEY"]}
    out = ROOT / "results" / "runs" / args.run
    out.mkdir(parents=True, exist_ok=True)
    args.interruptible = False                                   # one uninterrupted session: sampling and training are not resumable across machines
    job, worst = launch(Job, Machine, args, sha, env, args.max_hours, ledger, script=JOB_SCRIPT)
    if job is None:
        raise SystemExit("no teamspace accepted the job (credits, GPU access, price or permissions)")
    code = lj.record_and_wait(job, ledger, ledger_path, args.machine, args.max_hours, worst, results=None, name=args.run,
                              prefix="ROUGE_TRAIN")
    lines = (job.logs or "").splitlines()
    phases = [l for l in lines if l.startswith("ROUGE_PHASE")]
    for line in phases:
        print("[job]", line, flush=True)
    (out / "phases.log").write_text("\n".join(phases) + "\n")
    result = next((l[len("ROUGE_TRAIN "):] for l in reversed(lines) if l.startswith("ROUGE_TRAIN ")), None)
    if result:
        (out / "result.json").write_text(json.dumps(json.loads(result), indent=1) + "\n")
    if not any(l.startswith(TERMINAL) for l in lines):
        print("[rouge1] the job ended without a terminal phase (deadline or stop)", flush=True)
    return code


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", required=True, help="checkpoint name, e.g. rouge-1-rl-001")
    parser.add_argument("--prereg", required=True, help="experiments/<run>.json (relative to training/rouge)")
    parser.add_argument("--dataset", default="rouge/data/rouge-rft-v1", help="registry path of the built dataset")
    parser.add_argument("--machine", choices=cost.TRAINING_MACHINES, default="H200_X_8")
    parser.add_argument("--max-hours", type=float, required=True)
    parser.add_argument("--train-hours", type=float, default=1.0, help="the trainer's own budget check")
    parser.add_argument("--prompts", type=int, default=3200)
    parser.add_argument("--k", type=int, default=4)
    parser.add_argument("--parent", default="", help="registry path of the Rouge checkpoint to start from (next iteration)")
    parser.add_argument("--parent-ref", default="", help="its lineage name, as the pre-registration names it")
    parser.add_argument("--sha")
    args = parser.parse_args()
    if not 0 < args.max_hours <= 5.75:
        raise SystemExit("--max-hours must be in (0, 5.75]: a GitHub job lasts at most 6 hours")
    if args.train_hours >= args.max_hours:
        raise SystemExit("--train-hours must leave time for download, evaluation and sampling")
    sys.exit(run(args))


if __name__ == "__main__":
    main()
