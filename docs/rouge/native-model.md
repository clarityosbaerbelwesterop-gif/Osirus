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
  Qwen3.5-27B → rouge-1-exp-001 → rouge-1-sft-001 → rouge-1-reasoning-… → … → Rouge 1
  ```

- **Correct description:** "Rouge 1, based on Qwen3.5-27B".
- **Never claim** that Rouge was pretrained from scratch, that its
  parameters are infinite, or that it has a context length a checkpoint has
  not passed.

## One lineage, two deployment targets

| Target         | What                                                     | Runs on                                                                                       |
| -------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Rouge Full** | The canonical checkpoint (BF16), maximum capability      | Rouge Server: vLLM/SGLang, OpenAI-compatible, on our own hardware or a temporarily rented GPU |
| **Rouge Edge** | A quantised (GGUF) derivative of the **same** checkpoint | llama.cpp with Metal: Mac, and iPad/iPhone only where memory allows; offline and private      |

- Edge is never a different, unrelated foundation model. If a device class
  cannot hold the 27B even quantised (iPhone, most iPads), the smaller Edge
  model is **derived from Rouge weights** (pruning, then distillation from
  Rouge Full), and it stays in the lineage with its own manifest.
- Sizes, memory and speed per device: [`deployment.md`](deployment.md).

## Compute is ephemeral

Claude runs the training loop: dataset → curriculum → launch → monitoring →
checkpoint → evaluation → repair → next candidate. The hardware is not
kept.

- **Free hardware (CI, CPU, existing machines)** does everything that does
  not update 27B weights:
  - dataset construction, verification, deduplication and tokenizer work;
  - the tiny-model smoke run of the real training path;
  - evaluation logic and pre-registration;
  - quantisation tooling and the Edge pipeline (GGUF, Metal, iOS build);
  - checkpoint manifests and server packaging.
- **A GPU only for an actual Rouge weight update**, in one session:
  `START → PREPARE → TRAIN → EVALUATE → SAVE → STOP`
  (`training/rouge/scripts/gpu_session.sh`).
  - The pod stops itself on every exit path.
  - A cost guard stops training that would exceed its hour budget.
- **Failure is not answered with more compute.** It is answered with
  different data, loss or hyperparameters.

## Where the intelligence lives (50/50)

Rouge's intelligence comes from two halves. Both are Rouge; neither is
Osirus.

- **Model-native (the weights):** SFT, preference learning, reasoning
  training, RL with verified rewards, context training and multimodal
  training.
- **The lightweight Rouge layer (next to the weights, no agent logic):**
  - context management: template, thinking budget, long-context settings;
  - memory and retrieval, served as context to the one model;
  - verification of Rouge's own answers;
  - adaptive compute: thinking on or off, token budget.

The Rouge layer never grows into an agent runtime. It has no tools, no
multi-agent orchestration, no routing across foreign models and no task
planning. That is Osirus: **Osirus is the agent, Rouge is the model.**

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

M58 is **not** complete because training code exists. The next milestone is
not "we rented a GPU". It is:

> **Rouge's weights changed, and the new checkpoint measurably beat its
> baseline.**

**The first experiment is `rouge-1-exp-001`.** It is the cheapest real
weight-changing experiment, and it is pre-registered in
[`training/rouge/experiments/rouge-1-exp-001.json`](../../training/rouge/experiments/rouge-1-exp-001.json).
The eval hash, the decision rule and the next step for PASS and for FAIL
were all fixed before any training.

M58 completes when `rouge-1-exp-001` (or a later experiment) meets all of
these:

1. Its weights provably differ from the base (`merge.weight_delta`).
2. Its manifest records:
   - base revision;
   - dataset revision (file hashes);
   - training and LoRA configuration;
   - seed, steps and loss;
   - checkpoint hashes.
3. It **passes** its pre-registered blind evaluation against the base:
   - the primary suite improves;
   - no guard regresses;
   - wins and regressions are reported.

**Next steps by outcome:**

- **PASS:** scale the recipe to `rouge-1-sft-001` and convert the checkpoint
  to Rouge Edge.
- **FAIL:** change data, loss or hyperparameters. The same recipe gets no
  more compute.

**Status:**

| Item                             | State                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pipeline                         | Built and tested; records base revision, dataset hashes, config, LoRA, seed, steps, loss and checkpoint hashes                                               |
| CI smoke run                     | Tiny model of the base's architecture with the real tokenizer: data → template → LoRA → checkpoint → resume → cost guard → merge → reload → inference → eval |
| `rouge-exp-001` data             | Built: 9,056 conversations, 4.8M tokens, 2,147 German ([manifest](../../training/rouge/datasets/manifests/rouge-exp-001.json))                               |
| Pre-registered blind eval        | 796 items: primary 280 (held-out templates), guards 500 (MGSM en/de, MBPP, IFEval), report 16                                                                |
| Rouge Edge path                  | GGUF → Q8_0…Q4_K_M → speed, KL divergence and eval via llama-server, in CI (Linux + Metal) and iOS build ([deployment](deployment.md))                       |
| Rouge Server path                | `training/rouge/serve/rouge-server.sh` (vLLM or llama-server, OpenAI-compatible); the same eval harness scores it                                            |
| **The run `rouge-1-exp-001`**    | **Waits for the owner's approval** ([compute plan](compute-plan.md) §3)                                                                                      |
| `rouge-sft-v0` (18k, 49M tokens) | Built and kept for scaling after a PASS; not the first run                                                                                                   |

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

**Compute:** no paid compute without the owner's explicit approval, no
cluster, no recurring GPU infrastructure and no idle paid GPU.

**Context:** SFT starts at 4k–8k tokens. The steps after that are 16k, 32k,
64k, 128k and 262k. Anything towards 512k, 1M or 2M is research, and only
after Rouge training itself works.

## Roadmap

| Milestone | Scope                                                                              |
| --------- | ---------------------------------------------------------------------------------- |
| M58       | Real training foundation; first checkpoint that beats its base (`rouge-1-exp-001`) |
| M59       | Reasoning post-training                                                            |
| M60       | Response and instruction intelligence                                              |
| M61       | Preference training                                                                |
| M62       | Verified data flywheel                                                             |
| M63       | Reasoning RL with verifiable rewards                                               |
| M64       | Coding and science specialisation                                                  |
| M65       | Long-context training                                                              |
| M66       | Multimodal improvement                                                             |
| M67       | Continual model improvement                                                        |
| M68       | Model-native self-improvement pipeline                                             |
| M69       | Advanced post-training                                                             |
| M70       | Rouge 1 RC benchmark certification                                                 |
| M71       | AI mode integration (ChatHub: AI = Rouge 1, Agent = Osirus)                        |
| M72       | Design and animations                                                              |
| M73       | Polish, security and performance                                                   |
| M74       | Stripe, domain, legal and search                                                   |
| M75       | Release                                                                            |

The M56/M57 runtime is legacy research: [`legacy-runtime.md`](legacy-runtime.md).
