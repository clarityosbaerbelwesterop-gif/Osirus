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
| E: GPU training | **on Lightning** (owner directive): H100/H200 job, storage and model registry; refused until TRAINING_READY, the 50 EUR ceiling and the balance hold | `lightning_ai/train_session.py`, `lightning_ai/train_job.sh`, `.github/workflows/rouge-train.yml` |
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
- The key reads 2 organisation teamspaces (role ProjectAdministrator), each about **4.9 credits**; free monthly credits are off.
- CPU and T4 jobs run (probes, the GPU dry run on T4 for $0.05). **L4 job creation answers HTTP 403.**
- **H100, H200 and A100 are listed** (capacity); a paid H100/H200 job has not been created yet (needs TRAINING_READY and credits).
- Storage: teamspace-drive upload on the default cloud account answered 404; jobs mount `/teamspace` but carry no SDK credentials. The next probe tests every cloud account, the model registry, and persistence of the mounted paths.

**Ceiling** (`lightning_ai/cost.py`):
- **50 EUR = $52.50**, at 1 EUR = 1.05 USD; it counts every Rouge job on Lightning.
- A paid launch needs: worst case (hours x price ceiling: H100 $4.00/h, H200 $7.00/h) plus everything in the ledger within the ceiling, and within the teamspace balance.

**Estimates** (spec calculator, MFU 0.3, one GPU; H100 and H200 have the same bf16 compute):

| rung | tokens | H100 (about $3.29/h list) | H200 (about $6.53/h list) |
|---|---|---|---|
| 100M | 2B | about 1.8 h, $6–7 | about 1.8 h, $12 |
| 300M | 6B | about 11.7 h, $38 | over the ceiling |

H100 is chosen for the 100M and 300M rungs (same compute, half the price); H200 only when memory requires it (1B).

## What the owner has to do (nothing else blocks Phase E)

1. **Lightning credits:** the teamspace holds about 4.9 credits; a 100M rung on H100 needs about 7 plus margin. Add credits up to the 50 EUR ceiling you set; the launcher refuses otherwise.
2. **Every paid run:** approve it in the protected GitHub environment `rouge-gpu` (workflow "Rouge train").
3. Optional: enable L4 and monthly free credits for the teamspace (faster tournament Level C).

## Next steps (automatic, free)

1. Done: corpus v1 committed; R1.29b PASS (candidate C ternary); GPU dry run on T4 passed.
2. Level B finishes on T4 and names the finalists.
3. Storage path confirmed (drive, model registry or mounted path).
4. Level C runs on a GPU, then `native/freeze.py` writes Spec v1.0.
5. A GPU dry run, then `ready.py` reports TRAINING_READY.
6. The production corpus is built on Lightning. The 100M rung trains on an H100 within the ceiling, with the owner's approval.
