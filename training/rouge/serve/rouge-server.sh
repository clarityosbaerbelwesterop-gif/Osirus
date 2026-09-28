#!/usr/bin/env bash
# Rouge Server: one OpenAI-compatible endpoint (/v1/chat/completions) for a
# Rouge checkpoint, on our own hardware or a temporary GPU host.
#
#   serve/rouge-server.sh full /ckpt/rouge-1-exp-001          # vLLM, GPU, BF16
#   serve/rouge-server.sh edge /edge/model-Q4_K_M.gguf        # llama.cpp, CPU/Metal/CUDA
#
# The served model name is always "rouge-1". A key is mandatory and the
# server binds to 127.0.0.1 unless HOST says otherwise; put TLS and access
# control in front before exposing it. Score it like any Rouge model:
#   python -m rouge_train.cli generate --backend openai --base-url http://127.0.0.1:8000/v1 --model rouge-1 ...
set -euo pipefail
MODE="${1:?full or edge}"
MODEL="${2:?checkpoint directory (full) or .gguf file (edge)}"
: "${ROUGE_API_KEY:?set ROUGE_API_KEY -- the server never runs without a key}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"

case "$MODE" in
  full)
    exec vllm serve "$MODEL" --served-model-name rouge-1 --host "$HOST" --port "$PORT" --api-key "$ROUGE_API_KEY" \
      --max-model-len "${MAX_LEN:-32768}" --enable-prefix-caching --reasoning-parser qwen3 --generation-config vllm
    ;;
  edge)
    exec "${LLAMA_SERVER:-llama-server}" -m "$MODEL" --alias rouge-1 --host "$HOST" --port "$PORT" --api-key "$ROUGE_API_KEY" \
      --jinja -c "${MAX_LEN:-16384}" -ngl "${NGL:-99}"
    ;;
  *)
    echo "mode must be full or edge" >&2
    exit 2
    ;;
esac
