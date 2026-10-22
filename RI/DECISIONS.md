# DECISIONS

## D1 — CPU-first, no paid resources
**Date:** 2026-10-22  
**Decision:** All initial experiments run on available CPU. No GPU instances, paid APIs, or cloud training without explicit approval.  
**Rationale:** Prompt mandate; measured E1 runtime negligible.

## D2 — Minimal viable experiment before larger systems
**Date:** 2026-10-22  
**Decision:** Implement smallest H1 candidate and simple discrete world before any neural or large-scale approach.  
**Rationale:** Falsifiability first. Large models would violate the "do not presuppose finished model" rule.

## D3 — Honest negative/unclear result reporting
**Date:** 2026-10-22  
**Decision:** Document E1 as not supporting H1 in current form rather than adjusting until it "succeeds".  
**Rationale:** Scientific integrity. A clean failure is more valuable than an ungrounded success claim.

## D4 — Bounded allow-listed execution and config-only self-improvement (M10–M12)
**Date:** 2026-10-22  
**Decision:** Restrict prototype execution (`SandboxExecutor`) to a finite allow-list of 6 discrete grid operations with step and timeout budgets, and restrict self-improvement (`GuardedSelfImprover`) to allow-listed `PrototypeConfig` hyperparameters gated by a 0-drop regression suite and disjoint held-out tasks.  
**Rationale:** Prevents uncontrolled code execution or unverified self-modification while enabling reproducible, measurable evaluation of counterexample refinement and skill composition.
