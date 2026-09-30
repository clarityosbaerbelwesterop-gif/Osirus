#!/usr/bin/env bash
# Runs inside a Lightning job: the full pipeline dry run on the GPU (bf16), result as a ROUGE_DRYRUN line.
set -euo pipefail
python -m native.dryrun --out /tmp/rouge-dryrun
