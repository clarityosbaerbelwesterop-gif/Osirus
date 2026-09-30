#!/usr/bin/env bash
# Runs inside a Lightning CPU job: what can a job reach? Prints names only, never values.
set -uo pipefail
echo "ROUGE_PROBE env names: $(env | cut -d= -f1 | grep -iE 'lightning|teamspace|cloudspace|grid' | sort | tr '\n' ' ')"
for d in /teamspace /teamspace/studios /teamspace/uploads /teamspace/jobs /teamspace/s3_connections /teamspace/lightning_storage; do
  if [ -e "$d" ]; then echo "ROUGE_PROBE path $d: $(ls -1 "$d" 2>/dev/null | head -5 | tr '\n' ' ')"; fi
done
df -h / /tmp 2>/dev/null | tail -2 | sed 's/^/ROUGE_PROBE disk /'
python -m pip install -q lightning-sdk >/dev/null 2>&1 && python - <<'PY'
import json
try:
    from lightning_sdk.api.user_api import UserApi
    u = UserApi()._client.auth_service_get_user()
    print("ROUGE_PROBE sdk credentials inside the job: yes")
except Exception as e:
    print("ROUGE_PROBE sdk credentials inside the job: no (" + type(e).__name__ + ")")
PY
