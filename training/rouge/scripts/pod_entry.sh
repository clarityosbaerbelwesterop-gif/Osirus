#!/usr/bin/env bash
# Entry point on a rented GPU pod (started by .github/workflows/rouge-gpu.yml).
#
# Runs ONE gpu_session.sh under a hard time limit, reports the outcome to the
# private Rouge model repository (the launcher watches it there), stops the
# pod, and never runs a session twice -- a restarted container reports itself
# instead of training again.
#
# Environment: EXPERIMENT, HF_TOKEN, ROUGE_HF_REPO, MAX_HOURS, DATA_FROM_HF=1,
# ROUGE_RUN_ID (reports go to <experiment>/sessions/<run id>/);
# RunPod sets RUNPOD_POD_ID (and a pod-scoped RUNPOD_API_KEY).
set -uo pipefail

EXP="${EXPERIMENT:?EXPERIMENT is required}"
: "${HF_TOKEN:?}" "${ROUGE_HF_REPO:?}"
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
export HF_PREFIX="$EXP/sessions/${ROUGE_RUN_ID:-manual}"  # one namespace per launch
LOG=/workspace/session.log
mkdir -p /workspace

python3 -m venv /opt/rouge-venv
# shellcheck disable=SC1091
. /opt/rouge-venv/bin/activate
python3 -m pip install -q --upgrade pip huggingface_hub hf_xet

report() {  # report <file> <path in repo>
  hf upload "$ROUGE_HF_REPO" "$1" "$HF_PREFIX/$2" --quiet >/dev/null 2>&1 || echo "report upload failed: $2"
}

stop_self() {
  if [[ -n "${RUNPOD_POD_ID:-}" ]]; then
    if command -v runpodctl >/dev/null; then runpodctl stop pod "$RUNPOD_POD_ID" && return; fi
    if [[ -n "${RUNPOD_API_KEY:-}" ]]; then
      curl -sS -o /dev/null -X POST -H "Authorization: Bearer $RUNPOD_API_KEY" "https://rest.runpod.io/v1/pods/$RUNPOD_POD_ID/stop"
    fi
  fi
}

write_result() {  # write_result <exit code> <note>
  python3 - "$1" "$2" > /workspace/result.json <<'EOF'
import json, os, sys, time
print(json.dumps({"exit_code": int(sys.argv[1]), "note": sys.argv[2], "pod": os.environ.get("RUNPOD_POD_ID"),
                  "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}))
EOF
  report /workspace/result.json result.json
}

# A session starts once per pod. If the container restarts, do not train
# again: report it and stop.
if hf download "$ROUGE_HF_REPO" "$HF_PREFIX/started-${RUNPOD_POD_ID:-local}.json" --local-dir /tmp/rouge-check --quiet >/dev/null 2>&1; then
  write_result 97 "container restarted after the session had started; not running it twice"
  stop_self
  sleep infinity
fi
date -u +"{\"started_at\": \"%Y-%m-%dT%H:%M:%SZ\"}" > /workspace/started.json
report /workspace/started.json "started-${RUNPOD_POD_ID:-local}.json"

limit="$(python3 -c "import os; print(int(float(os.environ.get('MAX_HOURS', '4.5')) * 3600))")"
KEEP_POD=1 timeout "$limit" "$REPO_ROOT/training/rouge/scripts/gpu_session.sh" "$EXP" > "$LOG" 2>&1
code=$?
note="finished"
[[ $code -eq 124 ]] && note="hard time limit reached"
[[ $code -eq 3 ]] && note="training cost guard stopped the run"

tail -c 300000 "$LOG" > /workspace/session-tail.log
report /workspace/session-tail.log session.log
write_result "$code" "$note"
stop_self
sleep infinity
