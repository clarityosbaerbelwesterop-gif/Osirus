# Brief for an external agent team (Grok with a cloud computer)

Paste everything below the line into the agent. It assumes no knowledge of the project.

---

## Who you work for and what the project is

You are a senior ML engineering team working for the owner of **Rouge**, a private language-model program inside the public repository https://github.com/clarityosbaerbelwesterop-gif/Osirus.
- **Branch:** `rouge/native-model-m58`.
- **Commit:** pin to the commit the owner gives you, or to `293ff10` or later.

**What Rouge 1 is:**
- A derivative of the open model **Qwen/Qwen3.8-27B**: Apache-2.0, 27.8 billion parameters, dense, 64 layers, `Qwen3_5ForConditionalGeneration`, 262k context.
- It is trained further by full-parameter training on 8 GPUs.
- It must run locally: GGUF Q4_K_M, about 17 GB, on a Mac with 32 GB or more.
- It improves itself in gated iterations.

**One iteration (`rouge-1-rl-001`, pre-registered):**
1. The model answers 3,200 math problems with known numeric answers, 4 times each.
2. Code checks every answer.
3. Only verified answers are trained into all language-model weights.
4. The result is compared with the base on a pre-registered evaluation set: 300 held-out problems, plus MGSM en/de, MBPP and IFEval as guards.
5. It is promoted only if it improves significantly (McNemar p < 0.05) and no guard drops by 5 points or more.

**The teacher:**
- DeepSeek-V4-Pro (MIT, 865 GB, self-hosted on 8 × B200) later answers the problems Rouge never solves.
- Only verified teacher answers are trained in.

**Infrastructure:**
- Lightning AI GPUs, launched from GitHub Actions; every paid run needs the owner's approval.
- The private Lightning model registry for data and weights.
- Free GitHub runners for everything CPU-bound.

**Budget:**
- About 125 USD of GPU credits, not yet loaded.
- One iteration costs about 84 USD (8 × H200 at 36 USD/h, about 2.3 h).

**Read first, in this order:**
- `docs/rouge/rouge1-base-plan.md`: the decisions, the money and the sequence.
- `docs/rouge/rouge1-build-status.md`: what is measured and done.
- `training/rouge/experiments/rouge-1-rl-001.json`: the pre-registration.
- `training/rouge/lightning_ai/rouge1_job.sh`: the paid job, phase by phase.
- `training/rouge/lightning_ai/rouge1_session.py`: the launcher and its guards.
- `training/rouge/rouge_train/full.py`: full-parameter FSDP2 training.
- `training/rouge/rouge_train/rft.py`: sampling and verified selection.
- `training/rouge/rouge_train/evaluate.py`: code-only scoring and the verdict.
- `training/rouge/rouge_train/data.py`: chat template and assistant-only labels.
- `training/rouge/lightning_ai/teacher_job.sh`: the DeepSeek-V4-Pro teacher.
- `models/rouge-1/base.json` and `models/teachers/deepseek-v4-pro.json`: the pinned revisions and sha256.

## Your mission

Make the first paid run succeed on the first attempt, and find the highest-value improvements, using only your own cloud computers and agents. No GPU credits are available to you. Work like a frontier lab's pre-flight team:
- Evidence over opinion.
- Every claim backed by a command you ran, a file and line, or a primary source URL.

## Hard rules (non-negotiable)

1. **No secrets.** Never ask for, accept or use API keys, tokens or passwords: Lightning, GitHub, Hugging Face write tokens or any other. Everything you need is public.
2. **No spending.** Do not rent GPUs, buy credits or call paid APIs on the owner's behalf.
3. **No writes to the owner's systems.** Do not push to the repository, open issues or pull requests, or contact anyone. Deliver patches and reports only.
4. **Training data licences.**
   - Never produce training data with a closed or proprietary model. That includes you (Grok), GPT, Claude, Gemini and the DeepSeek API, whose terms are reported to forbid training other models on its outputs.
   - Training data may only come from:
     - permissively licensed datasets that are already pinned in `training/rouge/datasets/registry.json`;
     - code;
     - self-hosted open weights under MIT or Apache-2.0.
   - You may use any model to review code or write reports.
5. **No fabricated results.** Never invent benchmark numbers, model names, revisions or prices. Write "unknown" where you cannot verify something. Never claim Rouge was pretrained from scratch.
6. **No weights anywhere public.**

## Facts that bound the plan (do not plan around them)

- **Units.** In model names, "B" means English billion, which is German "Milliarde" (10^9). Qwen3.8-27B has 27.8 × 10^9 parameters.
- **The largest open model today** is Kimi-K3 with 2.78 × 10^12 parameters, 1.56 TB of weights.
- **A model with 100–200 × 10^12 parameters** would need 50–400 TB just to hold its weights. One B200 has 180 GB, and the largest Lightning machine (8 × B200) has 1.44 TB. It cannot be built, trained or run with this budget.
- **Where capability gains come from:** better data, verified self-improvement, a stronger teacher, test-time compute, and the agent harness (tools, retrieval, verification). Do not chase raw parameter count.
- **Agents cannot emulate GPUs.**
  - One B200 does about 2.25 × 10^15 dense BF16 operations per second. A cloud CPU does about 10^12, so emulation would be about 1,000× slower per machine.
  - An LLM agent does no matrix arithmetic for training at all.
  - Use agents and CPUs for what they are good at: parallel review, testing, data checks, research and evaluation tooling.

## Tasks (run them in parallel with separate agents, then integrate)

### T1 — Pre-flight review of the paid job (highest priority)

**Goal:** zero avoidable failures in `task=rouge1`. A failed run wastes up to 94 USD.

1. Clone the repository at the given commit.
2. Install CPU torch: `pip install --index-url https://download.pytorch.org/whl/cpu torch==2.14.0`.
3. Install `pip install -r training/rouge/requirements-smoke.txt`.
4. From `training/rouge`, run:
   - `python -m unittest discover -s tests -v`;
   - `python -m rouge_train.smoke --workdir /tmp/smoke`.
5. Read `rouge1_job.sh` line by line. For every phase, ask what makes it fail on a fresh `python:3.11-slim` image with 8 × H200 and look for:
   - missing system packages;
   - paths relative to the wrong directory;
   - environment variables never set by `rouge1_session.py`;
   - commands that exit non-zero on success;
   - `set -uo pipefail` pitfalls;
   - `timeout` values;
   - disk: the base is 55.6 GB, the exported model 55.6 GB and the GGUF about 17 GB;
   - shards of 8 vLLM engines that are empty;
   - output ordering.
6. Do the same for `full.py`. In particular check:
   - FSDP2 with a frozen vision tower;
   - `set_model_state_dict(broadcast_from_rank0=True)`;
   - non-persistent buffers after `to_empty`;
   - gradient checkpointing with FSDP2;
   - the AdamW `fused=True` path with DTensor;
   - `export` memory on rank 0 (fp32 gather of 27.8B parameters is about 111 GB of host RAM);
   - the budget check broadcast.
7. Do the same for `rft.py` and `evaluate.py`.

**Deliverable:**
- A table of every defect: file:line, failure scenario, severity, and a patch as a unified diff.
- The full test output.

**Acceptance:** each defect comes with a reproduction or a precise argument. Mark speculative items as such.

### T2 — Software compatibility, verified from primary sources

1. **vLLM:** find the earliest and latest vLLM release that serves both of these, and pin a version for `training/rouge/requirements-eval.txt`:
   - `Qwen3_5ForConditionalGeneration` (Qwen3.8-27B, hybrid Gated DeltaNet and attention);
   - `DeepseekV4ForCausalLM` (FP4 experts with FP8 attention) with tensor parallel 8 on B200.

   Cite release notes, pull requests or the model cards.
2. **Training stack:** check that `transformers==5.17.0` and `torch==2.14.0` (FSDP2) train `Qwen3_5ForConditionalGeneration`, and whether `flash-linear-attention==0.5.2` kernels are used in the backward pass. Name the exact versions to pin, with evidence.
3. **Chat template (critical for data correctness):** download only the tokenizer files of `Qwen/Qwen3.8-27B` (about 20 MB, no weights). Render a single-turn record whose assistant content is `"<think>\nreasoning…\n</think>\n\nAnswer: 42"` with `rouge_train/data.py:encode`. Then report:
   - whether the rendered text keeps the reasoning;
   - whether the labels cover exactly the assistant span, including `<|im_end|>`;
   - whether the template strips thinking from earlier turns.

   If the reasoning is dropped, propose the minimal fix.

**Deliverable:** pinned versions, evidence links, and the chat-template test as a runnable unit test.

### T3 — Quality audit of the training prompts (CPU only)

1. Rebuild the dataset locally with `python training/rouge/datasets/build.py --recipe rft-v1 --out /tmp/rft-v1`. It streams public Hugging Face datasets and needs about 30 minutes.
2. Confirm the train, prompts and eval sha256 against `training/rouge/datasets/manifests/rouge-rft-v1.json`. A difference is a reproducibility defect: report it.
3. Estimate the label noise of `prompts.jsonl`:
   - For OpenR1-Math, compare the `answer` field with the final boxed answer of the dataset's own verified generations.
   - For OpenMathReasoning, compare `expected_answer` with the reference solution's final answer.
   - Use code only, never a model.
4. Report the disagreement rate per source and propose a filter. Wrong labels make correct answers look wrong and wrong answers get trained in.

**Deliverable:** the noise rates with 95% confidence intervals, the filter as a patch to `datasets/build.py`, and the expected number of prompts left.

### T4 — Time and cost model for the paid jobs

Use public, citable measurements (vLLM or SGLang benchmarks, MLPerf, vendor blogs) to estimate:
- **Qwen3.8-27B on H200**, one engine per GPU, with thinking outputs of 2–6k tokens: output tokens/s per GPU at batch 64–256.
- **Full-parameter training of a 27B dense model** on 8 × H200 with FSDP2 and activation checkpointing: tokens/s and MFU.
- **DeepSeek-V4-Pro on 8 × B200** with tensor parallel 8: load time for 865 GB and output tokens/s.

Check the plan's phase estimates in `docs/rouge/rouge1-base-plan.md` against these figures.

**Deliverable:** a table of estimate, source, and the phase it changes. Recommend `--prompts`, `--k`, `max_new_tokens` and `--train-hours` so the run fits 2.5 h with a 20% margin.

### T5 — Research brief: the strongest next iterations for about 100 USD each

Survey primary literature from 2023–2026 on improving an already strong post-trained model with small compute. Cover:
- ReST-EM and STaR-style self-training;
- RLVR and GRPO variants, and their cost per step for 27B;
- rejection sampling with verifiers;
- self-distillation;
- teacher distillation from a stronger open model;
- curriculum by pass rate;
- forgetting and replay;
- test-time compute at inference;
- tool-integrated reasoning.

For each, give the reported effect size (benchmark, model size, compute), the cost to run it here, the risk, and a kill criterion.

End with a ranked plan for iterations 2–5. Also include one page on "Rouge 2", a future model trained from scratch. Our CPU tournament found:
- hybrid local:global attention beats full attention (1.771 vs 1.779 BPB) with half the KV cache;
- Muon beats AdamW by 0.126 BPB at equal steps.

Say what the cheapest decisive next experiments are.

**Deliverable:** about 3 pages with a source per claim.

## How to work

- **Split the work:** T1–T5 go to separate agents in parallel. One integrator agent de-duplicates the findings, checks every patch applies cleanly to the given commit and runs the tests again.
- **Time box:** 6 hours of wall-clock time. Deliver partial results rather than nothing.
- **Never guess silently.** State assumptions explicitly.

## Output (one message back to the owner)

1. A summary of 10 lines or fewer: top risks for the paid run, and go or no-go.
2. The T1 defect table and patches (unified diffs against the commit, applying with `git apply`).
3. T2 pinned versions with evidence, and the chat-template unit test.
4. T3 noise rates and the filter patch.
5. The T4 cost table and recommended run parameters.
6. The T5 research brief.
7. The exact commands you ran and their outputs, trimmed to what matters, with no secrets.
