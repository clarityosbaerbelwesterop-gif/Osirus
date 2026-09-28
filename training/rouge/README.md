# Rouge 1 training

Rouge 1 is one model lineage: a derivative of **Qwen/Qwen3.5-27B**, pinned
in [`models/rouge-1/base.json`](../../models/rouge-1/base.json), with its
own trained checkpoints.

- Definition and milestones: [`docs/rouge/native-model.md`](../../docs/rouge/native-model.md).
- Cost: [`docs/rouge/compute-plan.md`](../../docs/rouge/compute-plan.md).

**No weights in Git.**

## Layout

| Path                                   | What                                                                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rouge_train/config.py`                | Run configuration (one JSON describes a run completely)                                                                                                                                    |
| `rouge_train/data.py`                  | JSONL conversations → base chat template → token ids, assistant-only labels (character offsets); too long or no assistant → dropped and counted                                            |
| `rouge_train/modeling.py`              | Base loading (BF16 or 4-bit NF4 QLoRA), gradient checkpointing, LoRA on all LM projections, chunked output-head loss                                                                       |
| `rouge_train/train.py`                 | Training loop with exact checkpoint/resume (adapter, optimiser, scheduler, RNG, data cursor)                                                                                               |
| `rouge_train/merge.py`                 | Adapter → canonical BF16 checkpoint; carries base-only tensors (MTP); `weight_delta` proves the weights changed                                                                            |
| `rouge_train/evaluate.py`              | Generation (vLLM or transformers) and code-only checks; base-vs-Rouge comparison with wins, regressions and McNemar                                                                        |
| `rouge_train/generators.py`            | In-house SFT and eval data, computed by code, English and German; decontamination                                                                                                          |
| `rouge_train/checkpoints.py`           | Checkpoint manifests, lineage, promotion rule                                                                                                                                              |
| `rouge_train/registry.py`, `datasets/` | Dataset registry with licence and teacher-terms gates; probe and build on a runner; `datasets/manifests/` holds the hashes of each built dataset                                           |
| `rouge_train/cli.py`                   | verify / verify-data / train / merge / generate / compare / manifest on the GPU host                                                                                                       |
| `rouge_train/smoke.py`                 | The whole path on a tiny random model of the base architecture. **The tiny model is not Rouge.**                                                                                           |
| `scripts/`                             | `base_manifest.py`, `fetch_tokenizer.py`, `verify_weights.py`, `size_qlora.py`, `size_edge.py`, `dataset_licenses.py`, `gpu_session.sh` (one ephemeral GPU session, stops the pod on exit) |
| `configs/exp-001.json`                 | The first run `rouge-1-exp-001`: QLoRA r = 16, 4k sequences, 1 GPU, 3 h cost guard                                                                                                         |
| `configs/sft-001.json`                 | Scaling after a PASS: QLoRA r = 32, 8k sequences, 1 GPU, 11 h cost guard                                                                                                                   |
| `experiments/`                         | Pre-registered experiments: eval hash, decision rule, next step for PASS and FAIL                                                                                                          |
| `rouge_train/edge.py`, `serve/`        | Rouge Edge (GGUF, quantisation, measurements) and Rouge Server (OpenAI-compatible, vLLM or llama-server)                                                                                   |
| `checkpoints/`                         | Checkpoint manifests (none yet)                                                                                                                                                            |

## Checks

```sh
python3 -m unittest discover -s training/rouge/tests          # stdlib parts
pip install -r training/rouge/requirements-smoke.txt           # CPU stack
python -m rouge_train.smoke --workdir /tmp/rouge-smoke         # from training/rouge
```

In CI, `.github/workflows/rouge-training.yml` runs the unit tests and the
smoke run with the pinned, hash-verified Qwen3.5-27B tokenizer.
`.github/workflows/rouge-data.yml` probes and builds the training data.

## A training session (after owner approval)

One command on a freshly rented single-GPU host, from the repository root:

```sh
HF_TOKEN=… ROUGE_HF_REPO=<owner>/rouge-1 GH_TOKEN=… \
  training/rouge/scripts/gpu_session.sh rouge-1-exp-001
```

It runs `START → PREPARE → TRAIN → EVALUATE → SAVE → STOP`:

1. **Prepare.**
   - Install the training environment, and vLLM in a separate environment.
   - Download the pinned base and check every hash.
   - Download the built dataset (Actions artifact) and check it against its
     committed manifest.
2. **Train** with the experiment's config. The cost guard stops a run whose
   projected time exceeds its budget, and the run is resumable.
3. **Merge** into BF16 and prove the weight change (`weight_delta`).
4. **Evaluate** base and candidate on the pre-registered eval set:
   - identical settings for both models;
   - `compare --prereg` refuses any other eval set and prints PASS or FAIL.
5. **Save.**
   - Write the checkpoint manifest.
   - Upload the adapter and the session reports to the private Rouge model
     repository.
6. **Stop.** The pod stops itself on every exit path.
