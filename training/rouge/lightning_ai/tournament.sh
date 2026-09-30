#!/usr/bin/env bash
# Runs inside a Lightning job (cwd: training/rouge of the pinned commit).
# Rebuilds the committed corpus (every shard hash must match), then one
# tournament level on all GPUs of the machine. Inputs (job env): LEVEL,
# R1_29B, FINALISTS (level C). Output: ROUGE_RUN lines in the log.
set -euo pipefail
DATA=/tmp/rouge-data
python -m native.data.build --out "$DATA" --tokenizer configs/native/data-v1/tokenizer.json \
  --expect configs/native/data-v1/manifest.json
args=(--tournament configs/native/tournament-v1.json --level "$LEVEL" --data "$DATA" --out /tmp/rouge-tournament
      --r1-29b "$R1_29B")
if [ -n "${FINALISTS:-}" ]; then args+=(--finalists "$FINALISTS"); fi
python -m native.tournament run "${args[@]}"
