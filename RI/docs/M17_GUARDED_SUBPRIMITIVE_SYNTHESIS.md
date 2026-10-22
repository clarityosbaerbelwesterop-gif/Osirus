# M17 — Guarded Sub-Primitive Synthesis (`E10`)

## 1. Research Question

**Central Question:** Can RI detect when its existing bounded hypothesis grammar (from M16) is insufficient to solve a relational task, synthesize a new primitive relation from a formal relational DSL, validate that candidate through a multi-stage admission gate (`Candidate` → `Validation` → `Adversarial Checks` → `Quarantine` → `Promotion` → `Rollback`), and compose the promoted sub-primitive with existing verified skills on downstream tasks—without leaking test labels or promoting spurious/ambiguous rules into active `SkillMemory`?

---

## 2. Formal Relational Sub-Primitive DSL and Task Families

### 2.1 Initial M16 Base Grammar vs. M17 Sub-Primitive DSL
The agent starts with the 6 core M16 unary/global scene primitives (`exists_color_size_ge`, `all_size_ge`, `charge_ratio_ge`, `parity_sum_charge`, `argmax_size_has_charge`, `argmax_size_has_color`) and binary combinators (`AND`, `OR`, `XOR`, `AND_NOT`).

When the best candidate in the active grammar falls below the pre-registered validation threshold (`min_val_accuracy = 0.85`), `SubPrimitiveSynthesizer` enumerates up to `max_dsl_candidates = 48` depth-1 relational sub-primitive templates from a formal, statically typed DSL (`eval_subprimitive_dsl` in `RI/experiments/E10_guarded_subprimitive_synthesis/environment.py`):

1. **`pair_color_size_delta(c1, c2, delta)`:**
   \[\exists i \ne j: o_i.\text{color} = c_1 \land o_j.\text{color} = c_2 \land (o_j.\text{size} - o_i.\text{size}) = \Delta\]
2. **`pair_proximal_dipole(color, max_gap)`:**
   \[\exists i < j: o_i.\text{color} = o_j.\text{color} = c \land o_i.\text{charge} \ne o_j.\text{charge} \land |o_i.\text{pos} - o_j.\text{pos}| \le g\]
3. **`triad_monotone_size_distinct_color(charge)`:**
   \[\exists (o_0, o_1, o_2) \in C_0 \times C_1 \times C_2: o_0.\text{charge} = q \land o_0.\text{size} < o_1.\text{size} < o_2.\text{size}\]
4. **`forall_color_charged(color, charge)`:**
   \[\left(\exists o \in S: o.\text{color} = c\right) \land \left(\forall o \in S: o.\text{color} = c \implies o.\text{charge} = q\right)\]
5. **Spurious / Non-Invariant Shortcut Templates in Raw Search Space** (included to test adversarial filtering):
   - `spurious_slot0_charge(charge)`: \(o_0.\text{charge} = q\) (depends on array index `0`; violates permutation invariance).
   - `spurious_exact_count_and_color(max_count, color)`: \(|S| \le m \land \exists o \in S: o.\text{color} = c \land o.\text{charge} = 1\) (collapses to `0` on larger scenes \(|S| \ge 7\)).

Canonical deduplication (`truth_table_signature` over 36 fixed unlabeled probe scenes `CANONICAL_PROBE_SCENES`) reduces the 48 raw DSL templates to `33` functionally distinct candidates.

### 2.2 Three Task Families (`RI/experiments/E10_guarded_subprimitive_synthesis/environment.py`)
For each seed \(s \in \{0, \dots, 29\}\), `SubPrimitiveSynthesisWorld(s).generate_bundle()` generates:
- **Locked M16 Regression Suite (`3` tasks):** Core M16 tasks whose baseline held-out accuracy is locked before any M17 task runs.
- **Base Skill Warm-Up (`2` tasks):** Acquires verified M16 base skills (`parity_sum_charge`, `exists_color_size_ge`) into `GuardedSkillLibrary`.
- **Family A (`A_primitive_synthesis`):** Target rule is one of the missing relational sub-primitives (`pair_color_size_delta`, `pair_proximal_dipole`, `triad_monotone_size_distinct_color`). Splits: `train_size = 18` (\(N \in [4, 6]\)), `val_size = 14` (\(N \in [4, 6]\)), `independent_size_val = 14` (\(N \in [7, 10]\)), `test_size = 36` (\(18\) scenes with \(N \in [4, 6]\) and \(18\) large scenes with \(N \in [8, 11]\)).
- **Family B (`B_composition_with_synthesized`):** Target rule combines the Family A sub-primitive with a verified M16 base skill via `AND`, `XOR`, `OR`, or `AND_NOT`. Tests whether a promoted sub-primitive in `GuardedSkillLibrary` can be composed with existing skills.
- **Family C (`C_spurious_and_noisy_traps`):** Three adversarial trap types (`seed % 3`):
  - *Trap 0 (`spurious_positional_shortcut`):* `spurious_slot0_charge(charge=1)` fits `train_examples` and `val_examples` at `100%`, while unordered scene multisets are identical across labels (`0` vs `1`). Must be rejected by Stage 3 permutation invariance auditing.
  - *Trap 1 (`confounded_ambiguous_twin`):* `forall_color_charged(color=1, charge=1)` and `forall_color_charged(color=2, charge=1)` both achieve `100%` on `train_examples`, `val_examples`, and `independent_size_val_examples`. Must be quarantined by Stage 3 alternative ambiguity checking (`n_surviving_alternatives == 2 > 1`).
  - *Trap 2 (`corrupted_training_overfit`):* `forall_color_charged(color=0, charge=1)` fits `train_examples` at `100%` and passes structural invariance, but fails on the independent validation split (`val_accuracy < 0.85`). Must be rejected by Stage 2 validation guarding.

---

## 3. Mandatory 6-Stage Admission Pipeline and Pre-Registered Gate

Implemented in `GuardedSkillLibrary` and `M17GuardedSynthesizerAgent` (`RI/experiments/E10_guarded_subprimitive_synthesis/agent.py`):

1. **Stage 1 — `Candidate`:** Synthesized sub-primitive is created as an inactive `SubPrimitiveLifecycleRecord` (`stage = "candidate"`, `active = False`) in `staging_candidates`. `active_skills` and `library.version` remain untouched.
2. **Stage 2 — `Validation`:** Candidate is evaluated on disjoint `val_examples` (\(N \in [4, 6]\)) and `independent_size_val_examples` (\(N \in [7, 10]\)). Requires:
   - `train_accuracy >= 0.90`
   - `val_accuracy >= 0.85`
   - `independent_size_val_accuracy >= 0.85`
   - `gain_over_base_grammar >= 0.12`
3. **Stage 3 — `Adversarial Checks`:**
   - `check_permutation_invariance`: Shuffles object order 3 times across all 36 canonical probe scenes; requires `100%` invariance.
   - `check_large_size_support`: Verifies non-constant support on large probe scenes (\(N \ge 7\)).
   - `n_surviving_alternatives <= 1`: Counts functionally distinct invariant candidates tied at the top empirical score across `train + val + ind_size_val`; if `> 1`, flags ambiguity.
   - `compute_regression_drop <= 0.0`: Evaluates the locked M16 regression suite with the candidate added to ensure zero degradation on prior skills.
4. **Stage 4 — `Quarantine`:** Any candidate failing Stage 2 or Stage 3 is isolated in `quarantined_records` (`stage = "quarantined"`, `active = False`) with explicit rejection reasons, and the agent falls back to the best verified base grammar rule.
5. **Stage 5 — `Promotion`:** Candidates passing all gates are snapshotted, verified against unit tests, and promoted into `active_skills` with incremented `library.version`.
6. **Stage 6 — `Rollback`:** `library.rollback()` restores the exact prior snapshot (`version - 1` and prior `active_skills` list) and marks the rolled-back record `stage = "rolled_back"`.

---

## 4. Measured Results Across 30 Seeds (90 Tasks + 90 Regression Tasks)

*Provenance:* Locally measured (`Python 3.12.3`) and confirmed by GitHub Actions (`Python 3.12.15`). Raw artifacts saved in `RI/experiments/E10_guarded_subprimitive_synthesis/results/results.json`, `RI/results/m17_summary.json`, and `RI/results/m17_ablation_results.json`. All probability/accuracy 95% confidence intervals are clamped to \([0.0, 1.0]\).

### 4.1 Main Benchmark Comparison (6 Methods, 30 Seeds)

| Method | Valid Tasks (A+B) Held-Out Acc (95% CI) | Valid Tasks (A+B) Large-Size \(N \in [8..11]\) Acc | Family A Exact Primitive Recovery | Family B Exact Composition Recovery | Family C False Rejection Rate (Higher = Better) | Family C False Promotion Rate (Lower = Better) | Locked M16 Regression Rate | Mean Runtime / Seed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **`m17_full_guarded_synthesis`** | **`0.9958 [0.9910, 1.0000]`** | **`0.9935 [0.9857, 1.0000]`** | **`1.0000`** (`30/30`) | **`0.9000`** (`27/30`) | **`1.0000`** (`30/30`) | **`0.0000`** (`0/30`) | **`0.0000`** | `75.3 ms` |
| `synthesis_no_adversarial_checks` | `0.9958 [0.9910, 1.0000]` | `0.9935 [0.9857, 1.0000]` | `1.0000` (`30/30`) | `0.9000` (`27/30`) | `0.3333` (`10/30`) | **`0.6667`** (`20/30`) | `0.0000` | `54.2 ms` |
| `synthesis_no_validation_guard` | `0.9296 [0.8948, 0.9644]` | `0.9130 [0.8702, 0.9558]` | `0.8333` (`25/30`) | `0.5667` (`17/30`) | `0.6667` (`20/30`) | **`0.3333`** (`10/30`) | `0.0000` | `76.2 ms` |
| `enumerative_no_skill_memory` | `0.9134 [0.8810, 0.9458]` | `0.8824 [0.8413, 0.9235]` | `0.8667` (`26/30`) | `0.0000` (`0/30`) | `0.0000` (`0/30`) | **`1.0000`** (`30/30`) | `0.0000` | `57.3 ms` |
| `m16_unchanged_grammar` | `0.7134 [0.6777, 0.7491]` | `0.6824 [0.6392, 0.7256]` | `0.0000` (`0/30`) | `0.0000` (`0/30`) | `1.0000` (`30/30`) | `0.0000` (`0/30`) | `0.0000` | `50.3 ms` |
| `random_or_majority_reference` | `0.5000 [0.5000, 0.5000]` | `0.5000 [0.5000, 0.5000]` | `0.0000` (`0/30`) | `0.0000` (`0/30`) | `0.0000` (`0/30`) | `0.0000` (`0/30`) | `0.0000` | `0.9 ms` |

### 4.2 Concrete Examples of Promoted and Quarantined Candidates (`candidate_examples`)
- **Promoted on Family A:**
  - *Seed 0:* `subprimitive:pair_color_size_delta({'c1': 0, 'c2': 2, 'delta': 2})` → `promoted`, held-out accuracy `1.0000`, large-size accuracy `1.0000`.
  - *Seed 1:* `subprimitive:pair_proximal_dipole({'color': 0, 'max_gap': 1})` → `promoted`, held-out accuracy `1.0000`, large-size accuracy `1.0000`.
  - *Seed 2:* `subprimitive:triad_monotone_size_distinct_color({'charge': 0})` → `promoted`, held-out accuracy `1.0000`, large-size accuracy `1.0000`.
- **Quarantined / Rejected on Family C:**
  - *Seed 0 (`spurious_positional_shortcut`):* Staged `subprimitive:spurious_slot0_charge({'charge': 1})` (achieved `1.000` train and `1.000` val accuracy) → **Quarantined** by Stage 3 (`["failed_permutation_invariance_audit"]`).
  - *Seed 1 (`confounded_ambiguous_twin`):* Staged `subprimitive:forall_color_charged({'color': 2, 'charge': 1})` (tied at `1.000` train, val, and size-val accuracy with `color=1`) → **Quarantined** by Stage 3 (`["ambiguous_alternative_rules (2 distinct candidates tied on train+val)"]`).
  - *Seed 2 (`corrupted_training_overfit`):* Staged `subprimitive:forall_color_charged({'color': 0, 'charge': 1})` (achieved `1.000` train accuracy and passed permutation invariance) → **Quarantined** by Stage 2 (`["val_accuracy 0.286 < 0.850", "independent_size_val_accuracy 0.500 < 0.850", "gain_over_base_grammar -0.321 < 0.120"]`).

---

## 5. Reproducible Commands

```bash
# 1. Run M17 (E10) unit and anti-self-deception tests (11 tests)
cd RI/experiments/E10_guarded_subprimitive_synthesis
python3 -B -m unittest -v

# 2. Run 30-seed E10 benchmark and generate results.json, m17_summary.json, m17_ablation_results.json
python3 evaluate.py --seeds $(seq 0 29) --train-size 18 --val-size 14 --independent-size-val 14 --test-size 36 --output results/results.json

# 3. Run the complete RI validation suite (E2–E10 + top-level tests + M10–M15 prototype)
cd /workspace
python3 RI/run_experiments.py
```

---

## 6. Known Limitations and Recommendation for M18

1. **Bounded Sub-Primitive DSL:** `SubPrimitiveSynthesizer` searches a finite, hand-typed DSL of 48 candidate templates (`33` unique after canonical deduplication). While it proves the mechanics of guarded grammar extension, quarantine, and downstream composition, it does not synthesize arbitrary recursive programs.
2. **Active Disambiguation of Quarantined Ambiguous Twins (Recommendation for M18):**
   In Family C Trap 1 (`confounded_ambiguous_twin`), two distinct sub-primitives (`forall_color_charged` for `color=1` vs `color=2`) tie on all passive training and validation splits, and M17 rightly places them in `quarantine`. The natural next research step (**M18: Active Interventional Disambiguation of Quarantined Sub-Primitives**) is to allow the agent to construct or request a targeted **counterfactual intervention scene** (where `color=1` is charged and `color=2` is uncharged) to resolve the quarantine and promote the true causal primitive.
