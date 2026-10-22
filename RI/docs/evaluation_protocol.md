# Evaluation Protocol

## Pre-registered for E1

- **Metrics:** Accuracy (thresholded prediction matches true success), MSE to true label, runtime.
- **Split:** One combination held out entirely; training only on remaining combinations. Multiple random seeds.
- **Baselines:** Random (0.5), Memorize (exact case frequency, 0.5 on unseen), Mean (global base rate).
- **Success criterion for supporting H1:** H1 shows higher held-out accuracy or lower MSE than all baselines across seeds, with evidence of using relational structure rather than base rate.
- **Actual result:** Not met. Status: unclear.

## General principles

- Fix metrics and splits before inspecting final numbers.
- Report all seeds.
- Distinguish interpolation from true transfer.
- Machine-readable JSON results.
