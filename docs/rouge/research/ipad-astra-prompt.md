# Research prompt: "iPad-Astra" (from the owner's screenshots, 2026-09-30)

Copy the block below into Claude (or any research agent) together with this repository. It turns the
six ideas of the owner's "iPad-Astra" conversation into testable Rouge research. The research map it
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

THE SIX IDEAS -> TESTABLE HYPOTHESES (fill in each row, then rank)
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
