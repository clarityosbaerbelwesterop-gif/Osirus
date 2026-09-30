# Rouge 1 build: status (2026-09-30)

This is the living status of the "Rouge 1: frontier model build" program. Every claim links to evidence in the repository, on branch `rouge/native-model-m58`.

## Phases

| Phase | State | Evidence |
|---|---|---|
| §1 Frontier reference | done | `docs/rouge/frontier-reference-2026.md` |
| §3 R1.16 | done, **FAIL** under its gate | `research/rouge-architecture/results/r1.16/` |
| §3 R1.29b (ternary on real text) | done, **PASS** under its gate (provisional: byte-matched gap within seed noise); candidate C stays ternary | `research/rouge-architecture/results/r1.29b/README.md` |
| §4 Dead research lines stopped | done (results kept; revisit only with a new hypothesis) | `docs/rouge/architecture-v1-candidates.md` |
| A: architecture tournament | corpus v1 built and committed (400M tokens, tokenizer frozen); **Level B running on Lightning T4** | `configs/native/tournament-v1.json`, `configs/native/data-v1/`, `results/tournament-v1/` |
| A: Architecture Spec v1.0 | freeze tooling done; freezes from the Level C decision only | `native/freeze.py`, `configs/native/ladder-v1.json` |
| B: training infrastructure | done and tested | see below |
| C: controlled recursive improvement | done; control plane pinned | `native/cri.py`, `configs/native/control-plane.json` |
| D: TRAINING_READY | gate built; see the 16-condition table in `TRAINING_READY.json` after `ready.py` | `training/rouge/ready.py` |
| E: GPU training | **on Lightning** (owner directive): one H100/H200 or a node of small GPUs (T4/L4/L40S, data parallel), storage and model registry; refused until TRAINING_READY, the 50 EUR ceiling and the balance hold | `lightning_ai/train_session.py`, `lightning_ai/train_job.sh`, `.github/workflows/rouge-train.yml` |
| F: post-training | stages built and smoke-tested (SFT, reasoning SFT, rejection sampling, DPO, GRPO only after SFT) | `native/posttrain.py` |

## Phase B: what exists and is tested (`training/rouge/`)

**Model** (`native/model.py`, one `RougeConfig`):
- RMSNorm, RoPE, SwiGLU, GQA, tied embeddings;
- full or local:global attention with a KV cache;
- ternary (BitNet b1.58) and int8 low-bit layers;
- Monarch projections;
- sparse MoE with auxiliary-loss-free balancing.

**Spec calculator** (`native/spec.py`):
- computes parameters, stored bytes, FLOPs, KV and activation memory, and decode bandwidth;
- matmul FLOPs match torch's counter within 2%, and parameter counts match exactly (tested).

**Trainer** (`native/train.py`):
- single process, DDP and FSDP2;
- bf16, accumulation, activation checkpointing;
- WSD or cosine schedule, spike guard, telemetry with MFU;
- time budget with exit 75.
- **Exact resume is proven bitwise** for single process, DDP and FSDP2 (tests). Two FSDP bugs were found and fixed on the way:
  - the optimizer state was not restored from sharded checkpoints;
  - the final evaluation deadlocked.

**Checkpoints** (`native/checkpoint.py`): atomic, with a sha256 manifest. A corrupt checkpoint is never resumed.

**Data** (`native/data/`):
- every source has a licence and a pinned revision;
- NFC normalisation and quality filters;
- exact and near-duplicate removal;
- 13-gram decontamination, plus exact-prompt exclusion for generated items;
- BPE tokenizer, shards with a manifest, and `verify`.
- Rebuilds must reproduce every shard hash. The CI rebuild check caught a real non-determinism (salted `hash()`), and it is fixed.

**Evaluation** (`native/evaluate.py`): held-out BPB per domain, generated math and algorithmic tasks, passkey, and decode speed.

**Registry** (`native/registry.py`): hash-chained lineage `rouge-r1-<size>-<nnn>`, holding hashes and numbers only.

**Benchmarks** (`native/bench.py`): speed is claimed only from these measurements. On CPU, relative to dense:

| layer | training time |
|---|---|
| ternary (fake-quant) | 1.4× |
| MoE | 1.5× |
| Monarch | 5× |

Packed ternary without a fused kernel is no faster than dense.

**Dry run** (`native/dryrun.py`): the whole pipeline in about 30 s on CPU. The CPU evidence is committed in `results/dry-run/cpu/`.

## Compute and money (measured 2026-09-30)

Owner directive: **Lightning AI replaces RunPod** for GPU training, storage and the model repository. RunPod code is archived (`training/rouge/archive/runpod/`); nothing was spent there.

**Lightning AI** (`lightning_ai/`, ledger `lightning_ai/ledger.json`):
- **One teamspace, 3.74 credits** (13:00 UTC). The key reads 4 memberships: 2 are refused by the key's scope, and the 2 readable ones are the same teamspace (same jobs, same balance), not two teamspaces with 4.9 each as reported earlier. Free monthly credits are off on it.
- CPU and T4 jobs run. **L4 job creation answered HTTP 403** (single L4); L4 nodes are listed.
- **Storage and model repository: the teamspace model registry** (probe of 2026-09-30, `results/lightning/probe.json`). The registry round trip (upload, download, sha256 equal) passed. The teamspace drive answered 404 on every cloud account. Job mounts under `/teamspace` are writable but do not persist to the next job. Jobs carry no SDK credentials, so training jobs get the key as job environment; it is used only by `lightning_ai/storage.py`, never printed, and masked by Actions in relayed logs.
- Layout: corpus `rouge/data/<corpus>` = registry model `rouge-data-<corpus>`; run checkpoints `rouge/runs/<lineage>` = `rouge-runs-<lineage>` (new version per sync); published weights `rouge-r1-<rung>:<lineage>`. Every transfer is verified against its sha256 manifest.

**Live prices of this account** (`results/lightning/machines.json`, read from the Lightning API by the free probe; far above the published list prices):

| machine | on demand USD/h | interruptible USD/h |
|---|---|---|
| T4 / T4_X_4 | 0.69 / 3.50 | 0.37 / 1.15 |
| L4_X_4 / L4_X_8 | 4.78 / 9.94 | 3.48 / 6.92 |
| L40S / L40S_X_4 | 3.54 / 11.86 | 2.70 / 7.58 |
| H100 | 5.68 | not offered |
| H200 (second cloud account / default) | 4.50 / 6.53 | 3.82 / not offered |
| DATA_PREP (32 CPU) | 1.48 | not offered |

**Single large GPU or a node of small GPUs** (owner request: "several small GPUs with the same total performance"). Both are supported: `train_session.py` runs one rank per GPU with torchrun, keeps the global batch in tokens, and can use interruptible capacity (checkpoints sync every 10 minutes; a preempted job relaunches and resumes exactly). The launcher takes the cheapest cloud account at the live price. 100M rung (2B tokens), same MFU 0.30 assumed for every GPU until measured:

| machine | hours | USD on demand | USD interruptible |
|---|---|---|---|
| H200 (second account) | 1.8 | 8.1 | 6.9 |
| T4_X_4 | 6.0 | 21.0 | 6.9 |
| H100 | 1.8 | 10.2 | not offered |
| L40S | 4.1 | 14.4 | 11.0 |
| L4_X_4 | 3.5 | 16.5 | 12.0 |

At this account's prices the H200 is cheapest and fastest. A T4 node matches it only when interruptible and only if T4 reaches the same MFU; Level B on T4 measures that. With free credits, small GPUs cost nothing and would be the first choice.

**Ceiling** (`lightning_ai/cost.py`):
- **50 EUR = $52.50**, at 1 EUR = 1.05 USD; it counts every Rouge job on Lightning (spent so far: 3.66 USD, including 2.78 for the stopped Level B and 0.83 for a stopped corpus build).
- Price ceilings are about 1.25x the cheapest live on-demand price per GPU. A launch needs its live price under the ceiling, and hours x live price (+5%) plus everything in the ledger within 50 EUR and within the balance.

## Level B on a T4 (2026-09-30): stopped, no result

- Candidate A trained fully (3051 steps, 200M tokens, loss 3.48) in 79 min. Then it crashed in the passkey evaluation: `evaluate.py` read one shard of `web_en` as its list of shards. The dry run missed the bug because its corpus has no `web_en`. The fix and a test are in dc6a114.
- The same crash would have ended every candidate. 5 candidates at 79 min each also exceed the job's 4.5 h, so the job was stopped: 2.78 USD spent, no ranking (`results/tournament-v1/level-B/decision.json`: incomplete).
- **Measured: the T4 reaches MFU 0.095** (42.3k tokens/s, fp16) instead of the assumed 0.30 (`results/lightning/mfu.json`). A GPU tournament is far cheaper on an H200 (about 5–25 min per candidate) than on a T4 (79 min).
- **Now:** Level B runs free on GitHub CPUs (the registered fallback B-cpu, size xs). It names the finalists; promotion still needs Level C on a GPU.

## What the owner has to do (nothing else blocks Phase E)

1. **Free hours: A100, not H200.** Lightning's pricing page (owner screenshot, 2026-09-30) lists free hours "with up to 30 free credits to start": T4 75 h, L4 31 h, A100 40 GB 10 h, A100 80 GB 5 h, L40S 5 h, RTX PRO 6000 2 h; **H100 and H200: none**. The 100M rung fits an A100 40 GB in about 4.6 h (MFU 0.30 assumed; 10.13 USD if paid), inside its 10 free hours; `A100_40GB` is now a training machine. Our key reaches only one organisation teamspace, with 1.36 credits and free credits off; 2 of its 4 memberships are refused by the key's scope. **Create a Lightning API key with access to the teamspace that holds the free credits (or all teamspaces) and store it as the `LIGHTNING_AI_API_KEY` secret.**
2. **Or add credits:** the balance is 1.36. The launcher refuses any job whose worst case exceeds the balance minus 1.
3. **Every paid run:** approve it in the protected GitHub environment `rouge-gpu` (workflow "Rouge train").

## Next steps (automatic, free)

1. Done: corpus v1 committed and rebuilt byte-identically by the streaming build; R1.29b PASS (candidate C ternary); GPU dry run on T4; storage on the model registry; `pretrain-v1` built (1.94B tokens, code 59M of 264M planned).
2. Running: Level B on GitHub CPUs; production corpus `pretrain-v2` (mixture v3: 41 code projects, decontamination rule v2, more synthetic seeds), built free on a runner and stored in the registry. `ready.py` requires every source at 90% or more of its plan.
3. Level C on a GPU (needs credits), then `native/freeze.py` writes Spec v1.0.
4. A GPU dry run on the frozen spec, then `ready.py` reports TRAINING_READY.
5. The 100M rung trains on the cheapest machine at live prices (today an H200 on the second cloud account, about 1.8 h), with the owner's approval.
