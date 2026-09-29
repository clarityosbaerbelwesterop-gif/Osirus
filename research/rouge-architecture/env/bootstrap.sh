#!/usr/bin/env bash
# One command to prepare any machine for Rouge architecture research:
# CI runner, laptop, Apple-silicon Mac or the owner's Claude server.
#
#   research/rouge-architecture/env/bootstrap.sh [venv dir]
#
# Creates a virtual environment, installs the pinned stack for the detected
# hardware (NVIDIA CUDA, Apple MLX or CPU), runs the tests and prints the
# hardware summary that goes into every experiment report.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
VENV="${1:-$HERE/.venv}"
python3 -m venv "$VENV"
# shellcheck disable=SC1091
. "$VENV/bin/activate"
python -m pip install -q --upgrade pip

torch_pin="$(grep -E '^torch==' "$HERE/env/requirements.txt")"
if command -v nvidia-smi >/dev/null && nvidia-smi >/dev/null 2>&1; then
  cuda_major="$(nvidia-smi | sed -n 's/.*CUDA Version: \([0-9]*\).*/\1/p' | head -1)"
  if [[ "${cuda_major:-0}" -ge 13 ]]; then
    python -m pip install -q "$torch_pin"
  else
    python -m pip install -q --index-url https://download.pytorch.org/whl/cu128 "$torch_pin"
  fi
  python -m pip install -q triton || echo "triton not installed (optional)"
  accel="cuda"
elif [[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]]; then
  python -m pip install -q "$torch_pin" mlx
  accel="mps+mlx"
else
  python -m pip install -q --index-url https://download.pytorch.org/whl/cpu "$torch_pin"
  accel="cpu"
fi
python -m pip install -q numpy

python -m unittest discover -s "$HERE/tests"
python - "$accel" <<'PY'
import os, platform, sys
import torch
print({"accelerator": sys.argv[1], "python": platform.python_version(), "torch": torch.__version__,
       "cpu_threads": os.cpu_count(), "cuda": torch.cuda.is_available(),
       "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
       "mps": getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available()})
PY
echo "Rouge research environment ready: . $VENV/bin/activate"
