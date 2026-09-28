# Rouge 1 training (M58+)

Rouge 1 is **one model lineage**: a derivative of **Qwen3.5-397B-A17B**,
pinned at revision `8472618112abcbd45acbcdc58436aff4233c23f7` (Apache-2.0),
with its own trained checkpoints. The rest of Osirus is the agent. This
directory is the model.

- Definition and milestones: [`docs/rouge/native-model.md`](../../docs/rouge/native-model.md).
- Compute plan: [`docs/rouge/compute-plan.md`](../../docs/rouge/compute-plan.md).

**No weights in Git, ever.**

- Git holds code, configs, dataset registry and manifests, checkpoint
  manifests (sha256, parent, run, data version, hyperparameters,
  evaluations) and reports.
- Weights live in object storage and are verified against their manifest
  before every use.

## Layout

| Path                                                                  | What                                                                                                                    |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `manifests/`                                                          | The pinned base: revision, licence, config, sha256 of all 94 shards and every small file                                |
| `rouge_train/`                                                        | Stdlib-only core, tested in CI: base verification, checkpoint manifests, lineage and promotion, dataset registry, seeds |
| `scripts/`                                                            | `base_manifest.py` (runs on CI), `verify_weights.py` (runs on the GPU host), `dataset_licenses.py` (runs on CI)         |
| `data/`                                                               | `registry.json`: every dataset with its licence, revision, role (train or eval-only) and approval status                |
| `configs/`                                                            | Run recipes: `sft-001.json` (draft), `lab-v0.json` (baseline evaluation)                                                |
| `checkpoints/`                                                        | Checkpoint manifests, one JSON per checkpoint (empty until the first trained checkpoint)                                |
| `evaluation/`                                                         | Model Lab: base vs N−1 vs N on held-out suites                                                                          |
| `sft/`, `preference/`, `reasoning/`, `rl/`, `context/`, `multimodal/` | Stage plans for M59–M66 (code arrives with each stage)                                                                  |

## Checks

```sh
python3 -m unittest discover -s training/rouge/tests -v
```

These also run in `.github/workflows/rouge-training.yml`, together with a
metadata-only licence read of every registered Hub dataset.

## Rules

1. **Verify before use.** A run starts only on a base verified against the
   manifest (`scripts/verify_weights.py`).
2. **Approved data only.** A run uses only `approved` registry entries.
   `eval-only` data never trains.
3. **Record every checkpoint.** Every checkpoint gets a manifest
   (`rouge_train/checkpoints.py`).
4. **Promote only on held-out evidence.** Promotion needs a held-out
   improvement over the parent and no guard regression.
5. **Ask before spending.** No paid compute without the owner's approval.
