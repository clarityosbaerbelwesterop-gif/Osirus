# PROTOTYPE QUICKSTART — RI (M10–M12)

## 1. Prerequisites and Installation

The RI prototype uses only the Python 3.12 standard library. No external packages, GPUs, or paid APIs are required.

Verify your Python version from the repository root:

```bash
python3 --version
```

## 2. Single-Command Start (End-to-End Demo)

Run the 5-task end-to-end prototype walkthrough from the repository root:

```bash
python3 RI/run_prototype.py
```

### What the Demo Executes

1. **`demo_1_acquire_sum_threshold` (`sum_threshold`, \(t=6\)):** Infers `cand_sum_ge_6` on 20 development examples, verifies `1.0` accuracy on 24 disjoint held-out examples, and registers `skill_sum_threshold_threshold6@v1` in `SkillMemory`.
2. **`demo_2_acquire_parity` (`parity`, \(p=0\)):** Infers `cand_parity_0`, verifies `1.0` held-out accuracy, and registers `skill_parity_parity0@v1` in `SkillMemory`.
3. **`demo_3_reuse_sum_threshold` (`sum_threshold`, \(t=6\)):** Queries `SkillMemory`, directly reuses `skill_sum_threshold_threshold6@v1` (`reused_skill = true`), and achieves `1.0` held-out accuracy on a new coordinate split.
4. **`demo_4_compose_sum_and_parity` (`composed_and`, \(t=6 \land p=0\)):** Verifies `IOContract` compatibility between `skill_sum_threshold_threshold6@v1` and `skill_parity_parity0@v1`, composes them into `composed(skill_sum_threshold_threshold6@v1,skill_parity_parity0@v1)` (`composed_skill = true`), and achieves `1.0` held-out accuracy.
5. **`demo_5_learning_loop_mod_sum` (`mod_sum`, \(\text{mod}=3, \text{rem}=1\)):** Initial single-primitive search leaves development counterexamples (`train_accuracy = 0.75 < 0.90`); Step 9 (`BoundedLearningLoop`) triggers, expands the candidate space to `mod_sum`, selects `cand_mod_3_rem_1`, and achieves `1.0` held-out accuracy.
6. **`m13_active_query_demo` (M13 Active Boundary Querying):** Starts with an 8-example sample where 2 thresholds tie (`initial_version_space_size = 2`), queries 1 maximally informative boundary point (`queries_used = 1`), resolves the tie (`final_version_space_size = 1`), and achieves `1.0` held-out accuracy.
7. **`m14_compositional_language_demo` (M14 Multi-Operator Composition):** Synthesizes 15 `AND`/`OR`/`XOR`/`AND_NOT` combinations from verified skills in `SkillMemory`, selects `composed_XOR(skill_sum_threshold_threshold6@v1,skill_parity_parity0@v1)`, and achieves `1.0` held-out accuracy.
8. **`m15_drift_and_noise_demo` (M15 Continual Drift & Noise Stream):** Runs a 5-phase stream showing initial acquisition, retention under 15% label noise, adaptation to abrupt concept drift, rejection of a 40% corrupted batch shock, and recovery (`1.0` stream accuracy vs `0.9333` for `naive_overwrite` and `0.8250` for `static_frozen`).

### Expected CLI Output

```json
{
  "mode": "demo",
  "n_tasks": 5,
  "success_rate": 1.0,
  "mean_held_out_accuracy": 1,
  "mean_runtime_ms": 1.01,
  "skills_reused_count": 2,
  "skills_composed_count": 1,
  "learning_loop_triggered_count": 1,
  "baseline_mean_held_out_accuracy": {
    "majority": 0.62502,
    "fixed_rule": 0.675,
    "random": 0.45832
  },
  "limitations": [
    "Operate over bounded discrete 8x8 grid rule families; not a general intelligence system.",
    "All candidate actions are restricted to an explicit allow-list with step and timeout bounds."
  ]
}
```

### Generated JSON Artifacts

- `RI/results/prototype_demo_report.json`: full 10-step trace for all 5 demo tasks.
- `RI/results/prototype_skill_memory.json`: persisted versioned skills, unit tests, and usage counters.

## 3. Run the 30-Seed M10–M12 Benchmark

```bash
python3 RI/run_prototype.py --mode benchmark
```

This runs 30 seeds across M10 (end-to-end 6-family benchmark), M11 (skill reuse, compositional transfer, and 4-family continual learning retention), and M12 (guarded self-improvement promotion gate), writing the full output to `RI/results/prototype_benchmark.json`.

## 4. Run the Complete RI Validation Suite (E2–E8 + Prototype)

```bash
python3 RI/run_experiments.py
```
