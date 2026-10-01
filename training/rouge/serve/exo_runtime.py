#!/usr/bin/env python3
"""Rouge on exo: one model across several of the owner's devices, no server.

exo (github.com/exo-explore/exo, Apache-2.0) joins the devices on a local network into one
cluster: it finds them automatically, splits the model's layers or tensors across them
and serves an OpenAI-compatible API on each device (port 52415). A Rouge checkpoint becomes an
exo model in three steps, all local:

    1. convert   the checkpoint (Hugging Face safetensors) -> MLX, quantised (mlx_lm convert)
    2. card      an exo model card (TOML) next to exo's custom cards, read from the checkpoint's
                 own config.json; the weights stay in a read-only directory exo is pointed at
                 (EXO_MODELS_READ_ONLY_DIRS), so nothing is downloaded from any hub
    3. place     ask the running cluster to place the model (POST /place_instance) and wait
                 until every runner of its instance is ready (runner status in GET /state)

Start exo with EXO_OFFLINE=true: it then serves only weights already on the device and never asks a hub.

Then rouge_train.evaluate scores it like any other runtime:
    python -m rouge_train.cli generate --backend openai --base-url http://127.0.0.1:52415/v1 \\
        --model <model id> --items eval.jsonl --out exo.jsonl

    python serve/exo_runtime.py convert --hf <checkpoint dir> --models-dir ~/rouge-exo/models --model-id osirus/rouge-1-rl-001-4bit
    python serve/exo_runtime.py card    --models-dir ~/rouge-exo/models --model-id osirus/rouge-1-rl-001-4bit --cards-dir <exo data home>/custom_model_cards
    python serve/exo_runtime.py place   --model-id osirus/rouge-1-rl-001-4bit [--min-nodes 2]

Standard library only, except `convert`, which runs mlx_lm in exo's own environment.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

DEFAULT_API = "http://127.0.0.1:52415"
# Qwen's recommended sampling (as exo's own Qwen3.5/3.6 cards use)
SAMPLING = {"temperature": 1.0, "top_p": 0.95, "top_k": 20, "min_p": 0.0, "repetition_penalty": 1.0, "presence_penalty": 1.5}
SAMPLING_NON_THINKING = {"temperature": 0.7, "top_p": 0.8, "top_k": 20, "min_p": 0.0, "repetition_penalty": 1.0, "presence_penalty": 1.5}


def normalize(model_id: str) -> str:
    """exo's directory and file name for a model id (ModelId.normalize)."""
    return model_id.replace("/", "--")


def convert(hf_dir: Path, models_dir: Path, model_id: str, bits: int = 4, python: str = sys.executable) -> Path:
    out = models_dir / normalize(model_id)
    if out.exists():
        raise SystemExit(f"{out} exists; remove it to convert again")
    models_dir.mkdir(parents=True, exist_ok=True)
    command = [python, "-m", "mlx_lm", "convert", "--hf-path", str(hf_dir), "--mlx-path", str(out)]
    if bits < 16:
        command += ["-q", "--q-bits", str(bits)]
    subprocess.run(command, check=True)
    return out


def _toml_value(value) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, str):
        return json.dumps(value)
    if isinstance(value, list):
        return "[" + ", ".join(_toml_value(v) for v in value) + "]"
    raise TypeError(f"no TOML form for {value!r}")


def card(model_dir: Path, model_id: str, *, quantization: str, base_model: str, thinking: bool = True) -> str:
    """An exo model card for a converted checkpoint, from its own config.json and file sizes."""
    config = json.loads((model_dir / "config.json").read_text())
    text = config.get("text_config") or config
    storage = sum(p.stat().st_size for p in model_dir.glob("*.safetensors"))
    if storage == 0:
        raise SystemExit(f"{model_dir}: no safetensors weights")
    fields = {
        "model_id": model_id,
        "n_layers": int(text["num_hidden_layers"]),
        "hidden_size": int(text["hidden_size"]),
        "num_key_value_heads": int(text["num_key_value_heads"]),
        "supports_tensor": True,
        "tasks": ["TextGeneration"],
        "family": "qwen",
        "quantization": quantization,
        "base_model": base_model,
        "capabilities": ["text", "thinking", "thinking_toggle"] if thinking else ["text"],
        "reasoning_dialect": "post_last_user" if thinking else "none",
        "context_length": int(text.get("max_position_embeddings", 0)),
        "backends": ["MlxMetal", "MlxCuda", "MlxCpu"],
        # the architecture is built into transformers/mlx: never run code shipped with weights
        "trust_remote_code": False,
    }
    lines = [f"{k} = {_toml_value(v)}" for k, v in fields.items()]
    lines += ["", "[storage_size]", f"in_bytes = {storage}", "", "[sampling_defaults]"]
    lines += [f"{k} = {_toml_value(v)}" for k, v in SAMPLING.items()]
    lines += ["", "[sampling_defaults.non_thinking]"]
    lines += [f"{k} = {_toml_value(v)}" for k, v in SAMPLING_NON_THINKING.items()]
    return "\n".join(lines) + "\n"


def write_card(cards_dir: Path, model_dir: Path, model_id: str, **kwargs) -> Path:
    cards_dir.mkdir(parents=True, exist_ok=True)
    path = cards_dir / f"{normalize(model_id)}.toml"
    path.write_text(card(model_dir, model_id, **kwargs))
    return path


def _request(url: str, body: dict | None = None, timeout: float = 60) -> bytes:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"} if data else {})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def wait_for_api(api: str = DEFAULT_API, timeout: float = 600) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            _request(f"{api}/node_id", timeout=5)
            return
        except OSError:
            time.sleep(3)
    raise SystemExit(f"exo API at {api} did not come up within {timeout:.0f} s")


def _untag(value: dict) -> tuple[str, dict]:
    """exo serialises tagged unions as {"ClassName": {...fields}}."""
    (tag, inner), = value.items()
    return tag, inner


def _field(obj: dict, name: str):
    """A field by its snake_case name or the camelCase alias exo's /state uses (model_dump(by_alias=True))."""
    if name in obj:
        return obj[name]
    head, *rest = name.split("_")
    return obj.get(head + "".join(w.title() for w in rest))


def runner_ids(instance: dict) -> list[str]:
    _, inner = _untag(instance)
    return list(inner["shard_assignments"]["runner_to_shard"])


def readiness(runners: dict, downloads: dict, ids: list[str], model_id: str) -> str | None:
    """None while loading, "ready" once every runner of the instance serves; raises on a failure."""
    for entries in downloads.values():
        for entry in entries:
            tag, inner = _untag(entry)
            if tag != "DownloadFailed":
                continue
            _, shard = _untag(_field(inner, "shard_metadata"))
            if _field(_field(shard, "model_card"), "model_id") == model_id:
                raise SystemExit(f"exo could not get the weights of {model_id}: {_field(inner, 'error_message')}")
    states = []
    for rid in ids:
        if rid not in runners:
            return None
        tag, inner = _untag(runners[rid])
        if tag == "RunnerFailed":
            raise SystemExit(f"exo runner for {model_id} failed: {_field(inner, 'error_message')}")
        states.append(tag)
    return "ready" if all(s in ("RunnerReady", "RunnerRunning") for s in states) else None


def place(model_id: str, api: str = DEFAULT_API, min_nodes: int = 1, timeout: float = 1800) -> dict:
    """Place the model on the cluster and wait until every runner of its instance is ready.

    /instance/await answers as soon as the instance exists; the weights may still be loading (or
    downloading), so readiness is read from the runners' own status in /state.
    """
    _request(f"{api}/place_instance", {"model_id": model_id, "min_nodes": min_nodes})
    deadline = time.time() + timeout
    instance = None
    while instance is None and time.time() < deadline:
        stream = _request(f"{api}/instance/await?model_id={urllib.request.quote(model_id)}&timeout_seconds=300", timeout=330)
        for line in stream.decode().splitlines():
            if line.startswith("data:"):
                message = json.loads(line[5:])
                if message.get("type") == "ready":
                    instance = message.get("instance") or {}
    if instance is None:
        raise SystemExit(f"{model_id} was not placed within {timeout:.0f} s")
    ids = runner_ids(instance)
    while time.time() < deadline:
        runners = json.loads(_request(f"{api}/state/runners", timeout=30))
        downloads = json.loads(_request(f"{api}/state/downloads", timeout=30))
        if readiness(runners, downloads, ids, model_id):
            return instance
        time.sleep(2)
    raise SystemExit(f"{model_id} was placed but its runners were not ready within {timeout:.0f} s")


def chat(model_id: str, prompt: str, api: str = DEFAULT_API, max_tokens: int = 64) -> str:
    body = {"model": model_id, "messages": [{"role": "user", "content": prompt}], "max_tokens": max_tokens,
            "temperature": 0.0, "stream": False}
    reply = json.loads(_request(f"{api}/v1/chat/completions", body, timeout=600))
    return reply["choices"][0]["message"].get("content") or ""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("convert")
    p.add_argument("--hf", required=True, type=Path)
    p.add_argument("--models-dir", required=True, type=Path)
    p.add_argument("--model-id", required=True)
    p.add_argument("--bits", type=int, default=4)
    p.add_argument("--python", default=sys.executable, help="the Python of exo's environment (has mlx_lm)")
    p = sub.add_parser("card")
    p.add_argument("--models-dir", required=True, type=Path)
    p.add_argument("--model-id", required=True)
    p.add_argument("--cards-dir", required=True, type=Path)
    p.add_argument("--quantization", default="4bit")
    p.add_argument("--base-model", default="Rouge 1 (Qwen3.8 27B derivative)")
    p.add_argument("--no-thinking", action="store_true")
    p = sub.add_parser("place")
    p.add_argument("--model-id", required=True)
    p.add_argument("--api", default=DEFAULT_API)
    p.add_argument("--min-nodes", type=int, default=1)
    p = sub.add_parser("chat")
    p.add_argument("--model-id", required=True)
    p.add_argument("--prompt", required=True)
    p.add_argument("--api", default=DEFAULT_API)
    args = parser.parse_args()
    if args.command == "convert":
        print(convert(args.hf, args.models_dir, args.model_id, args.bits, args.python))
    elif args.command == "card":
        print(write_card(args.cards_dir, args.models_dir / normalize(args.model_id), args.model_id,
                         quantization=args.quantization, base_model=args.base_model, thinking=not args.no_thinking))
    elif args.command == "place":
        wait_for_api(args.api)
        print(json.dumps(place(args.model_id, args.api, args.min_nodes))[:2000])
    elif args.command == "chat":
        print(chat(args.model_id, args.prompt, args.api))


if __name__ == "__main__":
    main()
