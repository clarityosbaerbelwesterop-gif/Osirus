# Distributed and volunteer compute for Rouge (checked 2026-10-01)

Each project below was checked from its source repository.

## Petals (bigscience-workshop/petals): not usable for Rouge

- **Status:** the last commit is 2024-08-25 (`22afba6`, "Upgrade Pydantic to >= 2.0.0"). Since then there has been no release and no new architecture.
- **Architectures:** `src/petals/models/` holds only `bloom`, `falcon`, `llama` and `mixtral`. Neither Qwen3.5/3.8 (`qwen3_5`, hybrid Gated DeltaNet) nor DeepSeek-V4 is supported.
- **Dependencies:** `petals/__init__.py` asserts `transformers>=4.43.1,<4.44.0`. `setup.cfg` pins `peft==0.8.2`, `bitsandbytes==0.41.1` and `numpy<2`.
  - Rouge trains with `transformers==5.17.0`.
  - Installing Petals into the training environment would downgrade it and break the pipeline.
  - If it is ever tried, it goes into an isolated venv only.
- **What it does:**
  - Inference and parameter-efficient fine-tuning: prompt tuning and adapters run on the client, while the swarm serves frozen layers.
  - Its headline speed is 4–6 tokens/s for 70–180B models.
  - There is no full-parameter training.
- **Public swarm:** its health could not be checked from here (`health.petals.dev` is blocked by this environment's proxy). Secondary sources from 2026 describe the project as having little activity.

## exo (exo-explore/exo): useful, for running Rouge locally across devices

- **Status:** Apache-2.0 and actively maintained (last commit 2026-08-25).
- **What it does:** MLX backend (Apple silicon), automatic device discovery, and tensor parallelism across devices (1.8× on 2 devices, 3.2× on 4, from its README). It offers an OpenAI-compatible API.
- **Fit with Rouge:** it ships model cards for the `qwen3_5` architecture, including `mlx-community/Qwen3.6-27B-bf16`. That is Rouge 1's architecture class (Qwen3.8-27B), so a Rouge 1 checkpoint converted to MLX should run on two or more Macs together, with no server.
- **Built:** `serve/exo_runtime.py` (convert, card, place, chat) and `serve/install.py --runtime exo` (download the gated checkpoint, convert to 4-bit MLX, write the exo model card, print the start commands).
- **Verified in CI** (`rouge-exo.yml`, run 36840971178, exo at commit `21a54c5`, free Linux runner, exo's MlxCpu backend):
  1. A tiny checkpoint of Rouge's architecture class (`Qwen3_5ForConditionalGeneration`, random weights) converts to 4-bit MLX with exo's own mlx-lm.
  2. exo loads it from a read-only local directory (`EXO_MODELS_READ_ONLY_DIRS`); nothing is downloaded.
  3. `POST /place_instance` places it; the runner is ready in 4.8 s.
  4. Chat answers over exo's OpenAI-compatible API (random weights, so the text is noise).
  5. `rouge_train.cli generate --backend openai` scores 3 eval items through exo.
- **Linux note:** exo's lock file installs a CUDA build of an MLX fork next to PyPI's `mlx-cpu` 0.31.2, and their native libraries do not link (`undefined symbol`). The official PyPI pair `mlx==0.32.0` + `mlx-cpu==0.32.0` works. On Apple silicon (Metal) exo's own lock is used unchanged.
- **Offline:** exo runs with `EXO_OFFLINE=true` (CI and `install.py`). It then serves only weights already on the device and never asks a hub, as Rouge is meant to run. Without it, exo asks the Hugging Face hub for a file list even for local weights.
- **Readiness:** `/instance/await` answers as soon as the instance exists, before its weights are loaded. `exo_runtime.place` therefore waits for every runner of the instance to report ready in `/state`, and stops on a failed runner or download.
- **Real model on the Linux CPU backend** (run 36844724875, `mlx-community/Qwen3.5-2B-MLX-8bit`, 2.66 GB, staged locally in 13 s):

  | phase | time |
  |---|---|
  | load the weights | 0.35 s |
  | warm-up prefill | 230 s |
  | warm-up decode, 50 tokens | 765 s (about 0.07 tokens/s) |
  | prefill of an 11-token prompt | 127 s |

  - The path works with real weights of Rouge's family.
  - exo's MlxCpu backend on x86 is not a usable runtime; it is not exo's target. Throughput is measured on Apple silicon (Metal).
  - On machines without Apple silicon, Rouge runs on llama.cpp (GGUF), the default of `install.py`.
- **Open:** measure an exo cluster of the owner's devices against llama.cpp on one device, with the same eval items, once the first gated Rouge 1 checkpoint exists.

## Decentralised RL and training: patterns for later iterations

- **prime-rl (PrimeIntellect-ai):**
  - Asynchronous RL: rollouts come from untrusted inference workers, and the trainer runs centrally. INTELLECT-2 (32B) was trained this way.
  - It matches Rouge's RSI loop, where sampling is the expensive phase and can move to cheaper or interruptible GPUs.
  - Candidate for iteration 3 and later. It is not needed for `rouge-1-rl-001`.
- **Psyche / DisTrO (Nous Research):** internet-scale pretraining with orders-of-magnitude less communication. This is research for Rouge 2 (pretraining from scratch), not for Rouge 1.

## What none of these change

- Volunteer or decentralised compute still needs GPUs somewhere.
- None of these lets a model exceed the memory its devices have in total, or turns CPUs or agents into GPU throughput.
