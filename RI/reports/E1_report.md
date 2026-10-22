# E1 Report — First Experimental Cycle

**Date:** 2026-10-22  
**Status:** Executed  
**Outcome:** Unclear (H1 not supported)

## What was tested
Minimal adaptive relationship tracker vs random / memorize / global-mean baselines in a binary causal world with one held-out combination.

## Results
See `experiments/E1_relationship_learning/results/e1_results.json`.

- H1 mean held-out accuracy: ~0.33
- Memorize and mean: 1.0 (largely because the held-out case was a failure case and defaults matched the base rate or 0.5-threshold behavior)

## Interpretation
The candidate’s current selection of relations did not discover and apply the conjunctive rule in a way that improved transfer. The environment allows base-rate strategies to appear successful on the particular held-out instances chosen. This is a documented limitation, not a success.

## Resource use
CPU only. Runtime < 0.01 s total. No GPU required.

## Next steps
Redesign the world so that correct prediction of the held-out case requires the specific interaction (e.g., hold out a success case, or add more features). Strengthen the revision mechanism.
