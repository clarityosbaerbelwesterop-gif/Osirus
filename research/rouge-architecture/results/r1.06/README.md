# R1.06 result: PASS (benchmark v3 with an automatic shortcut audit)

**Files:**
- `benchmarks/suite3.py`: eleven tasks, each testing one capability, with a reference solver for every generator.
- `benchmarks/audit.py`: the automatic shortcut audit.
- `tests/test_suite3.py`: tests over both.

**Splits:**
- train: an open stream;
- dev: frozen, in-distribution;
- holdout: fresh for every experiment (seeded by the experiment id), so the hidden test rotates;
- ood: frozen, harder levels;
- adversarial: in-distribution examples on which the cue model is wrong.

## Audit

The audit measures three cheap cues on 3,000 training and 500 evaluation examples per task: majority answer, answer at a fixed position, and a bag-of-tokens naive Bayes model with a length feature. It flags a task when the best cue beats chance by more than 15 points. The tests fail on any unexplained flag.

| task | chance (dev / ood) | majority | position | bag of tokens | cue floor (dev / ood) |
|---|---|---|---|---|---|
| state | 0.10 / 0.10 | 0.14 | 0.13 | 0.12 | 0.14 / 0.14 |
| recall | 0.26 / 0.12 | 0.09 | 0.27 | 0.32 | 0.32 / 0.25 |
| hops | 0.50 / 0.50 | 0.10 | 0.17 | 0.53 | 0.53 / 0.51 |
| perm | 0.20 / 0.20 | 0.21 | 0.20 | 0.18 | 0.21 / 0.20 |
| conn | 0.50 / 0.50 | 0.49 | 0.00 | 0.48 | 0.49 / 0.52 |
| arith | 0.10 / 0.10 | 0.10 | 0.11 | 0.08 | 0.11 / 0.10 |
| binding | 0.20 / 0.14 | 0.09 | 0.18 | 0.27 | 0.27 / 0.23 |
| stack | 0.14 / 0.07 | 0.04 | 0.30 | 0.14 | 0.30 / 0.32 |
| trace | 0.10 / 0.10 | 0.12 | 0.14 | 0.19 | 0.19 / 0.18 |
| cf | 0.10 / 0.10 | 0.15 | 0.12 | 0.11 | 0.15 / 0.15 |
| plan | 0.29 / 0.31 | 0.03 | 0.13 | 0.20 | 0.20 / 0.10 |

## Found and fixed while building it

Each fix happened before any model trained on this benchmark.

1. **binding:** the last statement often assigned the queried variable, a recency cue worth 46%. Now all four variables are assigned first and the query is uniform. The copy rate was lowered to 0.4 to damp a value-popularity cue.
2. **trace:** a variable the loop never changes answered with its initial value (31%). Now the queried variable is always one the loop changes.
3. **plan:** a leaf start node made the first step trivial, with a chance level of 72%. Now the start node always has degree ≥ 3.
4. **sortk (sorting):** the task is order-invariant by definition, so a bag of tokens partly solves it (49%). It was replaced by a stack machine, which depends on order.
5. **stack:** a fixed-position cue scored 62%. Trailing push and pop runs now vary its position, which brings it down to 30%.
   - That remainder is recency, and recency is part of stack semantics.
   - It is kept as a documented floor (`KNOWN_FLOORS`).
   - Results report accuracy above each task's cue floor.

**Chance levels** are defined as "uniform over plausible answers":
- recall and binding: the digits present in the context;
- stack: the letters present;
- plan: 1 / degree of the start node.

Cost: $0.
