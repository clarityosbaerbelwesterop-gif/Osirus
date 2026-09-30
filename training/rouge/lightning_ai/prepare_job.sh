#!/usr/bin/env bash
# Runs on a GitHub runner (cwd training/rouge; see rouge-train.yml) or inside a Lightning CPU job: builds
# the production corpus with the frozen tokenizer, verifies it, uploads it to the Lightning model registry
# (rouge/data/$ROUGE_CORPUS) and prints its manifest as ROUGE_PREPARE.
set -euo pipefail
OUT=/tmp/rouge-corpus
python -m native.data.build --out "$OUT" --tokens "$ROUGE_TOKENS" --mixture v2 --tokenizer configs/native/data-v1/tokenizer.json
python -m native.data.verify --data "$OUT"
rm -rf "$OUT/cache"                                   # downloaded code archives are not part of the corpus
python lightning_ai/storage.py upload "$OUT" "rouge/data/$ROUGE_CORPUS"
echo "ROUGE_PREPARE $(python -c "import json; print(json.dumps(json.load(open('$OUT/manifest.json'))))")"
