# Rouge 1 — architecture research program R1

**Status:** R1.01 and R1.01b ran on free CI CPUs ($0). Both pre-registered results are **FAIL** ([R1.01](../../../research/rouge-architecture/results/r1.01/README.md), [R1.01b](../../../research/rouge-architecture/results/r1.01b/README.md)). The persistent state wins on state tracking (+5.5 to +8 points OOD, every seed, 4 KiB vs a 134 KiB KV cache) but loses exact recall (23% vs 97%), and ACT halting collapses to about 1 step. R1.02 (learned halting) is running. R1.03 (state probes and a two-level memory) and R1.04 (sparse conditional circuits) are pre-registered and queued on free compute. Each tests one mechanism on its own. The research loop (router, resumable runs, registry, controller) is described in [the research README](../../../research/rouge-architecture/README.md).

## Scope

- **Rouge Baseline Program** (Qwen3.5-27B post-training, `training/rouge/`):
  measures how far conventional post-training goes. It stays the control.
- **Rouge Architecture Program** (this document,
  `research/rouge-architecture/`): asks whether a fundamentally more
  efficient model architecture exists.

The optimisation target is **intelligence per byte, per parameter, per
FLOP, per training token and per watt**, not raw size. Nothing here is part
of the Osirus runtime. Rouge research builds no agent loop, tool use or
orchestration.

## 1. Architecture hypothesis

A Transformer rebuilds its whole understanding from the token context on
every forward pass. It does so with a **fixed** amount of computation per
token and a **growing** memory (the KV cache).

Rouge's hypothesis is that three changes buy more reasoning per parameter:

1. **A persistent learned state.** A fixed-size latent state is carried
   forward and updated, not recomputed.
2. **Recurrent computation over that state.** One shared cell, applied as
   often as the problem needs.
3. **Learned halting.** Easy inputs get few iterations, hard inputs get
   many.

The mechanism is expected to win where the required computation grows with
the problem:

- multi-step state tracking;
- variable-depth composition.

It is expected to **lose** where the problem is storing many independent
facts, because a fixed-size state has finite capacity. A good experiment
shows both.

Later milestones add the other pillars one at a time: sparse conditional
circuits, generated or structured weights, neural programs, hypothesis
states, causal models, learned memory and new learning rules. Each one
enters only after the mechanism before it has been measured. R1.01 tests
only persistent state plus adaptive recurrence, so that the evidence is
causal.

## 2. Mathematical formulation (R1.01)

**Notation.**

- Tokens: $x_1..x_T$, embedded as $u_t = E x_t \in \mathbb{R}^d$.
- State: $S \in \mathbb{R}^{M\times d}$, i.e. $M$ slots. Its initial value
  $S_0$ is learned.
- Cell: $C_\theta$, one pre-LN attention+MLP block over the $M+1$ vectors
  $[S; v]$.
- The update $\Delta_\theta(S, v)$ is the slot part of
  $C_\theta([S; v]) - S$.

**Read (one step per token; memory does not grow):**

$$S_t = \mathrm{LN}\big(S_{t-1} + \Delta_\theta(S_{t-1}, u_t)\big)$$

**Think, after the query** (a learned vector $z$ replaces the input):

$$S^{(n)} = \mathrm{LN}\big(S^{(n-1)} + \Delta_\theta(S^{(n-1)}, z)\big),\qquad S^{(0)} = S_T$$

**Halting** (Adaptive Computation Time, Graves 2016):

- Halting probability at step $n$: $p_n = \sigma(w^\top \bar S^{(n)} + b)$.
- Number of think steps: $N = \min\{n : \sum_{k\le n} p_k \ge 1-\epsilon\}$,
  capped at $N_{\max}$.
- Remainder: $R = 1 - \sum_{k<N} p_k$.

**Answer:**

$$\hat y = \mathrm{softmax}\Big(W\,\mathrm{LN}\big(\overline{\textstyle\sum_{n\le N} w_n S^{(n)}}\big)\Big),\quad w_n = p_n\ (n<N),\ w_N = R$$

**Objective** ($\tau$ trades correctness against compute; R1.02 sweeps it):

$$\mathcal{L} = \mathrm{CE}(\hat y, y) + \tau\,(N + R)$$

**Why this should help: the depth argument.**

- A fixed-depth Transformer (with finite precision) lies in the
  circuit-complexity class $\mathsf{TC}^0$.
- Composing $n$ non-commuting operations is believed to need depth that
  grows with $n$. So fixed-depth Transformers and SSMs cannot track general
  state over unbounded sequences (Merrill, Petty and Sabharwal 2024).
- A recurrence applies one update per step, so its depth grows with the
  input by construction.
- Adaptive halting spends that depth only where it is needed.

**Why it should lose somewhere: the capacity argument.**

- Rouge's state has fixed size, $M \cdot d$ numbers.
- Recalling any one of $n$ facts needs $\Omega(n)$ bits of state, which a
  fixed-size state eventually cannot hold.
- Transformers copy and retrieve from context far better than fixed-state
  models (Jelassi et al. 2024).

## 3. Prior-art map

What is **not** new:

- persistent latent state;
- latent recurrence;
- adaptive halting.

What R1.01 tests is whether this combination, at equal parameters and
compute, beats a Transformer on controlled reasoning tasks. No
"world first" claim is made.

| Mechanism                                    | Prior work                                                                                                                                                                                 | Rouge difference                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Adaptive halting                             | ACT (Graves 2016); Universal Transformer (Dehghani et al. 2018); PonderNet (Banino et al. 2021)                                                                                            | Same mechanism, applied to a persistent slot state rather than per-position depth                                                         |
| Latent recurrence / recurrent depth          | Recurrent-depth reasoning, [Geiping et al. 2025, arXiv 2502.05171](https://arxiv.org/abs/2502.05171); looped Transformers                                                                  | That work loops a Transformer block over the full token sequence; Rouge keeps a fixed-size state and does not grow memory with context    |
| Small recursive reasoners                    | HRM, [Wang et al. 2025, arXiv 2506.21734](https://arxiv.org/abs/2506.21734) (27M); TRM, [Jolicoeur-Martineau 2025, arXiv 2510.04871](https://arxiv.org/abs/2510.04871) (7M, 45% ARC-AGI-1) | Closest prior art: these recurse on a latent and answer for fixed-size puzzles. Rouge targets streaming token input with persistent state |
| Fixed-size state over a sequence             | RNN/LSTM; SSMs (S4, Mamba); RWKV; xLSTM; Recurrent Memory Transformer (Bulatov et al. 2022); Perceiver latents (Jaegle et al. 2021)                                                        | Rouge's state is a set of attention-mixed slots updated by a shared cell; its expressivity vs SSMs is an open question tested by `state`  |
| Limits of fixed depth / fixed state          | [Merrill, Petty, Sabharwal 2024, arXiv 2404.08819](https://arxiv.org/abs/2404.08819); [Jelassi et al. 2024, arXiv 2402.01032](https://arxiv.org/abs/2402.01032)                            | Used as predictions: P1/P2 (recurrence helps with depth), P3 (fixed state loses at recall)                                                |
| Learned memory at test time (later: I, J)    | Fast weights (Ba et al. 2016; Schlag et al. 2021); TTT layers (Sun et al. 2024); Titans, [Behrouz et al. 2025, arXiv 2501.00663](https://arxiv.org/abs/2501.00663)                         | Planned for R1.41–R1.56; not part of R1.01                                                                                                |
| Sparse conditional compute (later: C)        | MoE (Shazeer et al. 2017), Switch (Fedus et al. 2021), Mixture-of-Depths (Raposo et al. 2024)                                                                                              | Planned for R1.17–R1.24                                                                                                                   |
| Generated / structured weights (later: D, E) | HyperNetworks (Ha et al. 2016); tensor-train layers (Novikov et al. 2015); Monarch matrices (Dao et al. 2022); BitNet b1.58 (Ma et al. 2024)                                               | Planned for R1.25–R1.32; "virtual capacity" is always reported apart from physical and active parameters                                  |

The literature search is a milestone of its own (R1.05). It is repeated
before any novelty claim.

## 4. Compute model

Symbols: $P$ = parameters of one block, $L$ = layers, $T$ = tokens,
$d$ = width, $M$ = slots, $\bar N$ = mean think steps.

| Quantity                    | Transformer                                   | Rouge R1.01                                                            |
| --------------------------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| FLOPs per token (read)      | $\approx 2LP + 4LTd$ (attention grows with T) | $\approx 2(M+1)P + 4(M+1)^2 d$ (constant in T)                         |
| FLOPs per answer (thinking) | 0 (fixed depth)                               | $\bar N \cdot [2(M+1)P + 4(M+1)^2 d]$                                  |
| Inference state memory      | KV cache $2 L T d$ values, grows with T       | $M d$ values, constant                                                 |
| Parameters                  | $L \cdot P$ + embeddings                      | $P$ + embeddings (one shared cell)                                     |
| Training memory             | activations $\propto L T$                     | activations $\propto (T + N_{\max})(M+1)$ (backprop through all steps) |

**Measured on the pilot** (torch `FlopCounterMode`, ID set, forward pass):

| Model                     | Parameters | FLOPs per example |
| ------------------------- | ---------- | ----------------- |
| Transformer $d$=64, $L$=4 | 205,740    | 10.6 M            |
| Rouge $d$=128, $M$=8      | 211,373    | ~110–124 M        |

At equal parameters, Rouge costs **~11×** the compute per example, because
every token passes $M+1$ vectors through the cell. That is a real cost of
the design, not a detail. R1.01 therefore also runs a **FLOP-matched**
Transformer ($d$=192: 1.8 M parameters, 138 MFLOP per example).

**Energy proxy:** FLOPs plus bytes moved (parameters + state). Latency and
wall-clock are reported, but on CPU the Rouge loop is dominated by Python
overhead, so FLOPs are the fair compute measure.

## 5. Falsifiable predictions (pre-registered in `experiments/r1_01.json`)

| #   | Prediction                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Multi-step state, OOD (16–32 operations): Rouge ≥ Transformer + 0.20 exact match (mean of 3 seeds), and Rouge ahead in every seed |
| P2  | Variable depth, OOD (6–8 hops): Rouge ≥ Transformer + 0.10, and Rouge's think steps rise with the hop count (Spearman ρ ≥ 0.6)    |
| P3  | Recall (many facts): Transformer ≥ Rouge, ID and OOD. **Predicted loss for Rouge**                                                |
| P4  | Adaptive halting is not worse than fixed 4-step thinking, and thinking longer at test time (16 steps) does not hurt               |
| P5  | Where P1/P2 hold, Rouge also beats the **FLOP-matched** Transformer; otherwise the gain is compute, not architecture              |

**Decision rule:**

- **ADVANCE** if (P1 and P5 on the state task) or (P2 and P5 on the hops
  task).
- **FAIL** otherwise. Then the prototype is not scaled; the result is
  diagnosed and a changed prototype is registered as R1.01b.

## 6. R1.01 experiment

**Models:**

| Model               | Configuration                                                          | Parameters |
| ------------------- | ---------------------------------------------------------------------- | ---------- |
| `transformer`       | $d$=64, 4 layers, 4 heads                                              | 205,740    |
| `transformer-flops` | $d$=192, 4 layers                                                      | 1,796,780  |
| `rouge`             | $d$=128, $M$=8 slots, 4 heads, $N_{\max}$=8, $\tau$=0.01               | 211,373    |
| `rouge-fixed`       | same as `rouge`, exactly 4 think steps (ablation for adaptive halting) | 211,373    |

**Training** (identical for all models):

- 3,000 steps × 64 examples = 192,000 examples;
- AdamW, lr 1e-3, 200 warm-up steps, cosine decay, gradient clip 1.0;
- 3 seeds, 1 CPU runner per run.

**Measurements for every run:**

- parameters and checkpoint size (checkpoints are CI artifacts, never
  committed; sha256 in the result);
- state memory at 39 and 67 tokens;
- measured FLOPs per example, and for Rouge the effective FLOPs at its mean
  think steps;
- latency and wall-clock;
- learning curve (probe accuracy every 250 steps);
- exact match per task on frozen ID and OOD sets (300 per task);
- for Rouge: think steps per difficulty level, and OOD with 16 think steps.

## 7. Transformer baseline

A standard modern decoder:

- pre-LayerNorm;
- rotary position embeddings, the usual choice for length generalisation;
- causal attention and a GELU MLP (4×);
- no weight sharing.

The answer is read at the last real position. It is compared at **equal
parameters** and at **equal FLOPs**, on the same data stream and budget.

## 8. Exact dataset

`research/rouge-architecture/benchmarks/microbench.py`:

- code-generated;
- every answer verified by an independent reference solver;
- 44-token vocabulary;
- one answer token.

| Task     | What it needs              | Example                                   | ID range                          | OOD range                    |
| -------- | -------------------------- | ----------------------------------------- | --------------------------------- | ---------------------------- |
| `state`  | Multi-step state           | `<bos> 2 - 4 - 7 + 5 * 6 ? → 6` (mod 10)  | 2–12 operations                   | 16–32 operations             |
| `hops`   | Variable computation depth | `<bos> a = p ; p = 9 ; … s = i ; ? s → 2` | 1–4 hops, 3–8 variables, shuffled | 6–8 hops, up to 12 variables |
| `recall` | Long dependency / facts    | `<bos> l 3 i 3 c 9 a 5 m 7 ? m → 7`       | 2–10 pairs                        | 14–20 pairs                  |

**Data rules:**

- Training draws a fresh random stream per seed from the ID ranges only.
- The evaluation sets are frozen, with their own seed namespace.
- The ID and OOD difficulty ranges never overlap.
- Chance level is 10%.

## 9. Exact metrics

Primary metrics:

- exact match per task, on ID and on OOD;
- mean over 3 seeds, and every seed reported.

Scorecard per model:

- parameters, disk, state memory, RAM (peak RSS, includes the runtime);
- FLOPs per example (measured) and effective FLOPs (Rouge);
- latency and training wall-clock;
- sample efficiency (learning curve);
- think steps per difficulty level;
- ID versus OOD generalisation.

## 10. Hardware

| Tier                             | What it runs                                                                                                                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0: CI / CPU (used for R1.01)** | All R1.01 runs: 12 GitHub Actions jobs in parallel, free for this public repository. Models of ≤ 2M parameters, minutes to an hour each                                                                    |
| 1: iPad                          | Not a training target for R1 (see below). Useful for GGUF inference tests (llama.cpp-based apps), eval clients and viewing results                                                                         |
| 2: owner's Claude server         | Primary machine from 10M parameters on (`research/rouge-architecture/env/bootstrap.sh`, one command). A single 24–48 GB GPU, or an Apple-silicon Mac with ≥ 64 GB running MLX, covers 10M–300M experiments |
| 3: other owner hardware          | Same bootstrap                                                                                                                                                                                             |
| 4: temporary H200                | Last resort. Only with the evidence list in the owner's policy and explicit approval. Nothing in R1.01–R1.16 is expected to need it                                                                        |

**iPad, stated honestly:**

- iPadOS has no supported PyTorch or JAX training environment.
- Apple's MLX does run on iOS/iPadOS through **MLX Swift**, including
  automatic differentiation. Gradient training of these prototypes on an
  iPad is therefore possible in principle, but would need a Swift port of
  every model and a custom app.
- That is not justified at 0.2M–2M parameters, where free CI already
  answers the question.
- I cannot inspect the owner's iPad from here. If its chip and memory are
  known, a tiny MLX Swift port can be scoped as its own milestone.
