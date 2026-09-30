#!/usr/bin/env bash
# Runs inside a Lightning GPU job (cwd: training/rouge of the pinned commit), started by train_session.py.
#
# Lifecycle: START -> VERIFY_HW -> VERIFY_DATA -> VERIFY_BASE_CKPT -> TRAIN (checkpoints synced to the
# teamspace drive every ROUGE_SYNC_MIN minutes) -> EVAL (by the trainer) -> UPLOAD -> PUBLISH -> DONE.
# Each phase prints a ROUGE_PHASE line; the result prints as ROUGE_TRAIN {json}.
# Kill switches: the trainer's time budget (checkpoint + exit 75), a hard `timeout`, a watchdog that
# stops training after 15 minutes without new telemetry, and the launcher's job.stop() at its deadline.
#
# Environment: ROUGE_RUN (lineage name), ROUGE_CONFIG, ROUGE_CORPUS, ROUGE_STEPS, ROUGE_BATCH,
# ROUGE_ACCUM, ROUGE_SEQ, ROUGE_LR, ROUGE_BUDGET_MIN, ROUGE_EXPECT_GPU (GPU family, e.g. T4 or H100),
# ROUGE_NPROC (GPUs of the machine: one rank each, data parallel through torchrun), ROUGE_PEAK_TFLOPS
# (per GPU, for MFU), ROUGE_MODEL_NAME, ROUGE_SYNC_MIN.
set -uo pipefail
RUN_DIR=/tmp/rouge-run
DATA=/tmp/rouge-data
REMOTE_RUN="rouge/runs/$ROUGE_RUN"
phase() { echo "ROUGE_PHASE $1 $(date -u +%FT%TZ) ${2:-}"; }
fail() { phase FAILED "$1"; exit "${2:-1}"; }

phase START
gpu="$(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)"
ngpu="$(nvidia-smi -L | grep -c '^GPU')"
NPROC="${ROUGE_NPROC:-1}"
[[ "$gpu" == *"${ROUGE_EXPECT_GPU}"* ]] || fail "expected ${ROUGE_EXPECT_GPU}, got $gpu" 10
(( ngpu == NPROC )) || fail "expected $NPROC GPU(s), found $ngpu" 10
phase VERIFY_HW "$ngpu x $gpu"

python lightning_ai/storage.py download "rouge/data/$ROUGE_CORPUS" "$DATA" || fail "corpus download failed" 11
DATA_ROOT="$(dirname "$(find "$DATA" -name manifest.json -not -path '*/checkpoints/*' | head -1)")"
python -m native.data.verify --data "$DATA_ROOT" || fail "corpus does not match its manifest" 11
phase VERIFY_DATA "$DATA_ROOT"

mkdir -p "$RUN_DIR"
if python lightning_ai/storage.py download "$REMOTE_RUN" "$RUN_DIR/prev" 2>/dev/null; then
  prev="$(dirname "$(find "$RUN_DIR/prev" -name MANIFEST.sha256.json | head -1)")"
  cp -r "$prev"/. "$RUN_DIR"/ && rm -rf "$RUN_DIR/prev"
  python -c "import sys; from native import checkpoint; sys.exit(0 if checkpoint.latest('$RUN_DIR') else 1)" \
    || fail "no checkpoint of this run passes its hash manifest" 12
  phase VERIFY_BASE_CKPT resume
else
  phase VERIFY_BASE_CKPT "fresh start"
fi

# checkpoint sync to the model registry while training (the job's disk is not persistent)
(
  while sleep "$(( ${ROUGE_SYNC_MIN:-20} * 60 ))"; do
    python lightning_ai/storage.py upload "$RUN_DIR" "$REMOTE_RUN" > /dev/null 2>&1 && phase SYNC
  done
) &
SYNC_PID=$!
# watchdog: no new telemetry for 15 minutes -> stop the trainer (no idle paid GPU)
(
  sleep 900
  while pgrep -f "native.train" > /dev/null; do
    last=$(stat -c %Y "$RUN_DIR/telemetry.jsonl" 2>/dev/null || echo 0)
    if (( $(date +%s) - last > 900 )); then phase WATCHDOG "no progress for 15 min"; pkill -f "native.train"; break; fi
    sleep 60
  done
) &

phase TRAIN "budget ${ROUGE_BUDGET_MIN} min"
if (( NPROC > 1 )); then LAUNCH=(torchrun --standalone --nproc-per-node "$NPROC"); else LAUNCH=(python); fi
timeout "$(( (ROUGE_BUDGET_MIN + 30) * 60 ))" "${LAUNCH[@]}" -m native.train --config "$ROUGE_CONFIG" --data "$DATA_ROOT" \
  --out "$RUN_DIR" --steps "$ROUGE_STEPS" --batch "$ROUGE_BATCH" --accum "$ROUGE_ACCUM" --seq "$ROUGE_SEQ" \
  --lr "$ROUGE_LR" --warmup "${ROUGE_WARMUP:-1000}" --schedule wsd --decay-frac 0.2 --eval-every "${ROUGE_EVAL_EVERY:-1000}" \
  --ckpt-every "${ROUGE_CKPT_EVERY:-500}" --budget-min "$ROUGE_BUDGET_MIN" --final-eval full --peak-tflops "${ROUGE_PEAK_TFLOPS:-989}" \
  > "$RUN_DIR/train.log" 2>&1
code=$?
kill "$SYNC_PID" 2>/dev/null
tail -n 20 "$RUN_DIR/train.log"

python lightning_ai/storage.py upload "$RUN_DIR" "$REMOTE_RUN" || fail "upload of the run failed" 13
phase UPLOAD "$REMOTE_RUN"
case $code in
  0)
    python lightning_ai/storage.py publish "$RUN_DIR" "$ROUGE_MODEL_NAME" "$ROUGE_RUN" && phase PUBLISH "$ROUGE_MODEL_NAME:$ROUGE_RUN"
    echo "ROUGE_TRAIN $(python -c "import json; print(json.dumps(json.load(open('$RUN_DIR/result.json'))))")"
    phase DONE ;;
  75) phase SEGMENT_END "checkpoint saved at the time budget; the next segment resumes" ;;
  124) fail "hard timeout" 124 ;;
  *) fail "trainer exit $code" "$code" ;;
esac
exit 0
