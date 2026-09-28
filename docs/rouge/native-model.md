# Rouge 1 — the native model (owner direction, 2026-09-28)

**Osirus is the agent. Rouge 1 is the model.**

Rouge 1 is one trained open-weight model with its own checkpoints. It is
not an external model wrapped in more calls, routers, fallbacks or runtime
stages.

```
USER → ROUGE 1 CHECKPOINT → ANSWER
```

The intelligence must increasingly live **in the weights**.

## Base and identity

- **Base.** Rouge 1 v1 is based on **Qwen/Qwen3.5-27B**, pinned at revision
  `fc05daec18b0a78c049392ed2e771dde82bdf654`. The pin is in
  `models/rouge-1/base.json`: Apache-2.0, 11 shard hashes, tokenizer, chat
  template and config.
- **Why 27B.** It is large enough to be serious and small enough for one
  GPU (QLoRA). The 397B plan was withdrawn by the owner and remains in git
  history only.
- **One lineage.** Checkpoints follow one line from the pinned base:

  ```
  Qwen3.5-27B → rouge-1-sft-001 → rouge-1-reasoning-001 → rouge-1-context-001 → … → Rouge 1
  ```

- **Correct description:** "Rouge 1, based on Qwen3.5-27B".
- **Never claim** that Rouge was pretrained from scratch, that its
  parameters are infinite, or that it has a context length a checkpoint has
  not passed.

## Where things live

| Thing                                                              | Location                                                                                                                                                       |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base weights                                                       | The original Hugging Face repository, at the pinned revision (immutable source)                                                                                |
| Rouge checkpoint weights                                           | A dedicated Rouge model repository (Hugging Face, Xet-backed), created when the first checkpoint exists                                                        |
| Training code, configs, dataset registry, manifests, eval, reports | This repository (`training/rouge/`, `models/rouge-1/`)                                                                                                         |
| Checkpoint manifests                                               | `training/rouge/checkpoints/`: sha256 of every file, parent, run, code commit, environment lock, data version, hyperparameters, seed, steps, loss, evaluations |

No weights ever enter this Git repository.

## The unit of progress

**A new checkpoint whose weights differ from its parent and measurably
beat it.**

- The comparison uses the same inference settings and the same hidden eval
  set.
- Wins **and** regressions are reported.
- If Rouge is worse, that is said, and the next candidate changes data or
  config.

A new TypeScript class, router or runtime stage is not Rouge progress.

## M58: definition of done

M58 is **not** complete because training code exists. It completes when
`rouge-1-sft-001` exists and all of the following hold:

1. Its weights provably differ from the base (`merge.weight_delta`).
2. Its manifest records:
   - base revision;
   - dataset revision;
   - training and LoRA configuration;
   - seed, steps and loss;
   - checkpoint hashes.
3. It has been compared with the base on the hidden eval set, with wins and
   regressions reported.

**Status:**

| Item                             | State                                                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pipeline                         | Built and tested                                                                                                                                                   |
| CI smoke run                     | Tiny model of the base's architecture with the real tokenizer: data → template → forward/backward → LoRA → checkpoint → resume → merge → reload → inference → eval |
| In-house generators              | Built                                                                                                                                                              |
| Open-source SFT mixture          | Being assembled                                                                                                                                                    |
| Single-GPU sizing and exact cost | In `compute-plan.md`                                                                                                                                               |
| **The real run**                 | **Waits for the owner's approval.** Recommended: 1× H100 80 GB, about $16–27                                                                                       |

## Rules

**Data**

- Benchmarks used for claims never train Rouge.
- Train, dev, holdout and adversarial splits are kept apart, and
  decontamination runs before every build.
- Every sample has provenance.
- Licences are verified at a pinned revision.
- Teacher-model outputs are used only when that model's terms permit
  training on them.

**Claude's role:** research and training engineer, dataset designer,
evaluation designer and reviewer.

- Claude is not Rouge's runtime brain.
- Claude writes no training responses. The generators compute them.
- There is no Claude-output distillation unless Anthropic's terms
  explicitly allow it.

**Compute:** no paid compute without the owner's explicit approval, and no
cluster or recurring GPU infrastructure.

**Context:** SFT starts at 4k–8k tokens. The steps after that are 16k, 32k,
64k, 128k and 262k. Anything towards 512k, 1M or 2M is research, and only
after Rouge training itself works.

## Roadmap

| Milestone | Scope                                                       |
| --------- | ----------------------------------------------------------- |
| M58       | Real training foundation and the first Rouge SFT checkpoint |
| M59       | Reasoning post-training                                     |
| M60       | Response and instruction intelligence                       |
| M61       | Preference training                                         |
| M62       | Verified data flywheel                                      |
| M63       | Reasoning RL with verifiable rewards                        |
| M64       | Coding and science specialisation                           |
| M65       | Long-context training                                       |
| M66       | Multimodal improvement                                      |
| M67       | Continual model improvement                                 |
| M68       | Model-native self-improvement pipeline                      |
| M69       | Advanced post-training                                      |
| M70       | Rouge 1 RC benchmark certification                          |
| M71       | AI mode integration (ChatHub: AI = Rouge 1, Agent = Osirus) |
| M72       | Design and animations                                       |
| M73       | Polish, security and performance                            |
| M74       | Stripe, domain, legal and search                            |
| M75       | Release                                                     |

The M56/M57 runtime is legacy research: [`legacy-runtime.md`](legacy-runtime.md).
