# E8 — Bounded Rule-Family Selection (M9)

## Purpose
Evaluate whether an explicit hypothesis-search learner can select between two distinct rule families (`sum_threshold` with integer threshold \(t \in [0, 14]\) and `parity` where \((x + y) \bmod 2 = 0\)) from labeled 8×8 grid examples and generalize to disjoint held-out coordinates.

## Baselines
- `MajorityBaseline`: predicts the most frequent training label (tie-break toward `0`).
- `FixedThresholdBaseline`: predicts `sum_threshold` with fixed midpoint threshold `t = 7`.
- `RandomHypothesisBaseline`: deterministically seeded baseline that samples uniformly between the two rule families and, for `sum_threshold`, a threshold in `[4, 10]`.

## Reported Metrics
- `rule_family_selection_rate`: fraction of seeds where `selected_family == true_family` (reported overall and per true family).
- `exact_rule_recovery_rate`: fraction of seeds where both the rule family and exact threshold (for `sum_threshold`) match ground truth.
- `mean_held_out_accuracy`: accuracy on disjoint held-out points (`test_size = 24` after `train_size = 16`).
- `family_tie_rate` and `threshold_tie_rate`: fraction of episodes where minimum training error is shared across families or across multiple thresholds.

## Limitations
- The candidate hypothesis set is explicitly hand-coded (15 threshold rules + 1 parity rule). This is bounded hypothesis selection, not open-ended rule discovery.
- Tie-breaking favors `sum_threshold` and lower thresholds when small training sets leave multiple candidates with equal training error.
