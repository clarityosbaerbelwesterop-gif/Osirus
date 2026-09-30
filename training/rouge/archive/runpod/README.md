# Archived: RunPod path (not used)

Owner directive of 2026-09-30: Lightning AI replaces RunPod for GPU training, storage and the model
repository. The RunPod launchers are kept here for reference only; no workflow calls them.

- `session.py`, `pod_train.sh`, `probe.py`: native Rouge H200 session over SSH with a network volume
  (built and unit-tested, never run: the RunPod balance was 0 USD).
- `runpod_session.py`, `pod_entry.sh`: the M58 LoRA session (rouge-gpu.yml, removed).
- `ledger-unused.json`: empty; nothing was ever spent on RunPod.

The 50 EUR ceiling and its ledger now live in `training/rouge/lightning_ai/` (cost.py, ledger.json).
