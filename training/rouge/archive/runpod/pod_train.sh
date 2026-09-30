#!/usr/bin/env bash
# Runs ON the pod, started over SSH by training/rouge/runpod/session.py.
#
# Lifecycle: START -> VERIFY_HW -> VERIFY_DATA -> VERIFY_BASE_CKPT -> TRAIN
# (checkpoints on the network volume) -> EVAL (by the trainer) -> DONE.
# Every phase is appended to $RUN_DIR/phases.jsonl; the launcher follows it.
#
# Kill switches on the pod (the launcher deletes the pod on every exit path
# as well):
# - hard deadline: training gets `timeout` up to ROUGE_DEADLINE_EPOCH minus
#   a checkpoint margin, and the trainer's own --budget-min stops earlier
#   with a checkpoint (exit 75);
# - watchdog: no new telemetry line for 15 minutes after training started
#   kills the trainer (no idle paid GPU);
# - at the deadline the pod stops itself through the RunPod API.
#
# Environment: ROUGE_TASK (train|prepare), ROUGE_RUN (run name), ROUGE_CONFIG,
# ROUGE_STEPS, ROUGE_BATCH, ROUGE_ACCUM, ROUGE_SEQ, ROUGE_LR, ROUGE_CORPUS,
# ROUGE_DEADLINE_EPOCH, ROUGE_EXPECT_GPU (H200), ROUGE_TOKENS (prepare).
set -uo pipefail

VOL=/workspace/rouge
CODE="$(cd "$(dirname "$0")/.." && pwd)"             # training/rouge of the pinned commit
RUN_DIR="$VOL/runs/$ROUGE_RUN"
DATA="$VOL/data/$ROUGE_CORPUS"
mkdir -p "$RUN_DIR"
phase() { printf '{"phase": "%s", "at": "%s"%s}\n' "$1" "$(date -u +%FT%TZ)" "${2:+, \"note\": \"$2\"}" >> "$RUN_DIR/phases.jsonl"; }
fail() { phase FAILED "$1"; exit "${2:-1}"; }

stop_self() {
  if [[ -n "${RUNPOD_POD_ID:-}" && -n "${RUNPOD_API_KEY:-}" ]]; then
    curl -sS -o /dev/null -X POST -H "Authorization: Bearer $RUNPOD_API_KEY" "https://rest.runpod.io/v1/pods/$RUNPOD_POD_ID/stop" || true
  fi
}
# deadline guard: stop the pod even if the launcher is gone
( now=$(date +%s); sleep $(( ROUGE_DEADLINE_EPOCH - now > 0 ? ROUGE_DEADLINE_EPOCH - now : 0 )); phase DEADLINE; stop_self ) &

phase START
# shellcheck disable=SC1091
. "$VOL/venv/bin/activate" || fail "no venv on the volume"
cd "$CODE"

if [[ "$ROUGE_TASK" == "prepare" ]]; then
  phase PREPARE "corpus $ROUGE_CORPUS, $ROUGE_TOKENS tokens"
  python -m native.data.build --out "$DATA" --tokens "$ROUGE_TOKENS" --tokenizer configs/native/data-v1/tokenizer.json \
    > "$RUN_DIR/prepare.log" 2>&1 || fail "data build failed"
  python -m native.data.verify --data "$DATA" >> "$RUN_DIR/prepare.log" 2>&1 || fail "data verify failed"
  phase DONE
  exit 0
fi

gpu="$(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)"
[[ "$gpu" == *"${ROUGE_EXPECT_GPU:-H200}"* ]] || fail "expected ${ROUGE_EXPECT_GPU:-H200}, got $gpu" 10
phase VERIFY_HW "$gpu"

python -m native.data.verify --data "$DATA" > "$RUN_DIR/verify.log" 2>&1 || fail "corpus does not match its manifest" 11
phase VERIFY_DATA

if compgen -G "$RUN_DIR/checkpoints/step_*" > /dev/null; then
  python - "$RUN_DIR" <<'PY' || fail "no checkpoint of this run passes its hash manifest" 12
import sys
from native import checkpoint
found = checkpoint.latest(sys.argv[1])
if found is None:
    sys.exit(1)
print(f"resume from {found[0].name}")
PY
  phase VERIFY_BASE_CKPT "resume"
else
  phase VERIFY_BASE_CKPT "fresh start"
fi

# watchdog: no telemetry progress for 15 minutes -> kill the trainer
(
  sleep 900
  while pgrep -f "native.train" > /dev/null; do
    last=$(stat -c %Y "$RUN_DIR/telemetry.jsonl" 2>/dev/null || echo 0)
    if (( $(date +%s) - last > 900 )); then phase WATCHDOG "no progress for 15 min"; pkill -f "native.train"; break; fi
    sleep 60
  done
) &

left=$(( ROUGE_DEADLINE_EPOCH - $(date +%s) - 600 ))       # 10 minutes for the final checkpoint and teardown
(( left > 600 )) || fail "less than 20 minutes left before the deadline"
budget=$(( (left - 900) / 60 ))                            # the trainer checkpoints and exits 75 at its budget
phase TRAIN "budget ${budget} min"
timeout "$left" python -m native.train --config "$ROUGE_CONFIG" --data "$DATA" --out "$RUN_DIR" \
  --steps "$ROUGE_STEPS" --batch "$ROUGE_BATCH" --accum "$ROUGE_ACCUM" --seq "$ROUGE_SEQ" --lr "$ROUGE_LR" \
  --warmup "${ROUGE_WARMUP:-1000}" --schedule wsd --decay-frac 0.2 --eval-every "${ROUGE_EVAL_EVERY:-1000}" \
  --ckpt-every "${ROUGE_CKPT_EVERY:-500}" --budget-min "$budget" --final-eval full --grad-ckpt \
  ${ROUGE_COMPILE:+--compile} --peak-tflops 989 > "$RUN_DIR/train.log" 2>&1
code=$?
case $code in
  0) phase DONE ;;
  75) phase SEGMENT_END "checkpoint saved at the time budget; the next segment resumes" ;;
  124) fail "hard deadline reached" 124 ;;
  *) fail "trainer exit $code" "$code" ;;
esac
exit $code
