# Rouge 1 build: status (2026-09-30)

This is the living status of the "Rouge 1: frontier model build" program. Every claim links to evidence in the repository, on branch `rouge/native-model-m58`.

## Phases

| Phase | State | Evidence |
|---|---|---|
| §1 Frontier reference | done | `docs/rouge/frontier-reference-2026.md` |
| §3 R1.16 | done, **FAIL** under its gate | `research/rouge-architecture/results/r1.16/` |
| §3 R1.29b (ternary on real text) | running (GitHub run 36681965922); decides candidate C | `research/rouge-architecture/experiments/r1_29b.json` |
| §4 Dead research lines stopped | done (results kept; revisit only with a new hypothesis) | `docs/rouge/architecture-v1-candidates.md` |
| A: architecture tournament | pre-registered; corpus build running; Level B waits for R1.29b and a GPU (or runs as the free Level B-cpu) | `configs/native/tournament-v1.json`, `native/pareto.py`, `native/tournament.py` |
| A: Architecture Spec v1.0 | freeze tooling done; freezes from the Level C decision only | `native/freeze.py`, `configs/native/ladder-v1.json` |
| B: training infrastructure | done and tested | see below |
| C: controlled recursive improvement | done; control plane pinned | `native/cri.py`, `configs/native/control-plane.json` |
| D: TRAINING_READY | gate built; see the 16-condition table in `TRAINING_READY.json` after `ready.py` | `training/rouge/ready.py` |
| E: H200 training | built, refused until TRAINING_READY and funds | `runpod/session.py`, `runpod/pod_train.sh`, `.github/workflows/rouge-h200.yml` |
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

**Lightning AI** (`lightning_ai/job.py`, `ledger.json`):
- **Balance:** the key reads 2 of the 4 teamspaces. Each has **5 credits**; free monthly credits are off.
- **CPU jobs:** work (test job completed in 121 s at 0.00 cost).
- **GPU jobs:** **job creation answers HTTP 403**. The cause is on the account side (GPU access or verification for the organisation teamspace).
- **Guards:**
  - T4/L4/CPU only;
  - worst case checked against the balance and the ledger before every job;
  - stop at the deadline.

**RunPod** (probe: `results/runpod/probe.json`):
- **Price:** H200 SXM $4.59/h secure cloud ($3.59/h community).
- **Stock:** low. H200 with network storage is available in AP-JP-1.
- **Account balance: $0.** Spend limit $80.
- **Nothing paid can start before a top-up.**

**Ceiling** (`runpod/cost.py`):
- **50 EUR = $52.50**, at 1 EUR = 1.05 USD (below market, so USD spend stays under 50 EUR).
- Every launch checks its worst case plus everything already in the ledger.
- The launcher also refuses when the RunPod balance does not cover the worst case.

**Estimates** (spec calculator, one H200 at $4.59/h, MFU 0.3–0.4):

| rung | tokens | hours | cost | fits 50 EUR after the 100M rung? |
|---|---|---|---|---|
| 100M | 2B | 1.4–1.8 | $6.6–8.1 | yes |
| 300M | 6B | 8.9–11.7 | $41–53 | **no** |

The 300M rung fits at about 4B tokens. The first run's measured MFU decides; the launcher refuses anything that would cross the ceiling.

## What the owner has to do (nothing else blocks Phase E)

1. **RunPod:** top up the account with at least the ceiling you want to allow (50 EUR). The balance is $0 today.
2. **Lightning GPU:** enable GPU jobs for the key's teamspace. The key creates CPU jobs, but GPU job creation answers 403. Alternatively, provide a key for a teamspace where GPUs are enabled. Without it, the tournament runs as the free Level B-cpu on GitHub runners, which is slower and smaller. Level C then needs a GPU.
3. **Every paid run:** approve it in the protected GitHub environment `rouge-gpu`. Each H200 segment is one approval.

## Next steps (automatic, free)

1. The corpus build commits `configs/native/data-v1/` (tokenizer frozen by hash).
2. R1.29b finishes. Its README decides ternary vs the int8 control.
3. Level B runs: on a GPU if enabled, otherwise Level B-cpu on 5 GitHub runners.
4. Level C runs on a GPU, then `native/freeze.py` writes Spec v1.0.
5. A GPU dry run, then `ready.py` reports TRAINING_READY.
6. The production corpus is built on the volume. The 100M rung trains on H200 within the ceiling, with the owner's approval.
