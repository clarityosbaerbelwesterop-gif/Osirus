# Rouge 1 architecture milestones (R1.xx)

These milestones are separate from the Osirus Mxx milestones. They are a
research program, not a to-do list: every milestone has a hypothesis, the
cheapest falsifying experiment, a conventional baseline, trained weights
and a documented result. Negative results count and are recorded.

**Rules:**

- **Scale ladder.** 10M → 50M → 100M → 300M → 1B. A mechanism moves up
  only after it beats its baseline at the size below.
- **Compute tier.** Always the lowest tier that answers the question: CI or
  CPU, then iPad, then the owner's server, then other owner hardware, and
  a temporary H200 only with evidence and approval.
- **Baselines.** Every milestone compares against a Transformer at equal
  parameters and at equal FLOPs, plus recurrent, SSM or MoE baselines where
  relevant.
- **Three capacity numbers, never mixed:** physical parameters,
  active parameters or compute, and virtual capacity.

## R1.01–R1.08 Theory and baselines

| ID    | Milestone                                                                                                  | Tier      |
| ----- | ---------------------------------------------------------------------------------------------------------- | --------- |
| R1.01 | Persistent state + adaptive recurrence vs Transformer (parameter- and FLOP-matched). **FAIL** (R1.01, R1.01b) | CI        |
| R1.02 | Learned halting (fixed / ACT / ACT-warm / PonderNet) on a depth-controlled, cue-audited benchmark (R1.02b) | CI        |
| R1.03 | State probes (trained vs untrained) + two-level memory (active state + exact slots, top-k reads)           | CI        |
| R1.04 | Sparse circuits: top-2-of-8 module bank vs dense at matched active compute and total parameters            | CI        |
| R1.05 | Prior-art map (`docs/rouge/research/prior-art.md`). **PASS**                                               | —         |
| R1.06 | Benchmark v3: 11 capabilities + automatic shortcut audit + rotating holdout + adversarial split. **PASS**  | CI        |
| R1.07 | Baseline zoo on v3: Transformer, LSTM, GRU, selective SSM, looped, MoE, rouge-mem (pre-registered)         | CI/server |
| R1.08 | Canonical scorecard (`experiments/suite.py`) + gates as data (`lab/gate.py`)                               | CI        |

## R1.09–R1.16 Persistent state

| ID    | Milestone                                                                            |
| ----- | ------------------------------------------------------------------------------------ |
| R1.09 | Cheaper reads: cross-attention write into the slots instead of a full cell per token |
| R1.10 | State capacity laws: accuracy vs M·d on recall and state tasks                       |
| R1.11 | Hybrid: persistent state + a small local attention window                            |
| R1.12 | State across documents and sessions (streaming, no reset)                            |
| R1.13 | State compression and forgetting (learned gates)                                     |
| R1.14 | 10M language model with persistent state vs a 10M Transformer on text perplexity     |
| R1.15 | 50M scale-up of whichever of R1.09–R1.14 won                                         |
| R1.16 | Long-context: constant-memory state vs KV cache at 32k–1M tokens                     |

## R1.17–R1.24 Dynamic and sparse compute

| ID    | Milestone                                                          |
| ----- | ------------------------------------------------------------------ |
| R1.17 | Per-token adaptive depth (Mixture-of-Depths-style) inside the cell |
| R1.18 | Sparse expert cells: capacity ≫ active parameters                  |
| R1.19 | Learned routing between cells (circuits), load balance, stability  |
| R1.20 | Compute budgets at inference ("think harder" knob), calibration    |
| R1.21 | Early exit and speculative answers from the state                  |
| R1.22 | Sparse kernels (Triton/Metal) so sparsity saves real time          |
| R1.23 | 100M sparse Rouge vs dense 100M at equal FLOPs                     |
| R1.24 | Energy measurement on real hardware                                |

## R1.25–R1.32 Generated and structured weights

| ID    | Milestone                                                                     |
| ----- | ----------------------------------------------------------------------------- |
| R1.25 | Hypernetwork-generated cell weights from state (W = G(state, task))           |
| R1.26 | Low-rank / Kronecker / tensor-train cells: quality per stored byte            |
| R1.27 | Shared basis banks + per-circuit coefficients                                 |
| R1.28 | Implicit neural representations of weight matrices                            |
| R1.29 | Ternary/low-bit trained-from-start cells (BitNet-style)                       |
| R1.30 | Virtual capacity accounting (addressable vs stored vs active)                 |
| R1.31 | Compression frontier: capability per byte at 1 / 5 / 40 GB targets (modelled) |
| R1.32 | 100M structured-weight Rouge vs dense baselines                               |

## R1.33–R1.40 Neural programs and hypothesis search

| ID    | Milestone                                                                  |
| ----- | -------------------------------------------------------------------------- |
| R1.33 | Latent program states: build → execute → inspect → modify inside the model |
| R1.34 | Differentiable execution traces; verification signal from the task         |
| R1.35 | Multiple hypothesis slots with support / contradiction / uncertainty       |
| R1.36 | Learned test selection: which computation best separates hypotheses        |
| R1.37 | Self-verification heads: calibrated confidence per answer                  |
| R1.38 | Search over latent programs within a compute budget                        |
| R1.39 | Math and code tasks with verifiable rewards on the program state           |
| R1.40 | 300M program-state Rouge vs Transformer + chain of thought at equal FLOPs  |

## R1.41–R1.48 Causal world model and memory

| ID    | Milestone                                                                |
| ----- | ------------------------------------------------------------------------ |
| R1.41 | Environments with interventions: observation vs intervention data        |
| R1.42 | Causal structure in the state: interventional prediction accuracy        |
| R1.43 | Counterfactual simulation from the state                                 |
| R1.44 | Separate stores: knowledge (weights), working state, long-term memory    |
| R1.45 | Learned write/read to long-term memory (fast weights / test-time memory) |
| R1.46 | New facts without weight updates: retention and interference             |
| R1.47 | Memory at scale: retrieval quality vs size                               |
| R1.48 | 300M memory-augmented Rouge on long-horizon tasks                        |

## R1.49–R1.56 New learning rules

| ID    | Milestone                                                                  |
| ----- | -------------------------------------------------------------------------- |
| R1.49 | Local / predictive objectives for the cell; compare to end-to-end backprop |
| R1.50 | Test-time learning inside the state (online adaptation)                    |
| R1.51 | Meta-learned update rules (learned optimisers) on small tasks              |
| R1.52 | Forward-forward / energy-based variants where justified                    |
| R1.53 | Synthetic gradients for long recurrences (memory cost of BPTT)             |
| R1.54 | Curriculum and self-generated tasks with verified answers                  |
| R1.55 | Sample efficiency study: capability per training token                     |
| R1.56 | Choose the training rule for the 1B stage from measurements                |

## R1.57–R1.64 Scaling, long context, multimodal

| ID    | Milestone                                                             |
| ----- | --------------------------------------------------------------------- |
| R1.57 | Scaling laws for the winning mechanisms (10M–300M)                    |
| R1.58 | 1B Rouge prototype on the owner's server                              |
| R1.59 | Language pretraining recipe for Rouge (data, tokens, schedule)        |
| R1.60 | Long context: 128k → 1M with constant-memory state                    |
| R1.61 | Vision input into the state                                           |
| R1.62 | Audio / other modalities                                              |
| R1.63 | Comparison with the Qwen baseline program at equal cost               |
| R1.64 | Go / no-go for a larger Rouge (with the H200 evidence list if needed) |

## R1.65–R1.70 Model-native self-improvement

| ID    | Milestone                                                                       |
| ----- | ------------------------------------------------------------------------------- |
| R1.65 | Model proposes its own training tasks with verified answers                     |
| R1.66 | Verified-reward RL on the latent program state                                  |
| R1.67 | Automated architecture search over the proven mechanisms, with pre-registration |
| R1.68 | Safety and regression gates for self-improvement                                |
| R1.69 | Continual learning without forgetting                                           |
| R1.70 | Self-improvement loop measured over generations                                 |

## R1.71–R1.75 40 GB / edge / extreme efficiency

| ID    | Milestone                                                      |
| ----- | -------------------------------------------------------------- |
| R1.71 | ≤ 40 GB physical representation with reported virtual capacity |
| R1.72 | 5 GB and 1 GB edge variants (quantised / structured), measured |
| R1.73 | Metal / CoreML / llama.cpp kernels for the Rouge architecture  |
| R1.74 | On-device measurement: Mac, iPad, iPhone                       |
| R1.75 | Energy per answer vs Transformer baselines                     |

## R1.76–R1.80 Frontier model and product certification

| ID    | Milestone                                                                       |
| ----- | ------------------------------------------------------------------------------- |
| R1.76 | Frontier-scale candidate decision from measured laws                            |
| R1.77 | Public benchmark certification vs Qwen baseline, raw Qwen and reference systems |
| R1.78 | Safety, robustness and red-team certification                                   |
| R1.79 | Rouge Server + Rouge Edge packaging of the new architecture                     |
| R1.80 | Rouge 1 release candidate                                                       |
