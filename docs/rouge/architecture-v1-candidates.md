# Rouge Architecture v1: candidates and tournament (pre-registered)

Registered: 2026-09-30, before any tournament run. The rules are data:
`training/rouge/configs/native/tournament-v1.json`. The runner is
`training/rouge/native/tournament.py` and the scorer is
`training/rouge/native/pareto.py`. A candidate never scores itself.

## Question

Which candidate gives the best quality per training FLOP, stored byte and KV
byte at equal active compute? Its quality must be no worse than the
Transformer baseline. The winner becomes Rouge Architecture Spec v1.0, the
model trained on H200.

## Candidates

Every candidate uses the same code (`native/model.py`, one `RougeConfig`), tokenizer, data, token budget, optimizer and schedule.

| ID | Candidate | Evidence it rests on / failure it fixes |
|---|---|---|
| A | Modern Transformer: RMSNorm, RoPE, SwiGLU, GQA, tied embeddings, full causal attention | Strongest at equal context in R1.14 (1.721 BPB); the baseline every claim is measured against |
| B | A with hybrid attention: sliding-window layers (256 tokens), a global layer every 3rd (size s) or 4th (size m) layer, windowed KV cache | R1.14: the window model was best far into streams and cheapest. R1.16: no mechanism held exact content beyond its window, so long range needs exact global access, not compressed state (the Gemma/Griffin local:global pattern) |
| C | B with ternary FFN weights (BitNet b1.58: absmean, straight-through, 2-bit packing); attention and embeddings in bf16 | R1.29: PASS on synthetic tasks. **R1.29b** (ternary on enwik8, running) decides. On FAIL, C becomes the int8 control (per-row absmax, same estimator). |
| D | C with a sparse FFN: 8 fine-grained experts, top-2, 1 shared expert, auxiliary-loss-free bias balancing (DeepSeek-V3). Active FFN FLOPs equal the dense FFN. | Fixes the dead experts and weak specialisation of R1.19. R1.22 measured a real speed-up of sparse dispatch (3.3× faster than dense at the same parameters). On R1.29b FAIL: int8 experts. |
| E | D with Monarch structured projections (4 blocks) in every linear layer | Tests "more structure per stored byte" at real scale. R1.26/R1.27 were within seed noise at small scale. On R1.29b FAIL: no low-bit, since Monarch supports ternary or full precision only. |

## Dropped research lines

These lines are not candidates. Their results stay recorded, and a revisit needs a new falsifiable hypothesis.
- Slot-state Rouge-LM: R1.14.
- Exact slot memory: R1.14b.
- Content retrieval beyond the window: R1.16.
- Naive adaptive depth: R1.17, R1.20, R1.21.
- Hypernetwork: R1.25.
- Latent programs: R1.33, R1.34.
- Hypothesis heads and verifier: R1.35, R1.37, R1.38.
- Reward-only learning from scratch: R1.39, R1.39b.

## Sizes

Figures come from `native/spec.py`, which a unit test checks against measured parameters and FLOP counts.

| size | candidate | parameters (physical / active) | stored | train FLOPs per token | KV at 32k |
|---|---|---|---|---|---|
| s (d 384, 6 layers) | A | 22.0M / 22.0M | 44.1 MB | 146M | 100.7 MB |
| s | B | 22.0M / 22.0M | 44.1 MB | 142M | 34.1 MB |
| s | C ternary (int8) | 22.0M / 22.0M | 31.7 (37.0) MB | 142M | 34.1 MB |
| s | D ternary (int8) | 32.7M / 22.0M | 34.4 (47.6) MB | 142M | 34.1 MB |
| s | E | 17.9M / 15.1M | 27.6 (35.7) MB | 100M | 34.1 MB |
| m (d 512, 8 layers) | A | 40.4M / 40.4M | 80.8 MB | 267M | 268.4 MB |
| m | B | 40.4M / 40.4M | 80.8 MB | 258M | 68.7 MB |
| m | C ternary (int8) | 40.4M / 40.4M | 50.5 (63.5) MB | 258M | 68.7 MB |
| m | D ternary (int8) | 66.4M / 40.4M | 57.0 (89.5) MB | 258M | 68.7 MB |
| m | E | 29.6M / 22.9M | 39.7 (59.3) MB | 153M | 68.7 MB |

At this scale, the bf16 embedding (32k × d) dominates stored bytes, so ternary saves 28% at size s and 38% at size m, not the 8× it saves on the FFN alone. The share grows with depth, which is why the scaling criterion exists.

## Data, training and evaluation

**Data:** the tournament corpus v1, 400M tokens (`native/data/build.py`), with this mixture:

| source | share |
|---|---|
| FineWeb-Edu sample-10BT (English, ODC-By) | 55% |
| FineWeb-2 deu_Latn (ODC-By) | 15% |
| Python from 8 permissively licensed projects at pinned tags | 12% |
| OpenWebMath (ODC-By) | 8% |
| Generated verified math | 5% |
| Generated algorithmic data | 5% |

- Processing: NFC normalisation, quality filters, exact and near-duplicate removal, hash split, 13-gram decontamination against every evaluation text, and a 32k BPE tokenizer frozen by hash.
- Build and commit: a GitHub runner builds the corpus. Its tokenizer and manifest are committed to `configs/native/data-v1/`.
- Verification: every training machine rebuilds the corpus and must reproduce every shard hash, or it does not train.

**Training** (same for every candidate):
- AdamW, learning rate 2e-3, warmup-stable-decay schedule (20% decay), weight decay 0.1, clip 1.0, sequence length 1024, bf16.
- Token budget: 200M tokens at size s; 300M tokens at size m.

**Evaluation** (`native/evaluate.py`, run by the trainer after training):
- Quality: held-out bits per byte on web_en, web_de, code_py and math_web, averaged.
- Tasks: exact match on held-out generated math and algorithmic items (seeds disjoint from training).
- Long context: passkey retrieval at 256, 960, 2048 and 4096 tokens.
- Speed: decode tokens/s and training tokens/s.
- Cost: spec numbers (stored bytes, train FLOPs, KV at 32k).

## Levels

| level | candidates | size | seeds | compute |
|---|---|---|---|---|
| A (smoke) | all, tiny | tiny | 1 | CPU, in CI (`tests/test_native_tournament.py`) |
| B (development) | A–E | s | 1 | one Lightning L4 job, at most 2.5 h |
| C (promotion) | A + two finalists | m | 3 | Lightning L4, sized from Level B's measured throughput (see below) |
| B-cpu (free fallback) | A–E | xs (d 256, 4 layers, about 11M parameters, 16M tokens) | 1 | one GitHub runner per candidate, resumable; registered before any run, for use while no GPU is reachable |

**Compute policy:** Lightning AI free credits only (15 per month; owner decision of 2026-09-30).
- Machines: T4, L4 and CPU only; never large GPUs.
- Before launch: the launcher (`training/rouge/lightning_ai/job.py`) refuses a job whose worst case would exceed the month's credits minus a margin.
- At the deadline: the launcher stops the job.
- After the job: actual cost goes into `lightning_ai/ledger.json`.
- The probe of 2026-09-30 found 5 credits in each of the two teamspaces the key may use, with no monthly free-credit grant configured, not the 15 per month assumed. Level B therefore runs on one L4 (worst case 1.5 credits).
- Level C's machine, hours and token budget are fixed from Level B's measured throughput before Level C starts. The same budget applies to every finalist, so the ranking is unaffected. If Level C does not fit the credits, it runs on the paid RunPod budget only with the owner's approval, or at a smaller token budget, and the change is recorded.
- If the credits run out, Level B runs on GitHub CPU runners at size s with fewer tokens, and the change is recorded.

## Selection rule (Pareto score)

1. **Quality gate.** A candidate may win only if its mean quality is no more than 0.02 BPB worse than A's, at the same level and seeds.
2. **Disqualification.** A diverged run (non-finite loss, or an abort after 20 consecutive spikes) or a missing seed disqualifies the candidate at that level.
3. **Score.** Each criterion ranks the eligible candidates, with average ranks on ties. The weights are:

   | criterion | weight |
   |---|---|
   | quality | 3 |
   | tasks | 1 |
   | long context | 1 |
   | stored bytes | 1 |
   | train FLOPs | 1 |
   | KV at 32k | 1 |
   | measured training throughput | 1 |
   | scaling (Level C only) | 1 |
   | stability (Level C only) | 1 |

   - Scaling is the quality gain from size s to size m, relative to A's gain.
   - Stability is the seed standard deviation of quality.
   - The lowest weighted rank sum wins. A tie goes to better quality.
4. **Promotion from Level B.** A goes to Level C, plus the two best-scoring other candidates whose quality is within 0.05 BPB of A's.
5. **Recording.** The winner, the losers and every number are recorded in `training/rouge/results/tournament-v1/`, whatever the outcome.

   If A wins, Rouge v1 is a well-built Transformer. That is a valid result, not a failure to hide.

## What the tournament does not decide

- **Frontier claims.** A 40M model is not compared with frontier systems. Frontier comparison needs a measured, comparable harness (`docs/rouge/frontier-reference-2026.md`).
- **Kernel speed.** The ternary and Monarch layers use fake quantisation and einsum in bf16. Measured throughput therefore favours dense layers. Speed claims for packed ternary kernels need `kernels/` benchmarks.
- **Hyperparameters per candidate.** Every candidate shares one set of hyperparameters. A candidate that loses only through a learning rate that suits the baseline better is a known limitation. A tuned rerun is a new, separately registered experiment.
