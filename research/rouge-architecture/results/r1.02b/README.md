# R1.02b result: INCONCLUSIVE (pre-registered decision)

**Run:** GitHub Actions run `36561350422`, commit `be5686a`.
- 6 models × 3 seeds on free CPU runners, 15,000 steps × 64 examples each.
- Benchmark: `benchmarks/depthbench2.py` (cue-audited; guessing gives 50% at every depth).
- The report and statistics are in `summary.json` and `report.md`.

**Cost:** $0.

**Decision rule:** INCONCLUSIVE if no model beats the terminal-guess baseline by 20 points. It holds here: every model sits at 42–52%, against 50% for a guess.

## Scorecard (mean over 3 seeds)

| model | ID acc | OOD acc | steps (all depths) | ρ(depth, steps) | FLOPs / example | train time |
| --- | --- | --- | --- | --- | --- | --- |
| transformer (4 layers, d48) | 48.7 ± 3.7 | 49.2 ± 5.7 | 4 (fixed) | 0 | 23 M | 33 min |
| transformer-flops (8 layers, d96) | 49.8 ± 0.6 | 49.6 ± 2.7 | 8 (fixed) | 0 | 186 M | 131 min |
| loop-fixed (8 steps) | 49.9 ± 1.5 | 51.6 ± 2.6 | 8 (fixed) | 0 | 186 M | 133 min |
| loop-act | 48.5 ± 2.6 | 45.8 ± 0.1 | 2.9–3.0, flat | 0.05 | 69 M | 60 min |
| loop-act-warm | 49.0 ± 1.2 | 47.2 ± 3.5 | 3.5–3.6, flat | −0.04 | 83 M | 81 min |
| loop-ponder (candidate) | 48.2 ± 0.1 | 42.3 ± 2.6 | 4.6–5.2, flat | −0.30 | 120 M | 176 min |

## What was learned

1. **Nobody learned to follow two 17-node chains** from final-answer supervision at this budget. Transformers, fixed loops and adaptive loops are all at chance.
   - Once the length cue of R1.02 was removed, the task became much harder than the models' capacity or training signal allows.
   - That R1.02 v1 looked easier was entirely the cue.
2. **Halting did not track depth in any variant.**
   - ACT settles on a constant number of steps (about 3). Warm-up and floor only shift the constant (about 3.6).
   - PonderNet follows its geometric prior (about 5 steps).
   - Nothing correlates with required depth. When nothing is learnable, halting has no signal to adapt to.
3. **Consistent with R1.03's lead:** adaptive compute used more steps only when the steps did something useful (memory reads, R1.03). Here no step was useful.
4. **Per the owner's rule, ACT is not tuned further.**
   - Adaptive compute returns in R1.17 (per-token depth), R1.20 (a depth knob trained with random depth) and R1.21 (early exit), on tasks that models can learn.
   - It also returns in R1.34, where latent steps are aligned with program steps.

## Open

A learnable version of depth control needs either a curriculum over depth or step supervision (CLRS hints, deep supervision as in HRM/TRM). R1.34 tests the step-supervision route on program execution.
