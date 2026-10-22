# E11 — Active Disambiguation & Experimental Intervention (M18)

## Overview
Investigates whether RI can resolve ambiguity among multiple competing hypotheses that fit all passive training examples by selecting informative experimental scene interventions (`expected_information_gain`), handling controlled observation noise via multi-step corroboration, recognizing semantically equivalent syntax forms (`SemanticEquivalenceChecker`), abstaining without wasting budget when no distinguishing intervention exists in the search space, and enforcing the full M17 6-stage validation, adversarial, quarantine, promotion, and rollback lifecycle.

## Commands

```bash
cd RI/experiments/E11_active_disambiguation
python3 -B -m unittest -v
python3 evaluate.py --seeds $(seq 0 29) --train-size 16 --val-size 14 --independent-size-val 14 --test-size 36 --intervention-budget 3 --output results/results.json
```
