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
- **Next step, after the first gated checkpoint:**
  1. Add `serve/install.py --runtime exo`: download the checkpoint, convert it with `mlx_lm.convert` to 4-bit, and register it with exo.
  2. Measure the exo cluster against llama.cpp on one Mac, with the same eval items.

## Decentralised RL and training: patterns for later iterations

- **prime-rl (PrimeIntellect-ai):**
  - Asynchronous RL: rollouts come from untrusted inference workers, and the trainer runs centrally. INTELLECT-2 (32B) was trained this way.
  - It matches Rouge's RSI loop, where sampling is the expensive phase and can move to cheaper or interruptible GPUs.
  - Candidate for iteration 3 and later. It is not needed for `rouge-1-rl-001`.
- **Psyche / DisTrO (Nous Research):** internet-scale pretraining with orders-of-magnitude less communication. This is research for Rouge 2 (pretraining from scratch), not for Rouge 1.

## What none of these change

- Volunteer or decentralised compute still needs GPUs somewhere.
- None of these lets a model exceed the memory its devices have in total, or turns CPUs or agents into GPU throughput.
