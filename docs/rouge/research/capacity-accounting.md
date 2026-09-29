# R1.30: Capacity accounting

**Status:** R1.30 (definitions). Written 2026-09-29.

**Rule:** Rouge reports three numbers and never mixes them. A generated, shared or routed possibility is never called a "parameter".

## 1. Physical capacity (what is stored)

**Definition:** P_phys = the bytes needed to store every weight, as they are stored.
- A ternary weight counts 2 bits, packed.
- A shared basis bank counts once, however many layers use it.
- A generator counts its own weights, not the weights it can produce.

Measured by `stored_bytes()` (`prototypes/structured.py`) and reported by the scorecard as "stored weight bytes". Parameter count is shown next to it, but bytes are the unit that decides the 1 / 5 / 40 GB targets.

## 2. Active capacity (what is used per token)

**Definition:** P_act = the parameters that take part in computing one token, and the FLOPs that computation executes.

- **MoE top-k of E:** everything except the E − k experts not chosen (`active_parameters()`, R1.04).
- **Mixture-of-Depths:** the router and the blocks that the token passes through, averaged over tokens.
- **Early exit or halting:** the layers or steps actually run, averaged over examples. FLOPs are charged per example (R1.21).

Active FLOPs are *executed* FLOPs. R1.22 showed that a sparse model executed densely costs 5× more than its counted FLOPs suggest. An active-capacity claim therefore needs the executed kernel, and ideally wall-clock time.

## 3. Virtual (addressable) capacity (what the model can select or generate)

This is the size of the space of distinct computations the model can select from. It is not a count of independent parameters.

| Mechanism | Addressable space | Reported as |
| --- | --- | --- |
| Top-k-of-E routing, L layers | C(E, k)^L distinct expert paths per token | log2 of that (bits of path choice), next to measured routing entropy (the paths actually used) |
| Basis bank of n matrices | a continuum of mixtures in an n-dimensional subspace per matrix | n (the subspace dimension), not n × matrix size |
| Generated low-rank delta, rank r | an r-dimensional family per input, from a generator of G weights | r and G. The generated matrix is never counted as stored weights |
| Exact memory of K slots × d | K × d numbers of *state*, written at inference | state bytes (a runtime quantity, like a KV cache), not parameters |

### Worked example: R1.04 moe-top2

8 experts, top 2, 4 layers:
- log2(C(8, 2)^4) = 4 × log2 28 ≈ 19.2 bits of path choice per token.
- Measured routing entropy was 0.71 of the maximum, so a real but lower number of paths is used.
- Physical parameters: 606k. Active parameters: 208k.
- The addressable path count must never be written as "parameters".

## 4. What a claim must contain

A capacity claim states all three, plus the measured capability at that point:

> "R1.xx: capability C at P_phys = …, P_act = … (executed FLOPs …), with addressable capacity …"

### Forbidden

- "4T parameters" for a model that stores less, whatever its addressable space.
- "Equivalent to an N-parameter model" without a measured, matched comparison at that N.
- Active FLOPs taken from a sparse model executed densely.

## 5. Where the numbers live

- `experiments/suite.py` writes these fields into every result: `params`, `params_active`, `stored_bytes`, `flops_per_example` (executed), `memory` (state and KV bytes) and routing statistics where applicable.
- `experiments/registry.json` carries them per run, as `parameter_count`, `active_parameters` and `flop_estimate`.
