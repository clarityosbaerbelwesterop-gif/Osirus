# E1 — Relationship Learning and Transfer

## Goal
Test whether a minimal H1 candidate (conditional relationship tracking and revision) can form predictive relationships and transfer to a held-out combination better than simple baselines.

## Setup
- Binary properties: color ∈ {0,1}, size ∈ {0,1}
- Hidden rule: success iff color==1 AND size==0 (10% observation noise)
- Irrelevant noise attribute present
- Train on 3 combinations, test on 1 held-out

## Components
- `environment.py` — SimulatedWorld
- `baselines.py` — Random, Memorize, Mean
- `candidate.py` — H1Candidate
- `evaluate.py` — runs multi-seed experiment, writes `results/e1_results.json`

## Result (executed 2026-10-22)
H1 did not outperform baselines on held-out accuracy in this world. See results and RESEARCH_LOG.md. Status: executed, outcome unclear / not supportive of H1 in current form.

## Reproduction
```bash
cd RI/experiments/E1_relationship_learning
python evaluate.py
```
