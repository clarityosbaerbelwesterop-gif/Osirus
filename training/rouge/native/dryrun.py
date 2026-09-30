"""Free end-to-end dry run of the whole Rouge pipeline on one device (CPU runner or a small GPU).

data build -> manifest verify -> train (killed at a step) -> resume -> final evaluation
-> registry entry (dry-run registry) -> CRI Level-A cycle -> SFT step from the checkpoint.

    python -m native.dryrun --out DIR [--summary results/dry-run/cpu/summary.json]

Writes a summary with every stage's evidence (hashes, losses, exit codes, device, precision).
TRAINING_READY requires one summary from a CPU runner and one from a GPU.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sh(*args, check=True) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "-m", *args], cwd=ROOT, capture_output=True, text=True, check=check)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--summary")
    parser.add_argument("--steps", type=int, default=60)
    args = parser.parse_args()
    import torch

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    summary = {"schema": "rouge.dryrun/1", "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "device": device,
               "gpu": torch.cuda.get_device_name() if device == "cuda" else None,
               "precision": ("bf16" if torch.cuda.get_device_capability()[0] >= 8 else "fp16") if device == "cuda" else "fp32",
               "code_sha": os.environ.get("GITHUB_SHA") or os.environ.get("ROUGE_COMMIT") or "local", "stages": {}}
    st = summary["stages"]
    data = out / "data"
    sh("native.data.build", "--out", str(data), "--tokens", "6e5", "--vocab", "1024", "--only", "math_synth", "algo_synth")
    st["data"] = {"ok": sh("native.data.verify", "--data", str(data), check=False).returncode == 0,
                  "manifest_sha256": __import__("hashlib").sha256((data / "manifest.json").read_bytes()).hexdigest()}
    cfg = out / "cfg.json"
    cfg.write_text(json.dumps({"name": "dryrun", "vocab_size": 1024, "d_model": 64, "n_layers": 4, "n_heads": 4,
                               "n_kv_heads": 2, "max_seq": 128, "attention": "hybrid", "window": 32, "global_every": 2}))
    run = out / "run"
    base = ["native.train", "--config", str(cfg), "--data", str(data), "--out", str(run), "--steps", str(args.steps),
            "--batch", "8", "--seq", "128", "--warmup", "5", "--eval-every", "20", "--ckpt-every", "20", "--final-eval", "full"]
    killed = sh(*base, "--stop-after", str(args.steps // 2), check=False)
    resumed = sh(*base, check=False)
    result = json.loads((run / "result.json").read_text()) if (run / "result.json").exists() else {}
    st["train"] = {"killed_exit": killed.returncode, "resumed_exit": resumed.returncode,
                   "resumed_from": next((l for l in resumed.stdout.splitlines() if "resumed at step" in l), None),
                   "final_loss": result.get("final_train_loss"), "steps": result.get("steps"),
                   "ok": killed.returncode == 75 and resumed.returncode == 0 and bool(result)}
    st["eval"] = {"ok": bool(result.get("eval")), "val": (result.get("eval") or {}).get("val"),
                  "tasks": (result.get("eval") or {}).get("tasks"), "decode_tokens_per_s": (result.get("eval") or {}).get("decode_tokens_per_s")}

    from native import checkpoint, registry

    found = checkpoint.latest(run)
    reg_path = out / "registry.json"
    reg = registry.load(reg_path)
    entry = registry.append(reg, registry.entry_from_result(
        result, registry.next_name(reg, "1m"), None, summary["code_sha"],
        json.loads((data / "manifest.json").read_text())["tokenizer"]["sha256"],
        __import__("hashlib").sha256((found[0] / "meta.json").read_bytes()).hexdigest(),
        {"name": "adamw", "lr": 3e-3}, {"name": "wsd"}, summary["gpu"] or "cpu"), path=reg_path)
    st["registry"] = {"ok": registry.verify(registry.load(reg_path)) == [], "name": entry["name"], "entry_hash": entry["entry_hash"]}

    cri = sh("native.cri", "smoke", "--work", str(out / "cri"), *(["--log"] if args.summary else []), check=False)
    st["cri"] = {"ok": cri.returncode == 0, "output": (cri.stdout.strip().splitlines() or [""])[-1][:500],
                 "error": cri.stderr[-500:] if cri.returncode else None}

    sft_data = out / "sft.jsonl"
    sft_data.write_text("".join(json.dumps({"messages": [{"role": "user", "content": f"Q: {a} + {a} ="},
                                                         {"role": "assistant", "content": str(2 * a)}]}) + "\n" for a in range(20)))
    sft = sh("native.posttrain", "sft", "--init", str(run), "--data", str(sft_data), "--tokenizer", str(data / "tokenizer.json"),
             "--out", str(out / "sft"), "--steps", "5", "--batch", "4", "--lr", "1e-4", check=False)
    st["posttrain_sft"] = {"ok": sft.returncode == 0, "error": sft.stderr[-500:] if sft.returncode else None}

    bench = sh("native.bench", "--tokens", "8192" if device == "cuda" else "1024", "--d", "1024" if device == "cuda" else "256",
               check=False)
    line = next((l for l in bench.stdout.splitlines() if l.startswith("ROUGE_BENCH ")), None)
    summary["bench"] = json.loads(line[len("ROUGE_BENCH "):]) if line else {"error": bench.stderr[-300:]}   # informational

    summary["ok"] = all(s["ok"] for s in st.values())
    summary["finished"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    text = json.dumps(summary, indent=1)
    print("ROUGE_DRYRUN " + json.dumps(summary))
    if args.summary:
        Path(args.summary).parent.mkdir(parents=True, exist_ok=True)
        Path(args.summary).write_text(text + "\n")
    raise SystemExit(0 if summary["ok"] else 1)


if __name__ == "__main__":
    main()
