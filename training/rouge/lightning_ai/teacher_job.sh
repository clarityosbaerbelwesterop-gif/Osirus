#!/usr/bin/env bash
# Teacher job: self-hosted DeepSeek-V4-Pro (MIT weights, pinned in models/teachers/) answers the prompts
# Rouge never solved in an earlier iteration; only code-verified answers are kept and stored for training.
# Runs inside a Lightning job on 8 x B200 (native FP4 for the teacher's experts), started by rouge1_session.py --teacher.
#
#   START -> SETUP -> TEACHER (download the pinned revision, verify every sha256) -> PROMPTS (hard.jsonl of the
#   earlier run's reports, from the private registry) -> SAMPLE (one tensor-parallel engine over all GPUs)
#   -> SELECT (code checks) -> UPLOAD (rouge/data/teacher-<run>) -> DONE
#
# API terms never apply: the outputs come from the MIT-licensed weights running on our own machine.
# Environment: ROUGE_RUN (the earlier run whose hard prompts are answered), ROUGE_TEACHER (manifest path),
# ROUGE_NPROC, ROUGE_EXPECT_GPU, ROUGE_TEACHER_K, ROUGE_TEACHER_MAX_NEW, ROUGE_TEACHER_PROMPTS.
set -uo pipefail
W=/tmp/teacher
mkdir -p "$W"
phase() { echo "ROUGE_PHASE $1 $(date -u +%FT%TZ) ${2:-}"; }
fail() { phase FAILED "$1"; exit "${2:-1}"; }
field() { python -c "import json,sys; d=json.load(open(sys.argv[1])); [d:=d[k] for k in sys.argv[2].split('.')]; print(d)" "$1" "$2"; }

phase START
NPROC="${ROUGE_NPROC:-8}"
gpu="$(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)"
ngpu="$(nvidia-smi -L | grep -c '^GPU')"
[[ "$gpu" == *"${ROUGE_EXPECT_GPU}"* ]] || fail "expected ${ROUGE_EXPECT_GPU}, got $gpu" 10
(( ngpu == NPROC )) || fail "expected $NPROC GPU(s), found $ngpu" 10
phase VERIFY_HW "$ngpu x $gpu"

phase SETUP
python -m venv "$W/venv" && "$W/venv/bin/pip" install -q -r requirements-eval.txt huggingface_hub hf_xet || fail "environment" 20
PY="$W/venv/bin/python"

phase TEACHER
REPO="$(field "$ROUGE_TEACHER" source.repo)"; REV="$(field "$ROUGE_TEACHER" source.revision)"
"$W/venv/bin/hf" download "$REPO" --revision "$REV" --local-dir "$W/model" --quiet || fail "teacher download" 21
python - "$W/model" "$ROUGE_TEACHER" <<'PYEOF' || fail "teacher weights differ from the pinned manifest" 22
import json, sys
from pathlib import Path
from rouge_train.manifest import verify_download
result = verify_download(Path(sys.argv[1]), json.load(open(sys.argv[2])))
print(json.dumps(result.__dict__ | {"ok": result.ok}))
sys.exit(0 if result.ok else 1)
PYEOF
phase TEACHER_VERIFIED "$REPO@${REV:0:12}"

phase PROMPTS
python lightning_ai/storage.py download "rouge/runs/$ROUGE_RUN-reports" "$W/reports" || fail "reports of $ROUGE_RUN" 23
HARD="$(find "$W/reports" -name hard.jsonl | head -1)"
[[ -s "$HARD" ]] || fail "no hard prompts in the reports of $ROUGE_RUN" 24
head -n "${ROUGE_TEACHER_PROMPTS:-1500}" "$HARD" > "$W/prompts.jsonl"
phase PROMPTS_READY "$(wc -l < "$W/prompts.jsonl") prompts Rouge never solved"

phase SAMPLE
timeout 7200 "$PY" -m rouge_train.cli rft-sample --model "$W/model" --prompts "$W/prompts.jsonl" --out "$W/samples.jsonl" \
  --k "${ROUGE_TEACHER_K:-2}" --max-new-tokens "${ROUGE_TEACHER_MAX_NEW:-12288}" --tensor-parallel "$NPROC" \
  --max-model-len 20480 > "$W/sample.log" 2>&1 || { tail -n 30 "$W/sample.log"; fail "teacher sampling" 25; }

phase SELECT
mkdir -p "$W/out"
python -m rouge_train.cli rft-select --prompts "$W/prompts.jsonl" --samples "$W/samples.jsonl" --out "$W/out/teacher.jsonl" \
  --report "$W/out/teacher-report.json" --easy-fraction 1.0 --source-prefix teacher-deepseek-v4-pro || fail "selection" 26
cp "$ROUGE_TEACHER" "$W/out/teacher-manifest.json"

phase UPLOAD
python lightning_ai/storage.py upload "$W/out" "rouge/data/teacher-$ROUGE_RUN" || fail "upload" 27
echo "ROUGE_TRAIN $(python -c "import json; r=json.load(open('$W/out/teacher-report.json')); print(json.dumps({'teacher': '$REPO', 'run': '$ROUGE_RUN', **{k: r[k] for k in ('prompts', 'samples', 'sample_accuracy', 'buckets', 'records')}}))")"
phase DONE
exit 0
