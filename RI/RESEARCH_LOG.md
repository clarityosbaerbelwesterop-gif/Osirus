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
