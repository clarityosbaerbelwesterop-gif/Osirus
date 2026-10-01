#!/usr/bin/env python3
"""Install Rouge 1 locally and run it without any server: the owner's machine only.

    LIGHTNING_API_KEY=... python training/rouge/serve/install.py --run rouge-1-rl-001            # download + verify
    python training/rouge/serve/install.py --run rouge-1-rl-001 --serve                          # + llama-server on 127.0.0.1

The weights never live in this (public) repository. `install` downloads the quantised Rouge Edge
file (GGUF, Q4_K_M) of a gated, passed checkpoint from the private Lightning model registry with the
owner's key, checks every file against its sha256 manifest (lightning_ai/storage.py), and refuses a
machine whose memory cannot hold it (docs/rouge/deployment.md: Mac with 24 GB or more). `--serve`
starts llama.cpp's llama-server bound to 127.0.0.1, an OpenAI-compatible endpoint Osirus and
rouge_train.evaluate (--backend openai) can use; nothing leaves the machine.
"""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "lightning_ai"))

# weights + KV cache and runtime must fit the memory the OS gives the GPU. The 27B base keeps a KV cache in
# 16 of 64 layers (4 KV heads x 256): about 64 KB per token, 2 GB at 32k tokens; +1.5 GB runtime.
OVERHEAD = 3.5 * 2**30
GPU_SHARE = {"Darwin": 0.70, "Linux": 0.90}   # macOS lets Metal use about 2/3-3/4 of unified memory


def memory_bytes() -> int | None:
    try:
        if platform.system() == "Darwin":
            return int(subprocess.check_output(["sysctl", "-n", "hw.memsize"], text=True))
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    except (OSError, ValueError, subprocess.CalledProcessError):
        return None


def fits(model_bytes: int, memory: int | None, system: str) -> bool:
    return memory is None or model_bytes + OVERHEAD <= memory * GPU_SHARE.get(system, 0.9)


def install(run: str, home: Path) -> Path:
    import storage

    target = home / "models" / run
    if not os.environ.get("LIGHTNING_API_KEY"):
        raise SystemExit("LIGHTNING_API_KEY is required: the Rouge weights live in the owner's private teamspace")
    storage.download(f"rouge/models/{run}-gguf", str(target))
    found = sorted(target.rglob("*.gguf"))
    if not found:
        raise SystemExit(f"{run}: no GGUF file in the registry model (was the checkpoint promoted and converted?)")
    size = found[0].stat().st_size
    memory = memory_bytes()
    if not fits(size, memory, platform.system()):
        found[0].unlink()
        raise SystemExit(f"{found[0].name} needs about {(size + OVERHEAD) / 2**30:.0f} GB of GPU-visible memory; this machine has "
                         f"{(memory or 0) / 2**30:.0f} GB in total (Rouge Edge Mobile, a smaller distilled model, is planned)")
    print(f"[rouge] installed {found[0]} ({size / 2**30:.1f} GB, sha256 verified)")
    return found[0]


def serve(model: Path, port: int, ctx: int) -> None:
    binary = shutil.which("llama-server")
    if binary is None:
        raise SystemExit("llama-server not found: install llama.cpp (macOS: brew install llama.cpp) and run again")
    print(f"[rouge] serving on http://127.0.0.1:{port}/v1 (OpenAI-compatible, local only)")
    os.execv(binary, [binary, "-m", str(model), "--host", "127.0.0.1", "--port", str(port), "-c", str(ctx), "-ngl", "99", "--jinja"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", required=True, help="a promoted checkpoint, e.g. rouge-1-rl-001")
    parser.add_argument("--home", default=str(Path.home() / ".rouge"))
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--ctx", type=int, default=32768)
    args = parser.parse_args()
    home = Path(args.home)
    existing = sorted((home / "models" / args.run).rglob("*.gguf"))
    model = existing[0] if existing else install(args.run, home)
    if args.serve:
        serve(model, args.port, args.ctx)


if __name__ == "__main__":
    main()
