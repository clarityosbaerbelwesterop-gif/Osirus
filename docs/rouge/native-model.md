# Rouge 1 — the native model (owner direction, 2026-09-28)

**Osirus is the agent. Rouge 1 is the model.**

Rouge 1 is **one trained open-weight model with its own checkpoints**. It is
not an external model wrapped in more calls, routers, fallbacks or runtime
stages.

```
USER → ROUGE 1 CHECKPOINT → ANSWER
```

Reasoning inside the model is fine. The intelligence must increasingly live
**in the weights**.

## Identity

- **Base.** Rouge 1 is based on **Qwen3.5-397B-A17B**. The base stays
  Qwen's work.
- **The pin.** Revision `8472618112abcbd45acbcdc58436aff4233c23f7`,
  Apache-2.0, recorded in
  `training/rouge/manifests/base-qwen3.5-397b-a17b.json` (94 shard hashes,
  tokenizer, config).
- **One lineage.** The base is not switched casually. Rouge 1 is a single
  lineage.
- **Correct description:** "Rouge 1, based on Qwen3.5-397B-A17B".
- **Never claim** that Rouge was pretrained from scratch, that its
  parameters are infinite, or that it has a context length a checkpoint has
  not passed.
- **What becomes Rouge's own after training:**
  - its checkpoints;
  - its data mixture;
  - its post-training, behaviour, context training and reasoning training;
  - its evaluation history and version lineage.
- **No substitute weights.** No other model's weights may answer while
  identifying as Rouge 1. Hardware replicas of the same checkpoint may.

## The unit of progress

**A new checkpoint that measurably beats its parent.**

A new TypeScript class, provider, router, retry or runtime stage is not
Rouge intelligence progress. Checkpoint names:

```
rouge-1-base → rouge-1-sft-001 → rouge-1-reasoning-002 → rouge-1-context-003 → … → rouge-1-rc1 → rouge-1
```

**Every checkpoint has a manifest** (`training/rouge/rouge_train/checkpoints.py`):

- parent;
- run id, code commit and environment lock hash;
- hardware;
- dataset registry version, mixture and tokens;
- hyperparameters and seed;
- storage URI;
- sha256 of every file;
- evaluations.

**Promotion rule.**

- It needs a held-out gain on at least one target suite.
- It allows no regression beyond a stated tolerance on the guard suites.
- The candidate and its parent must be measured on the same suite
  versions.
- Dev-split scores never count.

**Where things live.** Weights live in object storage and never in Git.

## Rules carried over

- Benchmarks used for claims never train Rouge.
- Data is split into train, dev, holdout and adversarial sets. Contamination
  is checked before every data build.
- Every sample has provenance.
- Datasets need verified licences at a pinned revision. Teacher-model
  outputs are used only when that model's terms permit training on them.
- **Claude's role:** research, training and evaluation engineer; dataset
  designer; reviewer.
  - Claude is not Rouge's runtime brain.
  - There is no industrial distillation of Claude outputs unless
    Anthropic's current terms explicitly allow it.
- **No paid compute without the owner's approval** (`compute-plan.md`).

## Milestones (re-planned)

| Milestone | Scope                                                                                                                                                                                                                                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **M58**   | Training foundation. Done in this branch: pinned base manifest, checkpoint manifests with lineage and promotion rules, dataset registry with licence gates, seed control, weight verification, CI for all of it, and the compute plan. Next: a tiny same-architecture smoke training run in CI (compute plan, step A), then a stack decision on the first GPU day. |
| **M59**   | **rouge-1-sft-001**: an approved SFT mixture covering reasoning, math, science, code, research, writing, instruction following, multilingual and German, long-form synthesis and multimodal. LoRA, then a merged checkpoint after validation. Compared with base.                                                                                                  |
| **M60**   | **Reasoning post-training**: verified tasks (math, logic, code, program execution, constraints) with rejection sampling, DPO, and GRPO where justified. The verifier scores; the runtime never solves for the model.                                                                                                                                               |
| **M61**   | **Character and response quality in the weights**: precise, direct, curious, honest about uncertainty, strong in German and English, trained through preference post-training. No giant system prompt.                                                                                                                                                             |
| **M62**   | **Curriculum and data engine**: open datasets, verified synthetic and self-generated tasks, execution-verified code, consented feedback only, all with provenance and splits.                                                                                                                                                                                      |
| **M63**   | **Model-native self-improvement**: checkpoint → evaluation → weakness → curriculum → candidate training → blind evaluation → promote or reject. It changes weights, not prompts.                                                                                                                                                                                   |
| **M64**   | **Reasoning RL** with verifiable rewards: execution, formal checking, known answers or an independent verifier. No self-grading.                                                                                                                                                                                                                                   |
| **M65**   | **Model-native long context**: 262k → 512k → 1M → 2M, through RoPE/YaRN scaling, long-context continued pretraining and SFT, and progressive lengths. A length is claimed only after the checkpoint passes it.                                                                                                                                                     |
| **M66**   | **Multimodal**: preserve and improve the base's native vision (images, screenshots, charts, documents, UI, diagrams). One model, no bolted-on vision model.                                                                                                                                                                                                        |
| **M67**   | **Coding and science specialisation**, verified by execution and deterministic checks.                                                                                                                                                                                                                                                                             |
| **M68**   | **Continual training**: experience → verified dataset → candidate job → evaluation → checkpoint → canary → promotion. Triggered by data, compute and a measured weakness, never by a timer.                                                                                                                                                                        |
| **M69**   | **Rouge Model Lab**: compares Qwen base, checkpoint N−1 and checkpoint N on reasoning, coding, science, knowledge, writing, multilingual, vision, long context, instruction following, hallucination and calibration.                                                                                                                                              |
| **M70**   | **Rouge 1 RC**: one canonical checkpoint with a model card, architecture manifest, data summary, licence notice, context specification, benchmark and safety reports, and a deployment recipe.                                                                                                                                                                     |
| **M71**   | **AI mode integration**: in ChatHub, AI = Rouge 1 and Agent = Osirus.                                                                                                                                                                                                                                                                                              |
| **M72**   | **Design and animations**: streaming, thinking states, context meter, multimodal input. No visible chain of thought.                                                                                                                                                                                                                                               |
| **M73**   | **Polish, security and performance**: serving, rate limits, GPU failure, checkpoint rollback.                                                                                                                                                                                                                                                                      |
| **M74**   | **Stripe, domain, legal and search.**                                                                                                                                                                                                                                                                                                                              |
| **M75**   | **Release**: real screenshots, real methodology, no fake frontier claims.                                                                                                                                                                                                                                                                                          |

The M56/M57 runtime is legacy research. See
[`legacy-runtime.md`](legacy-runtime.md).
