# R1.02: VOID (benchmark confound), superseded by R1.02b

**Run:** GitHub Actions run `36559698569` (commit `cffc145`), cancelled 2026-09-29 after the first job finished. No gate was evaluated. Cost: $0.

## What happened

The first finished job looked wrong:
- transformer, seed 3: **29.0% ID but 74.3% OOD**, although the OOD examples are deeper (12 and 16 hops against 1–8).

An audit of the frozen evaluation sets found the cause. The heuristic "answer with the terminal of the longest chain" never follows the query and still scores:

| depth                  | 1  | 2  | 4   | 8   | 12 (OOD) | 16 (OOD) |
| ---------------------- | -- | -- | --- | --- | -------- | -------- |
| longest-chain accuracy | 0% | 0% | 10% | 92% | 100%     | 100%     |

In `benchmarks/depthbench.py` (v1) the distractor chains share a fixed pool of 18 letters with the queried chain. When the queried chain is deep, the distractors are necessarily shorter, so depth and a non-computational cue were confounded:
- deep examples could be answered without thinking;
- the depth–compute correlation, the gate's G1, could not be interpreted.

## What changed (R1.02b, `experiments/r1_02b.json`)

**Only the benchmark changed.** `benchmarks/depthbench2.py`:
- Every example has exactly two chains of 17 nodes each, drawn from 36 symbols.
- The query sits at exactly `depth` hops from its terminal.
- Both chains always have the same length and shape, so guessing a terminal gives 50% at every depth.
- Every example is 105 tokens.

**Shortcut audit, run before any R1.02b job.** Four cheap heuristics (longest chain, first terminal, nearest terminal in the text, one-hop check) score 47–57% at every depth. `tests/test_r102.py` now fails CI if any cue reaches 62%, and keeps a test documenting v1's cue.

**Unchanged:** models, budget (15,000 steps), seeds, roles and every gate threshold.

**What was seen before re-registering:** only the one job result above, the transformer at seed 3. It motivated the audit; it did not change any threshold.

## Lesson for every later benchmark

Before the main runs, audit the benchmark for cheap cues that correlate with the variable under study. This is now part of the test suite for R1.02b.
