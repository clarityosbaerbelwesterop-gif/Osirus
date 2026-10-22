# E10 — Guarded Sub-Primitive Synthesis (M17)

## Overview
Investigates whether RI can detect when its initial M16 hypothesis grammar is insufficient, synthesize a new relational sub-primitive from a bounded formal DSL, validate it through a mandatory 6-stage lifecycle (`Candidate` → `Validation` → `Adversarial Checks` → `Quarantine` → `Promotion` → `Rollback`), and compose the newly promoted sub-primitive with existing skills on downstream tasks without falling for spurious training coincidences.

## Commands

```bash
cd RI/experiments/E10_guarded_subprimitive_synthesis
python3 -B -m unittest -v
python3 evaluate.py --seeds $(seq 0 29) --train-size 18 --val-size 14 --independent-size-val 14 --test-size 36 --output results/results.json
```
