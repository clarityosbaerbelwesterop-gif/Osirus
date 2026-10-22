# E9 — Held-Out Rule Language and Relational Scene Generalization (M16)

## Overview
Evaluates whether RI can induce relational rules over variable-size object scenes (`objects = [{color, size, charge, pos}, ...]`) and generalize across four regimes:
1. **`A_compositional`:** Acquire base depth-1 skills during warm-up and generalize to unseen binary operator combinations (`XOR`, `AND_NOT`, `AND`, `OR`).
2. **`B_structural_size_transfer`:** Induce permutation-invariant relational rules on small object sets (\(N \in [3, 5]\)) and transfer zero-shot to larger object sets (\(N \in [7, 11]\)).
3. **`C1_heldout_translatable`:** Induce pairwise relational rules (`exists_pair_same_color_close_size`, `exists_directed_dominance`) held out from prior skill memory warm-up.
4. **`C2_heldout_unidentifiable`:** Out-of-grammar ternary cyclic triad parity rule whose primitive operator is absent from the hypothesis grammar, testing whether the agent flags `unidentified_high_uncertainty` (`abstained = True`) instead of fabricating a discovery.

## Commands

```bash
cd RI/experiments/E9_heldout_rule_generalization
python3 -m unittest -v
python3 evaluate.py --seeds $(seq 0 29) --train-size 10 --val-size 10 --query-pool-size 16 --test-size 36 --noise 0.05 --output results/results.json
```
