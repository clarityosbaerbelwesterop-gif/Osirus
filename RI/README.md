# RI — Reasoning Intelligence

Research prototype exploring explicit reusable operations, composition, autonomous task selection, continual memory, bounded rule-family discovery, and guarded self-improvement.

## Current branch
`ri/isolated-foundation` — all RI work lives under `RI/` plus `.github/workflows/ri-validation.yml`.

## Implemented Milestones
- **M0–M2 / E1:** initial relationship-learning experiment (negative/unclear result preserved).
- **M3 / E2:** operational intervention strategy with random and fixed baselines.
- **M4 / E3:** two-stage prerequisite task and probe/verify composition with equal query budgets.
- **M5 / E4:** heuristic task selection compared with random, fixed, and error-only curricula.
- **M6 / E5:** explicit continual memory and a reset-memory ablation.
- **M7 / E6:** bounded, allow-listed configuration proposals with a paired-seed promotion gate.
- **M8 / E7:** held-out concept learning (`ThresholdRuleLearner` vs `NearestNeighbour` and `MajorityBaseline`).
- **M9 / E8:** bounded rule-family discovery (`sum_threshold` vs `parity`) with tie diagnostics and `MajorityBaseline`, `FixedThresholdBaseline`, and `RandomHypothesisBaseline`.
- **M10 (`RI/prototype/`):** integrated 10-step end-to-end reasoning prototype (`TaskSpec` → `TaskAnalyzer` → `CandidateGenerator` → `CandidateSelector` → `SkillMemory` → `SandboxExecutor` → `TaskEvaluator` → `BoundedLearningLoop` → `TaskRunReport`).
- **M11 (`RI/prototype/memory.py`, `transfer.py`):** versioned `SkillMemory` with `IOContract` compatibility checking, compositional transfer (`composed_and`), quarantine isolation of failing skills, rollback, and 4-family continual learning retention tests.
- **M12 (`RI/prototype/self_improvement.py`):** `GuardedSelfImprover` with locked baseline config, regression gate, disjoint held-out minimum-gain gate, and automatic rollback.

## Quickstart Commands

Run the end-to-end prototype walkthrough from the repository root:

```bash
python3 RI/run_prototype.py
```

Run the full 30-seed M10–M12 prototype benchmark:

```bash
python3 RI/run_prototype.py --mode benchmark
```

Run the complete RI test and evaluation suite (`E2`–`E8` + `RI/tests` + `M10`–`M12` prototype):

```bash
python3 RI/run_experiments.py
```

## Documentation Index
- `RI/ROADMAP.md` — milestone status, dependencies, and acceptance gates.
- `RI/ARCHITECTURE.md` — module design, 10-step data flow, and safety boundaries.
- `RI/PROTOTYPE_QUICKSTART.md` — installation, single-command start, and example walkthrough.
- `RI/TESTING.md` — unit/integration/negative test suites, metrics, and CI workflow.
- `RI/RESULTS.md` — measured results, baseline comparisons, commit provenance, and limitations.
- `RI/prompts/` — verification and review prompts (`M9_TEST_AND_WORKFLOW_PROMPTS.md`, `M10_M12_PROTOTYPE_PROMPTS.md`).

## Scientific Status and Limits
All experiments (`E1`–`E8`) and the M10–M12 prototype operate on bounded, synthetic discrete task families. They validate software mechanics, explicit hypothesis selection, compositional skill reuse, and guarded promotion gates on CPU—they do **not** establish open-ended rule invention or general intelligence.
