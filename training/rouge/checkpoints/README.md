# Checkpoint manifests

One JSON file per Rouge checkpoint (`rouge.checkpoint/1`, written by
`rouge_train/checkpoints.py`). Each file records:

- name and parent;
- kind: `adapter`, `merged` or `full`;
- status;
- the run: id, code commit, environment lock hash, hardware;
- data: registry version, mixture, tokens;
- hyperparameters and seed;
- the storage URI;
- the sha256 of every weight file;
- held-out evaluations.

Weights are never stored here.

No checkpoint exists yet. The first is `rouge-1-sft-001` (M59). Its baseline
`rouge-1-base` is the pinned Qwen3.5-397B-A17B revision, measured with
`configs/lab-v0.json`.
