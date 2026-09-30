"""Command line for a Rouge training session on a GPU host.

    python -m rouge_train.cli verify  --base /models/Qwen3.5-27B
    python -m rouge_train.cli verify-data --data /data/rouge-sft-v0 --manifest datasets/manifests/rouge-sft-v0.json
    python -m rouge_train.cli train   --config configs/sft-001.json
    python -m rouge_train.cli merge   --config configs/sft-001.json --out /ckpt/rouge-1-sft-001
    python -m rouge_train.cli generate --model /models/Qwen3.5-27B --items eval.jsonl --out base.jsonl
    python -m rouge_train.cli generate --model /ckpt/rouge-1-sft-001 --items eval.jsonl --out rouge.jsonl
    python -m rouge_train.cli generate --backend openai --base-url http://127.0.0.1:8000/v1 --model rouge-1 --items eval.jsonl --out server.jsonl
    python -m rouge_train.cli compare --items eval.jsonl --base base.jsonl --rouge rouge.jsonl --out report.json --prereg experiments/rouge-1-exp-001.json
    python -m rouge_train.cli manifest --config configs/sft-001.json --merged /ckpt/rouge-1-sft-001 \
        --report report.json --storage hf://<owner>/rouge-1 --out checkpoints/

Every step writes JSON next to its outputs; `manifest` turns them into the
checkpoint manifest that enters the repository (never the weights).
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path


def _read_jsonl(path: str) -> list[dict]:
    return [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]


def main() -> None:
    parser = argparse.ArgumentParser(prog="rouge_train")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("verify")
    p.add_argument("--base", required=True)
    p = sub.add_parser("verify-data")
    p.add_argument("--data", required=True, help="directory with train.jsonl and eval.jsonl")
    p.add_argument("--manifest", required=True, help="the dataset manifest committed in this repository")
    p = sub.add_parser("train")
    p.add_argument("--config", required=True)
    p = sub.add_parser("merge")
    p.add_argument("--config", required=True)
    p.add_argument("--out", required=True)
    p = sub.add_parser("generate")
    p.add_argument("--model", required=True)
    p.add_argument("--items", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--backend", default="vllm", choices=["vllm", "transformers", "openai"])
    p.add_argument("--base-url", help="OpenAI-compatible endpoint for --backend openai (--model is the served name)")
    p.add_argument("--concurrency", type=int, default=8)
    p.add_argument("--max-new-tokens", type=int, default=2048)
    p.add_argument("--thinking", action="store_true")
    p = sub.add_parser("rft-sample", help="k answers per verifiable prompt from one vLLM engine")
    p.add_argument("--model", required=True)
    p.add_argument("--prompts", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--k", type=int, default=4)
    p.add_argument("--max-new-tokens", type=int, default=8192)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--tensor-parallel", type=int, default=1, help="GPUs of one engine (a large teacher uses all)")
    p.add_argument("--max-model-len", type=int, default=16384)
    p = sub.add_parser("rft-select", help="verified-correct answers become training records")
    p.add_argument("--prompts", required=True)
    p.add_argument("--samples", nargs="+", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--report", required=True)
    p.add_argument("--max-per-prompt", type=int, default=2)
    p.add_argument("--easy-fraction", type=float, default=0.25)
    p.add_argument("--source-prefix", default="rft", help="record source, e.g. teacher-deepseek-v4-pro")
    p.add_argument("--hard-out", help="write the prompts solved at most --hard-max-rate of the time (the teacher's work list)")
    p.add_argument("--hard-max-rate", type=float, default=0.0)
    p = sub.add_parser("compare")
    p.add_argument("--items", required=True)
    p.add_argument("--base", required=True)
    p.add_argument("--rouge", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--prereg", help="experiments/<name>.json: apply its pre-registered decision rule")
    p = sub.add_parser("manifest")
    p.add_argument("--config", required=True)
    p.add_argument("--merged", required=True)
    p.add_argument("--report", required=True)
    p.add_argument("--storage", required=True)
    p.add_argument("--out", required=True)
    args = parser.parse_args()

    if args.command == "verify":
        from .manifest import load_base, verify_download

        result = verify_download(Path(args.base), load_base())
        print(json.dumps(result.__dict__ | {"ok": result.ok}, indent=1))
        raise SystemExit(0 if result.ok else 1)

    if args.command == "verify-data":
        from .hashing import sha256_file

        expected = json.loads(Path(args.manifest).read_text())
        result = {}
        for part in [p for p in ("train", "eval", "prompts") if p in expected]:
            path = Path(args.data) / expected[part]["file"]
            actual = sha256_file(path) if path.exists() else None
            result[part] = {"file": str(path), "expected": expected[part]["sha256"], "actual": actual,
                            "ok": actual == expected[part]["sha256"]}
        ok = all(r["ok"] for r in result.values())
        print(json.dumps(result | {"ok": ok}, indent=1))
        raise SystemExit(0 if ok else 1)

    if args.command == "train":
        from .config import RunConfig

        config = RunConfig.load(args.config)
        if config.mode == "full":
            from .full import train
        else:
            from .train import train
        report = train(config)
        if int(os.environ.get("RANK", "0")) != 0:
            return                                                # one report per run, from rank 0
        print(json.dumps({k: v for k, v in report.items() if k not in ("losses", "config", "adapter_files", "model_files")}, indent=1))
        return

    if args.command == "merge":
        from .config import RunConfig
        from .merge import merge, weight_delta

        config = RunConfig.load(args.config)
        result = merge(config, Path(config.output_dir) / "adapter", args.out)
        result["weight_delta"] = weight_delta(Path(config.base_path), Path(args.out))
        (Path(args.out).parent / f"{Path(args.out).name}.merge.json").write_text(json.dumps(result, indent=1))
        print(json.dumps(result["weight_delta"], indent=1))
        return

    if args.command == "generate":
        from .evaluate import generate

        items = _read_jsonl(args.items)
        settings = {"backend": args.backend, "max_new_tokens": args.max_new_tokens, "temperature": 0.0, "seed": 0, "enable_thinking": args.thinking}
        if args.backend == "openai":
            if not args.base_url:
                raise SystemExit("--backend openai needs --base-url")
            settings |= {"base_url": args.base_url, "concurrency": args.concurrency}
        responses = generate(args.model, items, settings)
        Path(args.out).write_text("\n".join(json.dumps({"id": i["id"], "response": r}, ensure_ascii=False) for i, r in zip(items, responses)) + "\n")
        (Path(args.out).with_suffix(".settings.json")).write_text(json.dumps(settings | {"model": args.model}, indent=1))
        return

    if args.command == "rft-sample":
        from . import rft

        prompts = rft.read_jsonl(args.prompts)
        settings = {"k": args.k, "max_new_tokens": args.max_new_tokens, "seed": args.seed, "enable_thinking": True,
                    "tensor_parallel_size": args.tensor_parallel, "max_model_len": args.max_model_len}
        responses = rft.sample(args.model, prompts, settings)
        rft.write_jsonl(args.out, [{"id": p["id"], "responses": r} for p, r in zip(prompts, responses)])
        return

    if args.command == "rft-select":
        from . import rft

        samples = {row["id"]: row["responses"] for path in args.samples for row in rft.read_jsonl(path)}
        prompts = rft.read_jsonl(args.prompts)
        records, stats = rft.select(prompts, samples, max_per_prompt=args.max_per_prompt,
                                    easy_fraction=args.easy_fraction, source_prefix=args.source_prefix)
        rft.write_jsonl(args.out, records)
        if args.hard_out:
            hard = rft.hard_prompts(prompts, samples, args.hard_max_rate)
            rft.write_jsonl(args.hard_out, hard)
            stats["hard_prompts"] = len(hard)
        Path(args.report).write_text(json.dumps(stats, indent=1))
        print(json.dumps(stats, indent=1))
        return

    if args.command == "compare":
        from .evaluate import compare, score

        items = _read_jsonl(args.items)
        base = {r["id"]: r["response"] for r in _read_jsonl(args.base)}
        rouge = {r["id"]: r["response"] for r in _read_jsonl(args.rouge)}
        base_scores = score(items, [base[i["id"]] for i in items])
        rouge_scores = score(items, [rouge[i["id"]] for i in items])
        result = compare(items, base_scores, rouge_scores)
        for category, row in result.items():
            print(f"{category:16} n={row['n']:4} base={row['base']:4} rouge={row['rouge']:4} wins={row['wins']:3} regressions={row['regressions']:3} p={row['mcnemar_p']:.4f}")
        if args.prereg:
            from .evaluate import verdict
            from .hashing import sha256_file

            prereg = json.loads(Path(args.prereg).read_text())
            if sha256_file(Path(args.items)) != prereg["eval"]["sha256"]:
                raise SystemExit("eval set differs from the pre-registered one")
            result["verdict"] = verdict(items, base_scores, rouge_scores, prereg["decision"])
            print(f"verdict: {result['verdict']['result']}")
        Path(args.out).write_text(json.dumps(result, indent=1))
        return

    if args.command == "manifest":
        from . import checkpoints
        from .config import RunConfig
        from .manifest import base_ref, load_base
        from .train import environment

        config = RunConfig.load(args.config)
        train_report = json.loads((Path(config.output_dir) / "train-report.json").read_text())
        env = train_report.get("environment") or environment()
        manifest = checkpoints.create(
            name=config.name,
            parent=base_ref(load_base()),
            kind="full" if train_report.get("mode") == "full" else "merged",
            weights_dir=Path(args.merged),
            run={
                "id": f"{config.name}-{train_report['steps']}steps",
                "code_commit": env["code_commit"],
                "environment_lock_sha256": env["environment_lock_sha256"],
                "hardware": env["hardware"],
                "libraries": env.get("libraries"),
                "steps": train_report["steps"],
                "first_loss": train_report["first_loss"],
                "final_loss": train_report["final_loss"],
                "adapter_files": train_report.get("adapter_files"),
                "model_files": train_report.get("model_files"),
            },
            data={
                "registry_version": json.loads((Path(__file__).resolve().parent.parent / "datasets" / "registry.json").read_text())["version"],
                "mixture": Path(config.train_file).name,
                "revision": train_report.get("dataset"),
                "tokens": train_report["tokens"],
                "stats": train_report["data"],
            },
            hyperparameters={k: v for k, v in train_report["config"].items() if k not in ("output_dir", "stop_after")},
            seed=config.seed,
            storage_uri=args.storage,
        )
        comparison = json.loads(Path(args.report).read_text())
        for category, row in comparison.items():
            if category == "verdict":
                continue
            checkpoints.add_evaluation(
                manifest, suite=f"rouge-eval.{category}", version="v0", split="holdout",
                metrics={"score": row["rouge"] / max(1, row["n"]), "base_score": row["base"] / max(1, row["n"]),
                         "wins": row["wins"], "regressions": row["regressions"], "n": row["n"]},
                run=args.report,
            )
        path = checkpoints.save(manifest, Path(args.out))
        print(path)
        return


if __name__ == "__main__":
    main()
