"""Rouge Edge: a lineage checkpoint → GGUF → quantised variants, measured.

    python -m rouge_train.edge --model /ckpt/rouge-1-exp-001 --llama /opt/llama.cpp \
        --items eval.jsonl --out /edge/rouge-1-exp-001 [--ngl 99]

For every variant (F16 and each quantisation) the report records what a
device decision needs:

- size on disk and bits per weight;
- prompt and generation speed (llama-bench) on this machine's backend
  (CPU, or Metal/CUDA with --ngl);
- quality loss against F16: mean KL divergence and top-token agreement
  (llama-perplexity) on a fixed text;
- the eval score through llama-server's OpenAI-compatible endpoint, scored
  by the same code checks as the training host -- next to the score of the
  checkpoint itself (transformers), so conversion errors show up.

An Edge variant is the same Rouge checkpoint, quantised: never another base
model. Nothing here downloads weights; the checkpoint is local.
"""

from __future__ import annotations

import argparse
import json
import re
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from .data import read_jsonl
from .evaluate import generate, score
from .hashing import sha256_file

DEFAULT_QUANTS = ("Q8_0", "Q6_K", "Q5_K_M", "Q4_K_M")
REFERENCE_TEXT = Path(__file__).resolve().parents[3] / "docs" / "rouge" / "native-model.md"


def _bin(llama: Path, name: str) -> str:
    for candidate in (llama / "build" / "bin" / name, llama / "bin" / name, llama / name):
        if candidate.exists():
            return str(candidate)
    raise FileNotFoundError(f"{name} not found under {llama}")


def _run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    print("+", " ".join(cmd), flush=True)
    result = subprocess.run(cmd, capture_output=True, text=True, **kwargs)
    if result.returncode:
        print(result.stdout[-2000:], result.stderr[-4000:], sep="\n", flush=True)
        result.check_returncode()
    return result


def convert(model: Path, llama: Path, out: Path, mtp: bool = True) -> Path:
    """HF checkpoint → F16 GGUF. The multi-token-prediction head (carried
    through the merge) is exported for speculative decoding unless the
    checkpoint has none (the CI smoke model)."""
    target = out / "model-F16.gguf"
    _run([sys.executable, str(llama / "convert_hf_to_gguf.py"), str(model), "--outtype", "f16", "--outfile", str(target),
          *([] if mtp else ["--no-mtp"])])
    return target


def quantize(llama: Path, f16: Path, quant: str) -> Path:
    target = f16.with_name(f"model-{quant}.gguf")
    _run([_bin(llama, "llama-quantize"), str(f16), str(target), quant])
    return target


def parameters(gguf_file: Path) -> int:
    from gguf import GGUFReader

    return int(sum(int(t.n_elements) for t in GGUFReader(str(gguf_file)).tensors))


def bench(llama: Path, gguf_file: Path, ngl: int) -> dict:
    result = _run([_bin(llama, "llama-bench"), "-m", str(gguf_file), "-p", "128", "-n", "32", "-ngl", str(ngl), "-r", "3", "-o", "json"])
    rows = json.loads(result.stdout)
    speed = {("prompt_tps" if row["n_prompt"] else "gen_tps"): round(row["avg_ts"], 2) for row in rows}
    return speed | {"backend": rows[0].get("backends") or rows[0].get("backend"), "ngl": ngl}


def kl_divergence(llama: Path, f16: Path, variant: Path, text: Path, workdir: Path, ngl: int) -> dict:
    base_logits = workdir / "f16.kld"
    common = ["-f", str(text), "-c", "128", "-b", "128", "-ngl", str(ngl)]
    if not base_logits.exists():
        _run([_bin(llama, "llama-perplexity"), "-m", str(f16), *common, "--kl-divergence-base", str(base_logits)])
    result = _run([_bin(llama, "llama-perplexity"), "-m", str(variant), *common, "--kl-divergence-base", str(base_logits), "--kl-divergence"])
    log = result.stdout + result.stderr
    mean = re.search(r"Mean\s+KLD:\s+(-?[\d.]+)", log)
    same = re.search(r"Same top p:\s+([\d.]+)", log)
    return {"mean_kld": float(mean.group(1)) if mean else None, "same_top_p_pct": float(same.group(1)) if same else None}


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def serve_and_score(llama: Path, gguf_file: Path, items: list[dict], settings: dict, ngl: int) -> dict:
    """Score a variant through llama-server's OpenAI-compatible endpoint."""
    port = _free_port()
    server = subprocess.Popen(
        [_bin(llama, "llama-server"), "-m", str(gguf_file), "--port", str(port), "--host", "127.0.0.1", "-ngl", str(ngl),
         "--jinja", "-c", "4096", "--seed", "0"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        deadline = time.time() + 300
        while True:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=5) as response:
                    if response.status == 200:
                        break
            except OSError:
                pass
            if time.time() > deadline or server.poll() is not None:
                raise RuntimeError(f"llama-server did not start for {gguf_file.name}")
            time.sleep(1)
        responses = generate("rouge", items, settings | {"backend": "openai", "base_url": f"http://127.0.0.1:{port}/v1", "concurrency": 1})
    finally:
        server.terminate()
        server.wait(timeout=30)
    scores = score(items, responses)
    return {"score": sum(scores), "n": len(scores), "sample": responses[0][:200] if responses else ""}


def run(model: Path, llama: Path, items_file: Path, out: Path, quants: tuple[str, ...], ngl: int, max_new_tokens: int,
        reference: bool = True, mtp: bool = True) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    items = read_jsonl(items_file)
    settings = {"max_new_tokens": max_new_tokens, "temperature": 0.0, "seed": 0, "enable_thinking": False}
    report: dict = {"checkpoint": str(model), "items": items_file.name, "items_sha256": sha256_file(items_file),
                    "settings": settings, "variants": {}}
    if reference and model.is_dir() and (model / "config.json").exists():
        ref = score(items, generate(str(model), items, settings | {"backend": "transformers"}))
        report["checkpoint_score"] = {"score": sum(ref), "n": len(ref), "backend": "transformers"}
    if model.is_dir() and not (model / "config.json").exists():
        # Already converted (e.g. on another machine): measure these files.
        f16 = model / "model-F16.gguf"
        variants = [("F16", f16)] + [(q, model / f"model-{q}.gguf") for q in quants if (model / f"model-{q}.gguf").exists()]
    else:
        f16 = convert(model, llama, out, mtp)
        variants = [("F16", f16)] + [(q, quantize(llama, f16, q)) for q in quants]
    n_params = parameters(f16)
    report["parameters"] = n_params
    text = out / "reference.txt"
    text.write_text(REFERENCE_TEXT.read_text() * 4)
    for name, path in variants:
        size = path.stat().st_size
        row = {"file": path.name, "sha256": sha256_file(path), "bytes": size, "bits_per_weight": round(size * 8 / n_params, 3)}
        row |= bench(llama, path, ngl)
        row |= kl_divergence(llama, f16, path, text, out, ngl) if name != "F16" else {"mean_kld": 0.0, "same_top_p_pct": 100.0}
        row |= serve_and_score(llama, path, items, settings, ngl)
        report["variants"][name] = row
        print(name, json.dumps(row), flush=True)
    (out / "edge-report.json").write_text(json.dumps(report, indent=1))
    return report


def main() -> None:
    parser = argparse.ArgumentParser(prog="rouge_train.edge")
    parser.add_argument("--model", required=True, help="merged Rouge checkpoint (HF safetensors), or a directory of model-<QUANT>.gguf files to measure")
    parser.add_argument("--llama", required=True, help="llama.cpp checkout with build/bin")
    parser.add_argument("--items", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--quants", default=",".join(DEFAULT_QUANTS))
    parser.add_argument("--ngl", type=int, default=0, help="layers on the GPU (99 = all; Metal/CUDA)")
    parser.add_argument("--max-new-tokens", type=int, default=64)
    parser.add_argument("--no-reference", action="store_true", help="skip the transformers score of the checkpoint")
    parser.add_argument("--no-mtp", action="store_true", help="checkpoint without a real MTP head (CI smoke model)")
    parser.add_argument("--require-f16-match", action="store_true", help="fail unless F16 GGUF scores like the checkpoint")
    args = parser.parse_args()
    report = run(Path(args.model), Path(args.llama), Path(args.items), Path(args.out), tuple(q for q in args.quants.split(",") if q),
                 args.ngl, args.max_new_tokens, reference=not args.no_reference, mtp=not args.no_mtp)
    if args.require_f16_match:
        if "checkpoint_score" not in report:
            raise SystemExit("--require-f16-match needs the HF checkpoint as --model")
        expected, got = report["checkpoint_score"]["score"], report["variants"]["F16"]["score"]
        if expected != got:
            raise SystemExit(f"F16 GGUF scores {got}, the checkpoint {expected}: conversion changed the model")
    print("edge pipeline passed")


if __name__ == "__main__":
    main()
