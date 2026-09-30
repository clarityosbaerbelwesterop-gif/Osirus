# Rouge 1: free phase, then 125 credits on B200 (plan of 2026-09-30)

> **Superseded on 2026-09-30.** The owner decided to build Rouge 1 on the pinned open base Qwen3.6-27B instead of pretraining a native 2B model. The 125 credits go to one RSI iteration on 8 × H200 (`docs/rouge/rouge1-base-plan.md`). This plan stays as research for Rouge 2 and a small edge model.

Owner direction (2026-09-30):
1. Use every free resource first.
2. Then 125 credits for training on 2–3 B200 GPUs, about 10 hours each.
3. Aim for a 2B-parameter model that is as efficient and knowledgeable as possible.

This plan turns that into numbers. Every figure is either measured (marked) or a stated assumption.

## What 125 credits buy

| item | value | source |
|---|---|---|
| B200 price | 9.86 USD/h per GPU on demand; no interruptible offer | Lightning API, `results/lightning/machines.json` |
| 125 credits | 12.7 B200-hours | computed |
| 2–3 B200 × 10 h | 20–30 B200-hours = 197–296 USD | computed; exceeds 125 credits |
| what fits | 2 B200 × 6.3 h, 3 B200 × 4.2 h, or B200_X_8 × 1.6 h | computed; same total GPU-hours |
| compute | about 3.6e19 FLOPs (bf16, MFU 0.35 assumed); FP8 up to about 1.5× more | B200: 2.25 PFLOPS dense bf16 (NVIDIA datasheet) |

B200_X_8 (one node, NVLink) is preferred over several single-B200 machines. It gives the same GPU-hours without traffic between nodes, and `train_session.py` already runs one rank per GPU with torchrun.

## Model size: 2B, but as MoE

For 3.6e19 FLOPs the compute-optimal dense model has about 0.55B parameters trained on about 10B tokens (Chinchilla: about 20 tokens per parameter). A dense 2B model would see only 3.1B tokens, 1.7 per parameter, and would be clearly worse than the 0.55B model at the same cost.

**Recommendation: `2b-moe`.** It has 2.10B parameters in total and 0.50B active per token: 32 fine-grained experts, top-2 routing, 1 shared expert, auxiliary-loss-free balancing. It costs as much per token as the 0.55B dense model, so it sees about 11B tokens. It stores knowledge in 2.1B parameters (knowledge capacity grows with total parameters; Allen-Zhu & Li, "Physics of Language Models 3.3": about 2 bits per parameter when facts are seen often enough).
- Ladder rungs: `2b-moe` (if the tournament winner uses MoE) or `600m` (if it is dense). `native/freeze.py` picks the one that matches the winner, so the evidence decides.

## Data: 11B tokens needed, 2.2B built

- The production corpus must grow to about 11–12B tokens (`pretrain-v4`). Planned sources:
  - FineWeb-Edu (en) and FineWeb-2 (de);
  - Wikipedia en/de (dense factual knowledge);
  - OpenWebMath and FineMath;
  - the 41 pinned code projects (up to 2–4 epochs; unique supply about 160M tokens);
  - verified synthetic math and algorithmic data.
- Build: free GitHub runners, in several jobs per source (a runner built 2.2B tokens in 56 min). Upload to the Lightning model registry.

## Efficiency levers (evidence, expected factor versus a plain dense Transformer on unfiltered web text)

| lever | expected gain | status |
|---|---|---|
| filtered educational web data (FineWeb-Edu) | about 2–3× compute-equivalent on knowledge benchmarks (FineWeb paper) | in the corpus |
| fine-grained MoE, same active compute | about 2–4× (DeepSeekMoE, Switch) | candidate D in the tournament |
| Muon optimizer | about 1.3–2× (Moonshot "Muon is scalable", 2025) | to implement and test at Level A/B |
| FP8 matmuls on B200 | about 1.3–1.8× throughput | to implement; verify loss parity on a short run first |
| WSD schedule, exact resume, no idle GPU | avoids waste | done |

**Realistic combined gain: about 5–20× compute-equivalent** versus a naive baseline of equal cost. **"100 to 2000 times better" is not physically reachable** with any known method at this budget, and Rouge will not claim it. What 125 credits can honestly produce is the strongest model per FLOP we can measure: a 2B-total MoE trained on about 11B curated tokens, evaluated on held-out BPB, the internal tasks and public benchmarks with contamination checks.

## Free resources (order of use)

1. **GitHub runners (free, running now):** corpus builds, CPU tournament (Level B-cpu), all tests.
2. **Lightning free hours: used up for this account.** The probe of 17:24 UTC shows one wallet of 1.27 credits shared by both teamspaces, free credits off and no next grant. The pricing page's free hours come from up to 30 starting credits, which are spent.
3. **Kaggle:** 30 GPU-hours per week on T4 ×2 or P100, 9 h sessions. This needs a Kaggle API token (`KAGGLE_USERNAME`, `KAGGLE_KEY` as repo secrets). Planned use: tournament levels and ablations (Muon, FP8-free parts).
4. **This session's container:** CPU only, and HuggingFace downloads are blocked here. Used for code and tests only.

## Owner actions

1. No new Lightning key needed: the current key reaches Rouge, which uses the account's only wallet.
2. Optional: Kaggle API token as `KAGGLE_USERNAME` and `KAGGLE_KEY` secrets (30 free GPU-hours per week).
3. When ready: 125 credits in the Lightning teamspace, then approve the run in the `rouge-gpu` environment. The ledger ceiling is set to 125 credits plus the 3.66 USD already spent (`lightning_ai/cost.py`).

## Progress (2026-09-30, 17:20 UTC)

- Done:
  - B200 and B200_X_8 are training machines, and the ceiling covers the 125 credits.
  - `2b-moe` and `600m` rungs are in the ladder.
  - The Muon optimizer is in the trainer (`--optimizer muon`); CI tests are green.
  - The corpus can be built one source per runner.
- Running (free):
  - Level B tournament on GitHub CPUs.
  - Muon vs AdamW ablation (candidate A, Level B-cpu recipe).
  - `pretrain-v3` (2.2B tokens, for the free A100 phase).
  - `pretrain-v4` (11.5B tokens, mixture v5, 9 runners in parallel, for the B200 phase).
- Next:
  - FP8 path for B200 (torchao float8), checked for loss parity at the start of the paid run.
  - The tournament decision decides between `2b-moe` and `600m`.
