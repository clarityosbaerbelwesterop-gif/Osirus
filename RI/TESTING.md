# TESTING — RI Test Strategy, CI Workflows, and Metric Definitions

## 1. Local Test Commands

### Run the Complete RI Suite (Experiments E2–E8 + Top-Level & Prototype Tests + Benchmarks)
From the repository root:

```bash
python3 RI/run_experiments.py
```

### Run Only Unit and Integration Tests (Fast Mode)

```bash
python3 RI/run_experiments.py --tests-only
```

### Run M9 (`E8_rule_discovery`) Independently

```bash
cd RI/experiments/E8_rule_discovery
python3 -m unittest -v
python3 evaluate.py --seeds $(seq 0 29) --train-size 16 --test-size 24 --output results/results.json
```

### Run Prototype Unit, Integration, Transfer, and Self-Improvement Tests

```bash
python3 -m unittest discover -s RI/tests -p "test_*.py" -v
```

## 2. Test Categories Covered

1. **Unit Tests:**
   - Environment determinism, idempotence, and coordinate/parameter validation (`E2`–`E8`, `RI/tests/test_environment.py`, `RI/tests/test_prototype.py`).
   - Candidate generation, tie-breaking diagnostics (`family_tie`, `threshold_tie`), and baseline determinism.
2. **Integration Tests:**
   - Full 10-step `RIPrototypeOrchestrator.run_task()` execution from `TaskSpec` to `TaskRunReport` (`TestM10PrototypeEndToEnd`).
   - Counterexample-driven refinement via `BoundedLearningLoop`.
3. **Skill Memory, Transfer, and Continual Learning Tests (`TestM11SkillMemoryAndTransfer`):**
   - Versioned skill registration (`v1`, `v2`), JSON persistence/reload, unit-test verification gate, and `rollback_skill()`.
   - Quarantine isolation of failing skills (`status == "quarantined"` excluded from reuse).
   - Compositional transfer (`compose_skills`) with `IOContract` compatibility verification.
   - Continual retention vs reset-memory ablation across 4 sequential task families.
4. **Guarded Self-Improvement Tests (`TestM12GuardedSelfImprovement`):**
   - Allow-listed `PrototypeConfig` validation, regression suite gate (`regression_drop == 0.0`), paired held-out minimum gain gate (`minimum_gain = 0.05`), and automatic rollback when a candidate fails the gate.
5. **Negative & Safety Tests (`RI/tests/test_runner.py`, `RI/tests/test_prototype.py`):**
   - Disjoint split enforcement (overlapping train/test points rejected).
   - Sandbox execution enforcement (`error_disallowed_action`, `error_step_limit`, `error_timeout`).
   - Runner failure propagation (missing directory, failing unit test, failing evaluation script, or leaked secret pattern in JSON artifact all cause `RI/run_experiments.py` to exit with code `1`).

## 3. Metric Definitions

- **Held-Out Accuracy (`held_out_accuracy`):**
  \[\text{Accuracy}_{\text{test}} = \frac{1}{|D_{\text{test}}|} \sum_{(x, y, y^*) \in D_{\text{test}}} \mathbb{I}(\hat{y}(x, y) = y^*)\]
  where \(D_{\text{test}} \cap D_{\text{train}} = \emptyset\).
- **Rule-Family Selection Rate (`rule_family_selection_rate` in E8):**
  Fraction of seeds where `selected_family == true_family`.
- **Exact Rule Recovery Rate (`exact_rule_recovery_rate` in E8):**
  Fraction of seeds where both the family and the exact threshold (for `sum_threshold`) match ground truth.
- **Task Pass Rate (`task_pass_rate` in M10/M12):**
  Fraction of tasks meeting all `SuccessCriteria` (`train_accuracy >= min_train_accuracy`, `held_out_accuracy >= min_held_out_accuracy`, disjoint split, and runtime within `max_runtime_ms`).
- **Continual Forgetting Rate (`forgetting_rate` in M11):**
  \(\max(0, \overline{\text{Acc}}_{\text{initial}} - \overline{\text{Acc}}_{\text{post-sequence}})\) evaluated across all 4 sequential task families.
- **Paired Held-Out Gain (`mean_paired_gain` in E6/M12):**
  Mean per-seed difference \(\frac{1}{N}\sum_{i=1}^N (\text{Acc}_{\text{candidate}}(s_i) - \text{Acc}_{\text{baseline}}(s_i))\) on identical held-out tasks.

## 4. CI Workflow (`.github/workflows/ri-validation.yml`)

- Triggered on pushes to `ri/isolated-foundation` touching `RI/**` or `.github/workflows/ri-validation.yml`, pull requests touching those paths, and `workflow_dispatch`.
- Runs on `ubuntu-latest` with Python `3.12`.
- Executes `python RI/run_experiments.py`, which runs all unit tests and 30-seed evaluations for `E2`–`E8`, all top-level tests in `RI/tests/`, and `RI/run_prototype.py --mode all`.
- Uploads all `RI/experiments/**/results/results.json` and `RI/results/*.json` artifacts with `if: always()` so partial artifacts remain inspectable even if a later step fails.
