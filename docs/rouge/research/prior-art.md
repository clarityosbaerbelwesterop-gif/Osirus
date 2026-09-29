# R1.05: Prior-art map for the Rouge architecture program

**Status:** R1.05 (literature map). Written 2026-09-29.

**Rule:** every Rouge mechanism is compared with what exists. "New" is claimed only for combinations or measurements that the cited work does not already report, and only once measured. Nothing in Rouge so far is a novel mechanism.

References carry arXiv ids where they exist. Each one is a pointer to check, not a summary of the paper's claims.

## 1. Architecture families

| Family | Key work | What it does | Rouge relation |
| --- | --- | --- | --- |
| **Transformer** | Vaswani et al. 2017 (1706.03762) | Attention over a growing KV cache | The baseline. Inference memory grows linearly with context |
| **Universal Transformer** | Dehghani et al. 2018 (1807.03819) | One block applied repeatedly, with per-position ACT | R1.02 looped models are UTs with per-sequence halting |
| **ACT** | Graves 2016 (1603.08983) | Halting probabilities plus a ponder cost | R1.01/R1.01b: collapses to about 1 step on our tasks |
| **PonderNet** | Banino et al. 2021 (2107.05407) | Halting distribution with a geometric prior (KL term); every step is trained | R1.02b candidate |
| **Recurrent depth** | Geiping et al. 2025 (2502.05171) | Latent iteration with input injection; test-time depth scaling | Source of R1.01b's input injection |
| **HRM / TRM** | Wang et al. 2025 (2506.21734); Jolicoeur-Martineau 2025 (2510.04871) | Small nested recurrent reasoners with deep supervision | Closest to Rouge's "think in latent state". Their deep supervision is a candidate remedy for R1.02b |
| **Looped Transformers** | Fan et al. 2024 (2409.15647) | Looping for length generalisation on algorithmic tasks | R1.02 design |
| **Linear attention / RNN view** | Katharopoulos et al. 2020 (2006.16236) | Attention as a recurrent state update | Constant-memory alternative to a KV cache |
| **SSMs** | S4 (2111.00396); Mamba (2312.00752); Mamba-2 (2405.21060) | Selective state-space recurrences, linear time | The R1.07 baseline zoo needs an SSM |
| **RWKV / RetNet** | 2305.13048; 2307.08621 | Recurrent Transformers with constant inference memory | Same memory promise as Rouge's state |
| **Hybrids (window + state)** | Griffin (2402.19427); Samba (2406.07522); Infini-attention (2404.07143) | Local attention window plus a recurrent or compressive memory | R1.11 is this family |
| **Memory-augmented Transformers** | Memorizing Transformers (2203.08913); Recurrent Memory Transformer (2207.06881) | External kNN memory; memory tokens carried across segments | R1.12 (streaming) relatives |
| **Test-time memory** | Titans (2501.00663); TTT layers (2407.04620) | Memory updated by gradient steps or learning at test time | R1.13 and R1.45 relatives |
| **Slot / latent arrays** | Perceiver IO (2107.14795); Slot Attention (2006.15055) | A fixed set of latents reads the input by cross-attention | Rouge's M×d slot state is a latent array. R1.09 (cheaper reads) moves toward the Perceiver read |
| **NTM / DNC / Memory Networks** | 1410.5401; Graves et al. 2016 (Nature); 1410.3916; 1503.08895 | Differentiable addressable memory | R1.03's exact slots with content addressing are an NTM-style memory |
| **Fast weights** | Ba et al. 2016 (1610.06258); Schlag et al. 2021 (2102.11174) | Outer-product weight updates as a working memory; linear Transformers as fast-weight programmers | Candidate R1.13 / R1.25 mechanism |
| **MoE** | Shazeer et al. 2017 (1701.06538); GShard (2006.16668); Switch (2101.03961); expert choice (2202.09368) | Sparse expert MLPs with load balancing | R1.04 is a small Switch-style MoE |
| **Mixture of Depths** | Raposo et al. 2024 (2404.02258) | Per-token skipping of blocks | R1.17 relative |
| **Early exit** | DeeBERT (2004.12993); CALM (2207.07061) | Confidence-based exits | R1.21 relative |
| **HyperNetworks** | Ha et al. 2016 (1609.09106) | One network generates another network's weights | R1.25 relative |
| **Parameter sharing / basis banks** | Savarese & Maire 2019 (1902.09701); ALBERT (1909.11942) | Layers mix a shared bank of templates | R1.27 relative |
| **Structured matrices** | Tensor-train / tensorizing nets (1509.06569); Monarch (2204.00595); KronA (2212.10650); LoRA (2106.09685) | Low-rank, Kronecker, TT and butterfly factorisations | R1.26 relative |
| **Implicit representations** | SIREN (2006.09661) | Coordinate networks representing signals | R1.28: weights as a function of (i, j), which is HyperNetwork-style |
| **Low-bit from the start** | BitNet (2310.11453); BitNet b1.58 (2402.17764) | Ternary or 1-bit weights trained natively | R1.29 relative |
| **Neural program execution** | Neural GPU (1511.08228); NPI (1511.06279); CLRS (2205.15659); DreamCoder (2006.08381) | Learned algorithm execution and program induction | R1.33–R1.34 relatives |
| **Latent reasoning** | Coconut (2412.06769) | Reasoning in continuous latent space instead of text | R1.33 relative |
| **World models** | Ha & Schmidhuber 2018 (1803.10122); DreamerV3 (2301.04104) | Learned latent dynamics for planning | R1.41+ relatives |
| **Energy-based models** | LeCun et al. 2006 tutorial; Du & Mordatch 2019 (1903.08689) | Inference as energy minimisation | Candidate for R1.35 (scoring hypotheses) |
| **Predictive coding** | Rao & Ballard 1999; Millidge et al. 2020 (2006.04182) | Local error-driven learning and inference | R1.49+ (learning rules) |
| **Forward-Forward** | Hinton 2022 (2212.13345) | Layer-local training without backpropagation | R1.52 |
| **Verifiers** | Cobbe et al. 2021 (2110.14168) | A trained verifier ranks candidate answers | R1.37 relative (text level) |
| **Active selection** | BALD (1112.5745); Bayesian experimental design | Choose the query with the largest expected information gain | R1.36 relative |

**Known limits of fixed-state models.** These papers predict R1.01/R1.03's recall result:
- Illusion of State (2404.08819);
- Repeat After Me (2402.01032);
- Zoology / associative recall (2312.04927).

## 2. Every Rouge idea against prior art

| Rouge idea (milestone) | Exists | Similar | Different in Rouge | Untested or open |
| --- | --- | --- | --- | --- |
| **Persistent slot state** (R1.01) | Latent arrays, recurrent memory tokens, SSM states | Perceiver, RMT, Mamba | One shared cell reads *and* thinks over the same slots | Measured: small repeated state-tracking gain (+3 to +6 points); recall collapses |
| **Two-level memory** (R1.03) | NTM/DNC slots, Memorizing Transformers, Titans | Small state plus addressable exact memory | Constant bytes: one hard write and top-k reads per step, no growing cache | Measured PARTIAL. Open: seed variance, slot count law (R1.10), what to store exactly (R1.13) |
| **Adaptive recurrence** (R1.02) | ACT, UT, PonderNet, recurrent depth, HRM/TRM | — | Combination with persistent memory (R1.03 lead) | R1.02b: depth ↔ steps on a cue-free task. R1.03 lead: memory makes thinking steps useful |
| **Sparse circuits** (R1.04, R1.18–R1.19) | MoE, Switch, expert choice, MoD | — | Routing on the state or task representation, not the token (R1.19) | Measured PARTIAL: specialisation without accuracy gain on a non-capacity-bound benchmark |
| **Cheaper state reads** (R1.09) | Perceiver cross-attention read, gated RNN updates, SSMs | — | Keep R1.03's memory, cut the per-token cell | Untested |
| **Window + state** (R1.11) | Griffin, Samba, Infini-attention | Directly | Rouge's addressable slots instead of a compressive memory | Untested here |
| **Streaming / forgetting** (R1.12–R1.13) | RMT, Titans (forgetting gates), LSTM forget gates | Directly | Learned store / compress / forget over exact slots | Untested |
| **Generated weights** (R1.25) | HyperNetworks, LoRA-hypernetworks | Directly | Conditioned on persistent state | Untested |
| **Structured matrices** (R1.26) | TT, Kronecker, Monarch, low rank | Directly | — | Untested (a well-mapped area: expect known trade-offs) |
| **Basis banks** (R1.27) | Template sharing (1902.09701), ALBERT | Directly | Coefficients from state per step | Untested |
| **Implicit weight fields** (R1.28) | SIREN-style coordinate networks, HyperNetworks | Partly | W(i, j, state) per step | Untested; decoding cost is the known risk |
| **Low-bit from start** (R1.29) | BitNet, BitNet b1.58 | Directly | — | Untested here |
| **Virtual capacity accounting** (R1.30) | MoE "total vs active" parameters | Partly | Formal separation: physical, active and addressable | Definitions only; no claim |
| **Latent programs** (R1.33–R1.34) | NPI, Neural GPU, Coconut, CLRS | Partly | Program state inside the recurrent slots | Untested |
| **Multiple hypotheses** (R1.35) | Multiple-choice learning, ensembles, beam search | Partly | Hypothesis slots inside one model's state | Untested |
| **Active test selection** (R1.36) | BALD / expected information gain | Conceptually | An internal computation chosen by information gain | Untested |
| **Self-verification heads** (R1.37) | Verifiers (2110.14168), calibration heads | Partly | Heads on latent state, trained on external correctness | Untested |
| **Latent search** (R1.38) | Beam search / Tree of Thoughts (text level), MCTS | Partly | Search over latent states under a FLOP budget | Untested |

## 3. What this map implies for the program

1. **Every single mechanism is prior art.**
   - A Rouge contribution can only be an *evidence-backed combination*, or a *measurement* others did not make.
   - An example of such a measurement: "useful memory makes adaptive compute worthwhile" (R1.03 lead, unconfirmed).
2. **The recall wall is predicted by theory.**
   - Fixed-size states cannot copy or recall beyond their capacity (2402.01032, 2312.04927).
   - Rouge's route is explicit exact memory with sparse access (R1.03, R1.11), not a larger state.
3. **Halting research has a known failure mode.**
   - ACT collapses to about 1 step, as R1.01/R1.01b showed.
   - The literature's remedies are: PonderNet's geometric prior, deep supervision (HRM/TRM), and curricula.
   - R1.02b tests the first. The others stay open, but the brief says not to tune ACT indefinitely.
4. **Baselines must include SSMs and hybrids** (R1.07). A "beats the Transformer" claim is not interesting if Mamba- or Griffin-style models already do.
