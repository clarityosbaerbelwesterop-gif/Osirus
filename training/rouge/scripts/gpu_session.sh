#!/usr/bin/env bash
# One ephemeral GPU session for a pre-registered Rouge experiment:
#
#   START -> PREPARE -> TRAIN -> EVALUATE -> SAVE -> STOP
#
# Run on a freshly rented single-GPU host, from the repository root:
#
#   training/rouge/scripts/gpu_session.sh rouge-1-exp-001
#
# Environment (secrets live only on the host, never in Git or logs):
#   HF_TOKEN        Hugging Face token with write access to ROUGE_HF_REPO
#   ROUGE_HF_REPO   private model repository for Rouge checkpoints (owner/name)
#   GH_TOKEN        GitHub token with read access to this repository's Actions
#                   artifacts (the built dataset)
#   RUNPOD_POD_ID   set by RunPod; when present the pod stops itself at exit
#   KEEP_POD=1      keep the pod running after the session (debugging only)
#
# The pod stops on every exit path -- success, failure or the training cost
# guard -- so no paid GPU sits idle. Every phase's wall-clock time is written
# to session.json for the next cost estimate.
set -euo pipefail

EXP="${1:?experiment name, e.g. rouge-1-exp-001}"
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
ROUGE="$REPO_ROOT/training/rouge"
PREREG="$ROUGE/experiments/$EXP.json"
WORK="${WORK:-/workspace}"
SESSION="$WORK/sessions/$EXP"
mkdir -p "$SESSION"

: "${HF_TOKEN:?HF_TOKEN is required}" "${ROUGE_HF_REPO:?ROUGE_HF_REPO is required}" "${GH_TOKEN:?GH_TOKEN is required}"
export HF_TOKEN

stop_pod() {
  local status=$?
  echo "session exit status $status"
  if [[ -n "${RUNPOD_POD_ID:-}" && "${KEEP_POD:-0}" != "1" ]]; then
    runpodctl stop pod "$RUNPOD_POD_ID" || echo "WARNING: could not stop pod $RUNPOD_POD_ID -- stop it by hand"
  fi
}
trap stop_pod EXIT

phase() {
  python3 - "$SESSION/session.json" "$1" <<'EOF'
import json, sys, time
path, name = sys.argv[1], sys.argv[2]
try:
    data = json.load(open(path))
except FileNotFoundError:
    data = {"phases": []}
data["phases"].append({"phase": name, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
json.dump(data, open(path, "w"), indent=1)
EOF
  echo "== $1 $(date -u +%H:%M:%S)"
}

field() { python3 -c "import json,sys; d=json.load(open(sys.argv[1])); [d:=d[k] for k in sys.argv[2].split('.')]; print(d)" "$1" "$2"; }

CONFIG="$REPO_ROOT/$(field "$PREREG" config)"
DATA_MANIFEST="$REPO_ROOT/$(field "$PREREG" data.manifest)"
ARTIFACT_ID="$(field "$DATA_MANIFEST" build.artifact_id)"
BASE_REPO="$(field "$REPO_ROOT/models/rouge-1/base.json" source.repo)"
BASE_REV="$(field "$REPO_ROOT/models/rouge-1/base.json" source.revision)"
BASE_DIR="$(field "$CONFIG" base_path)"
DATA_DIR="$(dirname "$(field "$CONFIG" train_file)")"
RUN_DIR="$(field "$CONFIG" output_dir)"
MERGED="$WORK/ckpt/$EXP"
MAX_NEW="$(field "$PREREG" eval.settings.max_new_tokens)"

phase start
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | tee "$SESSION/gpu.txt"

phase prepare
python3 -m pip install -q -r "$ROUGE/requirements-gpu.txt"
python3 -m venv "$WORK/venv-eval" && "$WORK/venv-eval/bin/pip" install -q -r "$ROUGE/requirements-eval.txt"
hf download "$BASE_REPO" --revision "$BASE_REV" --local-dir "$BASE_DIR" --quiet
(cd "$ROUGE" && python3 -m rouge_train.cli verify --base "$BASE_DIR" > "$SESSION/verify-base.json")
mkdir -p "$DATA_DIR"
curl -sSfL -H "Authorization: Bearer $GH_TOKEN" -o "$SESSION/data.zip" \
  "https://api.github.com/repos/clarityosbaerbelwesterop-gif/Osirus/actions/artifacts/$ARTIFACT_ID/zip"
unzip -oq "$SESSION/data.zip" -d "$DATA_DIR"
(cd "$ROUGE" && python3 -m rouge_train.cli verify-data --data "$DATA_DIR" --manifest "$DATA_MANIFEST")

phase train
(cd "$ROUGE" && python3 -m rouge_train.cli train --config "$CONFIG" | tee "$SESSION/train.txt")
if [[ ! -f "$RUN_DIR/train-report.json" ]]; then
  echo "training stopped before the end (cost guard or stop_after): see $RUN_DIR/metrics.jsonl"
  exit 3
fi

phase merge
(cd "$ROUGE" && python3 -m rouge_train.cli merge --config "$CONFIG" --out "$MERGED")

phase evaluate
for model in base rouge; do
  path="$BASE_DIR"; [[ "$model" == rouge ]] && path="$MERGED"
  (cd "$ROUGE" && "$WORK/venv-eval/bin/python" -m rouge_train.cli generate --model "$path" --items "$DATA_DIR/eval.jsonl" \
    --out "$SESSION/$model.jsonl" --max-new-tokens "$MAX_NEW")
done
(cd "$ROUGE" && python3 -m rouge_train.cli compare --items "$DATA_DIR/eval.jsonl" --base "$SESSION/base.jsonl" \
  --rouge "$SESSION/rouge.jsonl" --out "$SESSION/report.json" --prereg "$PREREG" | tee "$SESSION/compare.txt")

phase save
(cd "$ROUGE" && python3 -m rouge_train.cli manifest --config "$CONFIG" --merged "$MERGED" --report "$SESSION/report.json" \
  --storage "hf://$ROUGE_HF_REPO/$EXP" --out "$SESSION/checkpoints" | tee "$SESSION/manifest-path.txt")
hf repo create "$ROUGE_HF_REPO" --private --exist-ok >/dev/null 2>&1 || true
hf upload "$ROUGE_HF_REPO" "$RUN_DIR/adapter" "$EXP/adapter" --quiet
hf upload "$ROUGE_HF_REPO" "$SESSION" "$EXP/session" --exclude "*.zip" --quiet

phase stop
echo "done: $(grep -m1 '^verdict' "$SESSION/compare.txt" || echo 'verdict missing')"
