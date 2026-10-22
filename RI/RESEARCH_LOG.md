# RESEARCH LOG

## 2026-10-22 — First Cycle Start

- Verified repository `clarityosbaerbelwesterop-gif/Osirus`
- Active branch: `ri/isolated-foundation` (SHA `0a96b44ab14f548682c7a12703708e0db57beb46`)
- Existing files: RI/README.md, RI/MASTER_PROMPT_GEMINI_4_ARGON.md
- Working tree clean on remote; local implementation in sandbox then pushed.

### Actions
- Created research infrastructure documents
- Implemented E1 environment, baselines (random, memorize, mean), H1 candidate, evaluator
- Executed experiment with 3 seeds, held-out combination for transfer
- Runtime: ~0.002 s per run (CPU only)
- Result: H1 mean held-out accuracy ~0.33 vs memorize/mean ~1.0 in this setup (due to base-rate matching on failure cases). Status: unclear / not supported.

### Limitations
- Environment too simple; all non-held-out combinations provide enough signal that base-rate or default-0.5 often correct for the held-out failure case.
- No GPU used or needed.
- Literature review based on established knowledge; full paper access not exhaustively re-fetched in this session.

### Next milestone
M3 — improve abstraction/transfer test and candidate mechanism.

## 2026-10-22 — M9 Validation and M10–M12 Prototype Completion

- Audited `ri/isolated-foundation` starting from commit `1e0383d9de8ec09e3d2737edfd11d9c83c849ca2` (which followed `74cad03b1e6e03657ba057e3fe9d70002b9f7d12`).
- Completed **M9 (`E8_rule_discovery`)**: added idempotent `RuleWorld.all_examples()`, strict input validation, explicit tie/underdetermination diagnostics (`family_tie`, `threshold_tie`), and three baselines (`MajorityBaseline`, `FixedThresholdBaseline`, `RandomHypothesisBaseline`). Executed 30 seeds: `rule_family_selection_rate = 1.0000`, `exact_rule_recovery_rate = 0.8667`, `mean_held_out_accuracy = 0.9833` vs `0.5611` (majority), `0.6667` (fixed threshold), and `0.7250` (random hypothesis).
- Hardened central runner `RI/run_experiments.py` with artifact JSON + secret validation, consolidated summary output (`RI/results/experiment_suite_summary.json`), and unit tests (`RI/tests/test_runner.py`).
- Implemented **M10 (`RI/prototype/`)**: 10-step modular end-to-end reasoning pipeline (`TaskSpec` -> `TaskAnalyzer` -> `CandidateGenerator` -> `CandidateSelector` -> `SkillMemory` -> `SandboxExecutor` -> `TaskEvaluator` -> `BoundedLearningLoop` -> `TaskRunReport`) and single-command CLI `RI/run_prototype.py`.
- Implemented **M11 (`RI/prototype/memory.py`, `transfer.py`)**: versioned skills with `IOContract` compatibility checks, unit-test activation gate, quarantine isolation of failing skills, rollback, compositional transfer (`0.9806` vs `0.7653` single-primitive without memory), and 4-family continual learning retention (`0.9688` vs `0.6698` reset ablation).
- Implemented **M12 (`RI/prototype/self_improvement.py`)**: `GuardedSelfImprover` with locked baseline config (`v1`), regression gate (`regression_drop = 0.0000`), disjoint 30-seed held-out gate (`+0.0847 >= 0.0500` paired gain), and verified rollback on non-improving candidates.
- Implemented **M13 (`RI/prototype/active_query.py`)**: `ActiveBoundaryQuerier` resolves version-space ties by querying high-disagreement boundary coordinates from a disjoint unlabeled pool. Across 30 seeds (`initial_train_size=10`, `budget=3`), `active_disagreement` resolved `88.24%` of initial ties using `1.03` queries on average and reached `1.0000` held-out accuracy / `1.0000` exact rule recovery (vs `0.9306` / `0.6333` for `random_query` and `0.9292` / `0.5667` for `passive_no_query`).
- Implemented **M14 (`RI/prototype/compositional_language.py`)**: `CompositionalSkillSynthesizer` over `AND`, `OR`, `XOR`, and `AND_NOT` combinators. Demonstrated that composing verified skills from `SkillMemory` compresses candidate search by `806.18x` (`6.8` vs `5,482` candidates) and reduces the small-sample (`train_size=14`) overfitting gap from `0.1403` (`unconstrained_depth2_enumeration`: `0.8597` held-out) to `0.0099` (`memory_guided_composition`: `0.9806` held-out).
- Implemented **M15 (`RI/prototype/drift_and_noise.py`)**: `DriftAndNoiseController` evaluated across a 5-phase continual stream (clean acquisition, 15% noisy stationary batch, abrupt drift, 40% corrupted batch shock, and recurring regime) and a `0%`–`20%` label noise sensitivity curve. Achieved `0.9597` mean stream accuracy vs `0.9094` (`naive_overwrite`) and `0.8286` (`static_frozen`), reactivating superseded `v1` on `23/30` seeds when returning to Regime A.
- Implemented **M16 (`RI/experiments/E9_heldout_rule_generalization/`, `RI/docs/M16_HELDOUT_GENERALIZATION.md`)**: New experiment family testing relational rule induction over variable-size object scenes (\(N \in [3, 11]\)) across compositional (`A`), structural size-transfer (`B`), held-out pairwise relational (`C1`), and unidentifiable out-of-grammar (`C2`) regimes. Compared `ri_full` against 6 baselines and 4 ablations across 30 seeds (120 tasks): `ri_full` achieved `0.9938 ± 0.0055` held-out accuracy and `0.9222 ± 0.0556` exact rule recovery on identifiable regimes (`A, B, C1`), `0.0009` size-transfer drop from \(N \in [3, 5]\) to \(N \in [9, 11]\), and `96.67%` (`29/30`) abstention/detection on out-of-grammar `C2` rules. Also documented failure/overhead modes where M13 degrades under a corrupted query oracle (`-0.0917` without M15 guard) and M14 adds search overhead (`+7.67` candidates) when stored skills are irrelevant.
