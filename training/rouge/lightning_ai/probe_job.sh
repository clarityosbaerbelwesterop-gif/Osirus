#!/usr/bin/env bash
# Runs inside a Lightning CPU job: what can a job reach and keep? Prints names only, never values.
# ROUGE_PROBE_MODE=write leaves a marker in every writable /teamspace path; =read looks for markers
# written by an earlier job (persistence across jobs without credentials).
set -uo pipefail
echo "ROUGE_PROBE env names: $(env | cut -d= -f1 | grep -iE 'lightning|teamspace' | sort | tr '\n' ' ')"
for d in /teamspace/studios/this_studio /teamspace/uploads /teamspace/jobs /teamspace/efs_folders /teamspace/lightning_storage; do
  [ -e "$d" ] || continue
  if [ "${ROUGE_PROBE_MODE:-write}" = "write" ]; then
    if mkdir -p "$d/rouge-probe" 2>/dev/null && echo "$ROUGE_PROBE_TAG" > "$d/rouge-probe/marker" 2>/dev/null; then
      echo "ROUGE_PROBE writable $d"
    else
      echo "ROUGE_PROBE read-only $d"
    fi
  else
    if [ -f "$d/rouge-probe/marker" ]; then echo "ROUGE_PROBE persisted $d marker=$(cat "$d/rouge-probe/marker")"; else echo "ROUGE_PROBE not-persisted $d"; fi
  fi
done
