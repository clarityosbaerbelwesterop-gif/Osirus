# Rouge 1 training

Rouge 1 is one model lineage: a derivative of **Qwen/Qwen3.5-27B**, pinned
in [`models/rouge-1/base.json`](../../models/rouge-1/base.json), with its
own trained checkpoints.

- Definition and milestones: [`docs/rouge/native-model.md`](../../docs/rouge/native-model.md).
- Cost: [`docs/rouge/compute-plan.md`](../../docs/rouge/compute-plan.md).

**No weights in Git.**

## Layout

| Path                                   | What                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rouge_train/config.py`                | Run configuration (one JSON describes a run completely)                                                                                          |
| `rouge_train/data.py`                  | JSONL conversations → base chat template → token ids, assistant-only labels (character offsets); too long or no assistant → dropped and counted  |
| `rouge_train/modeling.py`              | Base loading (BF16 or 4-bit NF4 QLoRA), gradient checkpointing, LoRA on all LM projections, chunked output-head loss                             |
| `rouge_train/train.py`                 | Training loop with exact checkpoint/resume (adapter, optimiser, scheduler, RNG, data cursor)                                                     |
| `rouge_train/merge.py`                 | Adapter → canonical BF16 checkpoint; carries base-only tensors (MTP); `weight_delta` proves the weights changed                                  |
| `rouge_train/evaluate.py`              | Generation (vLLM or transformers) and code-only checks; base-vs-Rouge comparison with wins, regressions and McNemar                              |
| `rouge_train/generators.py`            | In-house SFT and eval data, computed by code, English and German; decontamination                                                                |
| `rouge_train/checkpoints.py`           | Checkpoint manifests, lineage, promotion rule                                                                                                    |
| `rouge_train/registry.py`, `datasets/` | Dataset registry with licence and teacher-terms gates; probe and build on a runner; `datasets/manifests/` holds the hashes of each built dataset |
| `rouge_train/cli.py`                   | verify / verify-data / train / merge / generate / compare / manifest on the GPU host                                                             |
| `rouge_train/smoke.py`                 | The whole path on a tiny random model of the base architecture. **The tiny model is not Rouge.**                                                 |
| `scripts/`                             | `base_manifest.py`, `fetch_tokenizer.py`, `verify_weights.py`, `size_qlora.py`, `dataset_licenses.py`                                            |
| `configs/sft-001.json`                 | The `rouge-1-sft-001` run: QLoRA r = 32, 8k sequences, 1 GPU                                                                                     |
| `checkpoints/`                         | Checkpoint manifests (none yet)                                                                                                                  |

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

Run these on one GPU host, with `requirements-gpu.txt` installed and
`training/rouge` as the working directory:

1. **Download and check the base.** Download the pinned revision to
   `/workspace/models/Qwen3.5-27B`, then check every hash:
   `python -m rouge_train.cli verify --base /workspace/models/Qwen3.5-27B`.
2. **Fetch and check the data.** Download the `rouge-sft-data` artifact of
   the `rouge-data.yml` run named in
   [`datasets/manifests/rouge-sft-v0.json`](datasets/manifests/rouge-sft-v0.json)
   into `/workspace/data/rouge-sft-v0/`, then check both files' hashes:
   `python -m rouge_train.cli verify-data --data /workspace/data/rouge-sft-v0 --manifest datasets/manifests/rouge-sft-v0.json`.
3. **Train:** `python -m rouge_train.cli train --config configs/sft-001.json`.
   The run is resumable: rerun the same command after an interruption.
4. **Merge:** `python -m rouge_train.cli merge --config configs/sft-001.json --out /workspace/ckpt/rouge-1-sft-001`.
5. **Evaluate both models**, with the same settings and the same hidden
   eval set: run `generate` for the base and for `rouge-1-sft-001`, then
   `compare`.
6. **Record and publish:**
   - write the manifest with `python -m rouge_train.cli manifest …` into
     `checkpoints/`;
   - upload the weights to the Rouge model repository;
   - commit the manifest and the report.
