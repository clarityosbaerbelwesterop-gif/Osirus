#!/usr/bin/env bash
# Rouge 1 on a Lightning multi-GPU machine (8 x H200 by default): one RSI iteration on the pinned base.
# Runs inside the job (cwd: training/rouge of the pinned commit), started by rouge1_session.py.
#
#   START -> SETUP -> BASE (download the pinned revision from the Hub, verify every sha256)
#   -> DATA (built dataset from the private registry, verified against the committed manifest)
#   -> EVAL_BASE (pre-registered eval set, one vLLM engine per GPU)
#   -> SAMPLE (the base answers verifiable prompts k times) -> SELECT (code-verified answers only)
#   -> TRAIN (full-parameter, FSDP2 over every GPU) -> EVAL_ROUGE (same items, same settings)
#   -> VERDICT (pre-registered rule) -> SAVE (checkpoint manifest; model to the private registry) -> DONE
#
# Each phase prints a ROUGE_PHASE line; the summary prints as ROUGE_TRAIN {json}. Weights never leave the
# private teamspace. Kill switches: the trainer's budget check, a hard `timeout` per stage, and the
# launcher's job.stop() at its deadline.
#
# Environment: ROUGE_RUN (checkpoint name), ROUGE_PREREG (experiments/<name>.json), ROUGE_DATASET
# (registry path of the built dataset), ROUGE_NPROC, ROUGE_EXPECT_GPU, ROUGE_PEAK_TFLOPS, ROUGE_RFT_PROMPTS,
# ROUGE_RFT_K, ROUGE_TRAIN_HOURS, ROUGE_PARENT (optional registry path of a Rouge checkpoint to start from:
# the next RSI iteration samples from and trains the latest promoted Rouge instead of the base).
set -uo pipefail
W=/tmp/rouge1
BASE="$W/base"; DATA="$W/data"; RUN="$W/run"; EVAL="$W/eval"; SAMPLES="$W/samples"
mkdir -p "$W" "$EVAL" "$SAMPLES"
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
cuda_major="$(nvidia-smi | sed -n 's/.*CUDA Version: \([0-9]*\).*/\1/p' | head -1)"
if [[ "${cuda_major:-0}" -lt 13 ]]; then   # torch wheels bundle CUDA: the 12.8 build where the driver predates CUDA 13
  python -m pip install -q --index-url https://download.pytorch.org/whl/cu128 "$(grep -E '^torch==' requirements-gpu.txt)" || fail "torch for CUDA 12" 20
fi
python -m pip install -q -r requirements-gpu.txt || fail "training environment" 20
python -m venv "$W/venv-eval" && "$W/venv-eval/bin/pip" install -q -r requirements-eval.txt || fail "evaluation environment" 21
EVALPY="$W/venv-eval/bin/python"

phase BASE
BASE_REPO="$(field ../../models/rouge-1/base.json source.repo)"
BASE_REV="$(field ../../models/rouge-1/base.json source.revision)"
hf download "$BASE_REPO" --revision "$BASE_REV" --local-dir "$BASE" --quiet || fail "base download" 22
python -m rouge_train.cli verify --base "$BASE" > "$W/verify-base.json" || fail "base weights differ from the pinned manifest" 23
START_MODEL="$BASE"
if [[ -n "${ROUGE_PARENT:-}" ]]; then
  python lightning_ai/storage.py download "$ROUGE_PARENT" "$W/parent" || fail "parent checkpoint download or verification" 24
  START_MODEL="$(dirname "$(find "$W/parent" -name config.json | head -1)")"
fi
phase BASE_VERIFIED "$BASE_REPO@${BASE_REV:0:12}; start $( [[ "$START_MODEL" == "$BASE" ]] && echo base || echo "$ROUGE_PARENT")"

phase DATA
python lightning_ai/storage.py download "$ROUGE_DATASET" "$W/dl" || fail "dataset download" 25
DL="$(dirname "$(find "$W/dl" -name manifest.json | head -1)")"
DATA_MANIFEST="datasets/manifests/$(field "$ROUGE_PREREG" data.manifest | xargs basename)"
mkdir -p "$DATA" && cp "$DL"/*.jsonl "$DATA"/
python -m rouge_train.cli verify-data --data "$DATA" --manifest "$DATA_MANIFEST" > "$W/verify-data.json" || fail "dataset differs from its committed manifest" 26
MAX_NEW="$(field "$ROUGE_PREREG" eval.settings.max_new_tokens)"
THINK="$(field "$ROUGE_PREREG" eval.settings.enable_thinking)"
THINK_FLAG=(); [[ "$THINK" == "True" ]] && THINK_FLAG=(--thinking)

# one engine per GPU over a contiguous shard of the items; outputs concatenate in order
shard() {  # shard FILE N PREFIX
  python - "$1" "$2" "$3" <<'EOF'
import sys
lines = open(sys.argv[1]).read().splitlines(); n = int(sys.argv[2]); size = -(-len(lines) // n)
for i in range(n):
    open(f"{sys.argv[3]}.{i}.jsonl", "w").write("".join(l + "\n" for l in lines[i * size:(i + 1) * size]))
EOF
}
evaluate() {  # evaluate MODEL TAG
  shard "$DATA/eval.jsonl" "$NPROC" "$EVAL/items"
  for i in $(seq 0 $((NPROC - 1))); do
    [[ -s "$EVAL/items.$i.jsonl" ]] || continue
    CUDA_VISIBLE_DEVICES=$i timeout 5400 "$EVALPY" -m rouge_train.cli generate --model "$1" --items "$EVAL/items.$i.jsonl" \
      --out "$EVAL/$2.$i.jsonl" --max-new-tokens "$MAX_NEW" "${THINK_FLAG[@]}" > "$EVAL/$2.$i.log" 2>&1 &
  done
  wait
  for i in $(seq 0 $((NPROC - 1))); do [[ -s "$EVAL/items.$i.jsonl" ]] && { cat "$EVAL/$2.$i.jsonl" || return 1; }; done > "$EVAL/$2.jsonl"
  [[ "$(wc -l < "$EVAL/$2.jsonl")" == "$(wc -l < "$DATA/eval.jsonl")" ]]
}

phase EVAL_BASE
evaluate "$START_MODEL" base || fail "baseline evaluation" 30

phase SAMPLE "${ROUGE_RFT_PROMPTS:-3200} prompts x ${ROUGE_RFT_K:-4}"
head -n "${ROUGE_RFT_PROMPTS:-3200}" "$DATA/prompts.jsonl" > "$W/prompts.jsonl"
shard "$W/prompts.jsonl" "$NPROC" "$SAMPLES/prompts"
for i in $(seq 0 $((NPROC - 1))); do
  [[ -s "$SAMPLES/prompts.$i.jsonl" ]] || continue
  CUDA_VISIBLE_DEVICES=$i timeout 5400 "$EVALPY" -m rouge_train.cli rft-sample --model "$START_MODEL" --prompts "$SAMPLES/prompts.$i.jsonl" \
    --out "$SAMPLES/out.$i.jsonl" --k "${ROUGE_RFT_K:-4}" --max-new-tokens "${ROUGE_RFT_MAX_NEW:-6144}" --seed "$i" > "$SAMPLES/log.$i" 2>&1 &
done
wait
phase SELECT
python -m rouge_train.cli rft-select --prompts "$W/prompts.jsonl" --samples "$SAMPLES"/out.*.jsonl \
  --out "$W/rft.jsonl" --report "$W/rft-report.json" || fail "selection" 31
cat "$DATA/train.jsonl" "$W/rft.jsonl" > "$W/train.jsonl"
phase SELECTED "$(python -c "import json; r=json.load(open('$W/rft-report.json')); print(r['records'], 'records; sample accuracy', round(r['sample_accuracy'], 3), r['buckets'])")"

phase TRAIN
python - "$W" "$START_MODEL" <<'EOF' || fail "run config" 32
import json, os, sys
w, start = sys.argv[1], sys.argv[2]
cfg = json.load(open(os.environ["ROUGE_CONFIG"]))
cfg.update(base_path=start, tokenizer_path=start, train_file=f"{w}/train.jsonl", eval_file=None, output_dir=f"{w}/run",
           name=os.environ["ROUGE_RUN"], max_train_hours=float(os.environ.get("ROUGE_TRAIN_HOURS", "1.0")))
json.dump(cfg, open(f"{w}/config.json", "w"), indent=1)
EOF
ROUGE_PEAK_TFLOPS="${ROUGE_PEAK_TFLOPS:-989}" timeout 10800 torchrun --standalone --nproc-per-node "$NPROC" \
  -m rouge_train.cli train --config "$W/config.json" > "$W/train.log" 2>&1
code=$?
tail -n 30 "$W/train.log"
[[ $code == 0 && -f "$RUN/train-report.json" ]] || fail "training exit $code (budget check or error; see train.log)" 33

phase EVAL_ROUGE
evaluate "$RUN/model" rouge || fail "candidate evaluation" 34

phase VERDICT
python -m rouge_train.cli compare --items "$DATA/eval.jsonl" --base "$EVAL/base.jsonl" --rouge "$EVAL/rouge.jsonl" \
  --out "$W/report.json" --prereg "$ROUGE_PREREG" | tee "$W/compare.txt" || fail "comparison" 35
python -c "
import json; from pathlib import Path; from rouge_train.merge import weight_delta
d = weight_delta(Path('$START_MODEL'), Path('$RUN/model')); json.dump(d, open('$W/weight-delta.json', 'w'), indent=1)
print('changed tensors', d['changed'], 'of', d['compared'])"

phase SAVE
python -m rouge_train.cli manifest --config "$W/config.json" --merged "$RUN/model" --report "$W/report.json" \
  --storage "lightning-registry://rouge-1/$ROUGE_RUN" --out "$W/checkpoints" > "$W/manifest-path.txt" || fail "checkpoint manifest" 36
mkdir -p "$W/reports" && cp "$W"/{verify-base.json,verify-data.json,rft-report.json,report.json,weight-delta.json,config.json,train.log} \
  "$RUN"/{train-report.json,metrics.jsonl} "$EVAL"/{base.jsonl,rouge.jsonl} "$W/reports/" && cp -r "$W/checkpoints" "$W/reports/"
python lightning_ai/storage.py upload "$W/reports" "rouge/runs/$ROUGE_RUN-reports" || fail "report upload" 37
python lightning_ai/storage.py upload "$RUN/model" "rouge/models/$ROUGE_RUN" || fail "model upload" 38
phase UPLOAD "rouge/models/$ROUGE_RUN"
echo "ROUGE_TRAIN $(python - "$W" <<'EOF'
import json, sys
w = sys.argv[1]
report, rft, train = (json.load(open(f"{w}/{p}")) for p in ("report.json", "rft-report.json", "run/train-report.json"))
verdict = report.get("verdict", {})
print(json.dumps({"run": train["name"], "verdict": verdict.get("result"), "primary": verdict.get("primary"),
                  "guards": {k: {x: v[x] for x in ("n", "base", "rouge", "delta", "regressed")} for k, v in verdict.get("guards", {}).items()},
                  "rft": {k: rft[k] for k in ("prompts", "samples", "sample_accuracy", "buckets", "records")},
                  "train": {k: train[k] for k in ("steps", "tokens", "first_loss", "final_loss", "world", "trainable_parameters")},
                  "weights": json.load(open(f"{w}/weight-delta.json"))["changed"]}))
EOF
)"
phase DONE
exit 0
