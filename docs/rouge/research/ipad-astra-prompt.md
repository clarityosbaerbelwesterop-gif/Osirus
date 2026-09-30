# Research prompt: "iPad-Astra" (from the owner's screenshots, 2026-09-30)

Copy the block below into Claude (or any research agent) together with this repository. It turns the
ten ideas of the owner's "iPad-Astra" conversation into testable Rouge research. The research map it
refers to is `docs/rouge/research/milestones.md`; the current build is `docs/rouge/rouge1-build-status.md`.

```text
ROLE
You are the research lead of Rouge, a native language model built evidence-first (repository
clarityosbaerbelwesterop-gif/Osirus, branch rouge/native-model-m58, package training/rouge/native).
Goal: move Rouge toward "iPad-Astra" – frontier-useful intelligence that trains cheaply and runs on
a tablet (Apple M-class chip, 20-30 W, 8-16 GB unified memory).

NON-NEGOTIABLES
- Every claim needs a measurement from a pre-registered experiment (hypothesis, data, sizes, baseline,
  metric, gate, seeds) run through the repo's harness. No result, no claim.
- Respect the limits and state them where they bind:
  * Shannon: incompressible information (facts, names, numbers) cannot be stored below its entropy;
    "terabytes of knowledge in megabytes" is impossible for knowledge, possible only for generators
    of regular structure.
  * Knowledge capacity is about 2 bits per parameter when facts are seen often enough
    (Allen-Zhu & Li, Physics of Language Models 3.3).
  * On-device, memory bandwidth and joules per token dominate, not FLOPs; Landauer's bound is far
    below today's hardware and is not the constraint.
- Read what Rouge already rejected before proposing: slot state (R1.14), exact slot memory (R1.14b),
  adaptive depth (R1.17/20/21), hypernetworks (R1.25), latent programs (R1.33/34), hypothesis
  heads/verifiers (R1.35/37/38), reward-only RL (R1.39/39b). Proven: sparse dispatch 3.3x (R1.22),
  ternary weights on real text (R1.29b). Candidates in the tournament: A dense, B hybrid attention,
  C ternary, D MoE, E Monarch-structured.
- Free compute first (GitHub runners, CPU, small models); paid GPU only through rouge-gpu approval.

THE TEN IDEAS -> TESTABLE HYPOTHESES (fill in each row, then rank)
1. Axiomatic learning instead of brute force.
   Nearest mechanism: verified synthetic curricula, rule-dense data, sample efficiency.
   Map: R1.54, R1.55, R1.65. Minimal test: equal tokens, web-only vs web + verified rule/derivation
   data; metric: held-out reasoning tasks and BPB per training token.
2. Perfect algorithmic shortcuts ("the formula for thinking").
   Nearest mechanism: program induction, tool use (calculator, interpreter), learned search.
   Map: R1.33 lessons, R1.65, R1.66. Minimal test: tool-augmented vs plain model on arithmetic and
   code tasks at equal parameters; report where the model itself cannot replace the tool.
3. Spike-based / neuromorphic: only the needed neurons fire.
   Nearest mechanism: expert sparsity (MoE, candidate D), activation sparsity (top-k / ReLU^2),
   early exit only if it beats R1.17's failure. Map: R1.22, R1.75. Minimal test: active parameters
   and measured joules per token on an M-chip at equal quality.
4. "Infinite" compression through fractal generators.
   Nearest mechanism: minimum description length, shared bases (W = sum a_i B_i), structured
   matrices (candidate E), ternary (R1.29b), procedural data generators. Map: R1.71, R1.72.
   Minimal test: quality per stored byte at 1 GB / 5 GB budgets; state what does not compress.
5. Instant training: the model rewires while you explain.
   Nearest mechanism: test-time training, fast weights, on-device LoRA, retrieval memory.
   Map: R1.45, R1.46, R1.50, R1.69. Minimal test: teach N new facts in dialogue; measure recall
   after 1/10/100 turns, interference with old knowledge, joules per update on the iPad.
6. Dialogue UI with a live 3D knowledge graph.
   Product surface (Osirus workbench), not a model claim: render what the model retrieves, stores
   and updates (memory writes, retrieved documents, expert routing) so the user sees learning.
7. Run it on the iPad: inference yes, pretraining no.
   The split is physical: pretraining a frontier model needs about 1e24-1e26 FLOPs over trillions of
   tokens; an M-class tablet delivers on the order of 1e13-1e14 useful FLOP/s, i.e. centuries.
   Inference of a trained model is feasible when weights are low-bit.
   Nearest mechanism: ternary / MatMul-free layers (BitNet b1.58; Zhu et al. 2024, "Scalable
   MatMul-free Language Modeling"), native int4/int2 quantisation, Neural Engine / Metal kernels,
   KV-cache or state compression. Map: R1.29b (ternary PASS), R1.71-R1.74, R1.75.
   Minimal test: export the ternary rung (C or D winner) to llama.cpp / CoreML; measure tokens/s,
   peak memory, joules per token on an M-chip iPad and the quality gap to bf16 on held-out BPB and
   tasks. Kill if the gap exceeds the pre-registered tolerance.
8. Train big in the datacenter, adapt small on the device.
   Nearest mechanism: pretrain on rented GPUs (B200 phase), then distil and quantise into edge
   variants; on-device only adapters, retrieval memory and test-time updates (idea 5).
   Map: R1.63, R1.72, R1.79. Minimal test: 1 GB and 5 GB edge variants of the same checkpoint,
   quality per GB, and on-device adapter updates (seconds and joules per update).
9. From statistics to logic.
   Next-token prediction stays the training signal; logic enters through verified data (idea 1),
   tools and program execution (idea 2), and verified-reward RL on top of a pretrained model
   (R1.39/39b showed reward-only RL from scratch fails). Map: R1.54, R1.65, R1.66.
   Minimal test: equal compute, with and without verified reasoning data plus tool calls; metric:
   held-out logic and math tasks, generalisation to longer instances than seen in training.
10. Native multimodality (text, audio, live video, 3D).
   Map: R1.61, R1.62 (the config reserves a vision patch encoder, `vision_patch`). Minimal test:
   image-patch input into the text model at 100M scale on a public, licensed caption set; metric:
   captioning / VQA at equal compute vs a text-only model with a frozen encoder.

OUTPUT (in this order)
1. One table: idea | hypothesis | milestone | minimal experiment (data, sizes, baseline, metric,
   gate, seeds) | cost (free CPU / free runner / GPU $) | expected effect size with its source |
   kill criterion.
2. The three experiments to run first, ranked by expected value per dollar, each as a
   pre-registration ready to commit under research/rouge-architecture/.
3. What is out of reach today and why (one line each), and which measurement would change that.
4. For idea 6: a UI sketch (components, data it reads from the model, update rate).
Write in plain technical English. No hype words. Numbers with units and sources.
```

## Why this prompt, in one table

| screenshot idea | what is real today | Rouge anchor |
|---|---|---|
| axiomatic learning | verified curricula raise sample efficiency | R1.54, R1.55, R1.65 |
| algorithmic shortcuts | tools and program induction; latent programs failed at small scale | R1.33, R1.65, R1.66 |
| neuromorphic sparsity | MoE and activation sparsity; sparse dispatch 3.3× measured | candidate D, R1.22, R1.75 |
| fractal compression | structure and low-bit compress weights, not facts | candidate E, R1.29b, R1.71, R1.72 |
| instant training | test-time training, fast weights, on-device adapters | R1.45, R1.46, R1.50, R1.69 |
| 3D knowledge graph | a product view of memory and retrieval | Osirus workbench |
| inference on the iPad | feasible with ternary / int4 weights and on-device kernels | R1.29b, R1.71–R1.75 |
| training on the iPad | pretraining impossible (1e24+ FLOPs); adapters and test-time updates possible | R1.50, R1.69, R1.72 |
| statistics to logic | verified data, tools, verified-reward RL on a pretrained model | R1.54, R1.65, R1.66 |
| native multimodality | vision/audio input into the model | R1.61, R1.62 |
