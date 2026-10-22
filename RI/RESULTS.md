# RESULTS — Verified Experimental and Prototype Measurements

## 1. Execution Environment and Provenance

- **Repository:** `clarityosbaerbelwesterop-gif/Osirus`
- **Branch:** `ri/isolated-foundation`
- **Python Version (Local):** `Python 3.12.3` (Linux 6.12.94+, CPU-only)
- **Python Version (GitHub Actions CI):** `Python 3.12.15` (`ubuntu-24.04`)
- **Central Validation Command:** `python3 RI/run_experiments.py` -> **Exit code: `0`**
- **Prototype CLI Command:** `python3 RI/run_prototype.py --mode all` -> **Exit code: `0`**

---

## 2. Summary of Experiments E1–E8 (30 Seeds Each for E2–E8)

| Experiment | Milestone | Unit Tests | Primary Candidate Metric | Baseline Comparison | Result & Scientific Interpretation |
| --- | --- | --- | --- | --- | --- |
| **E1** (`E1_relationship_learning`) | M0–M2 | `2/2` (`test_environment.py`) | Held-out acc: `0.3333` | `memorize`: `1.0000`, `mean`: `1.0000`, `random`: `0.6667` | **Negative / Unclear:** Initial H1 candidate did not beat base-rate/memorize on the 3-seed toy setup. |
| **E2** (`E2_capability_transfer`) | M3 | `4/4` OK | Accuracy: `0.9000` (4 queries) | `random_ablation`: `0.9000`, `fixed`: `0.9000` | **Neutral:** With budget=4 on a 2-action binary world, all balanced/random query schedules reach `0.9000`. |
| **E3** (`E3_composition`) | M4 | `4/4` OK | Success rate: `1.0000` | `reset`: `0.2333`, `random`: `0.2333` | **Positive (toy):** Preserving stage-1 evidence yields `+0.7667` gain over equal-budget reset/random controls. |
| **E4** (`E4_autonomous_curriculum`) | M5 | `3/3` OK | Mean success: `0.7304` | `random`: `0.7258`, `fixed`: `0.7321`, `error_only`: `0.7346` | **Negative / Neutral:** Hand-designed uncertainty+reuse heuristic does not beat `error_only` (`0.7346`). |
| **E5** (`E5_continual_learning`) | M6 | `4/4` OK | Mean Brier: `0.2085` (lower is better) | `reset` ablation: `0.2531` | **Positive (toy):** Persistent Beta-Bernoulli counts reduce held-out Brier error by `0.0446` vs task-switch reset. |
| **E6** (`E6_guarded_self_improvement`) | M7 | `6/6` OK | Retention: `0.4527` (`+0.0263` paired gain) | Baseline config: `0.4263` (`min_gain = 0.0100`) | **Positive (harness):** Allow-listed parameter proposal passes paired-seed promotion gate. |
| **E7** (`E7_skill_acquisition`) | M8 | `5/5` OK | Held-out acc: `0.9653` | `nearest_neighbour`: `0.8778`, `majority`: `0.6389` | **Positive (bounded):** Threshold induction generalizes to disjoint grid points (`+0.0875` over NN, `+0.3264` over majority). |
| **E8** (`E8_rule_discovery`) | M9 | `12/12` OK | Family selection: `1.0000`, Exact rule: `0.8667`, Held-out acc: `0.9833` | Held-out acc — `majority`: `0.5611`, `fixed_threshold`: `0.6667`, `random_hypothesis`: `0.7250` | **Positive (bounded):** Selects the true family on `30/30` seeds (`17` `sum_threshold`, `13` `parity`); `threshold_tie_rate = 0.1333` (`4/30` seeds) explains the `0.9833` vs `1.0` gap. |
| **E9** (`E9_heldout_rule_generalization`) | M16 | `11/11` OK | Identifiable Held-out acc: `0.9938 ± 0.0055`, Exact rule: `0.9222 ± 0.0556`, C2 Abstention: `0.9667` | `ri_no_skill_memory`: `0.9676`, `ri_no_compositional`: `0.9123`, `bounded_enumerative_search`: `0.8324`, `supervised_reference`: `0.6114`, `majority_prior`: `0.4873`, `random_hypothesis`: `0.4802` | **Positive (bounded relational) + Honest Boundary:** Generalizes across unseen operator combinations (`A`: `0.9815`), object-count scaling \(N \in [3..5] \to [9..11]\) (`B`: `1.0000`), and held-out pairwise rules (`C1`: `1.0000`), while flagging unidentifiable out-of-grammar rules (`C2`) on `29/30` seeds. |
| **E10** (`E10_guarded_subprimitive_synthesis`) | M17 | `11/11` OK | Valid (A+B) Held-out acc: `0.9958 [0.9910, 1.0000]`, Family A Exact Recovery: `1.0000`, Family B Composition Recovery: `0.9000`, Family C False Promotion: `0.0000` | `m16_unchanged_grammar`: `0.7134` (`0.0000` rec), `enumerative_no_skill_memory`: `0.9134` (`0.0000` B-comp, `1.0000` false prom), `synthesis_no_validation_guard`: `0.9296` (`0.3333` false prom), `synthesis_no_adversarial_checks`: `0.9958` (`0.6667` false prom), `random_or_majority_reference`: `0.5000` | **Positive (guarded DSL synthesis):** Synthesizes missing relational primitives (`30/30`), composes them with existing skills (`27/30`), and quarantines `30/30` adversarial traps (`0%` false promotion, `0%` regression). |
| **E11** (`E11_active_disambiguation`) | M18 | `15/15` OK | Identifiable Rule ID: `1.0000` (`75/75`), Held-out acc: `1.0000`, Unidentifiable Abstention: `1.0000` (`45/45`), Equivalence Handling: `1.0000` (`30/30`), False Promotion: `0.0000` (`0/150`) | `random_intervention`: `0.3867` ID, `fixed_heuristic`: `0.0000` ID, `no_active_selection`: `0.0000` ID, `no_equivalence_check`: `0.4000` ID (`0.0000` equiv), `no_m17_guard`: `0.4000` (`60/150`) false prom, `oracle_upper_bound`: `1.0000` ID (`0.77` steps) | **Positive (active experimental disambiguation):** Resolves 4-way confounded hypotheses in `2.0` interventions (`1.0` bit/step), handles single-flip noise (`15/15` on `B1`) and contradictory noise (`15/15` abstention on `B2`), detects equivalence (`30/30`), and stops in `0.0` interventions when no distinguishing experiment exists (`30/30` on `D`). |

---

## 3. Detailed M9 (`E8_rule_discovery`) Results (30 Seeds, `train_size=16`, `test_size=24`)

Artifact: `RI/experiments/E8_rule_discovery/results/results.json`

- **Rule-Family Selection Rate (`rule_family_selection_rate`):** `1.0000` (`30/30` seeds)
  - `sum_threshold` (`n = 17` episodes): family selection `1.0000`, exact threshold recovery `0.7647` (`13/17`), held-out accuracy `0.9706`.
  - `parity` (`n = 13` episodes): family selection `1.0000`, exact rule recovery `1.0000` (`13/13`), held-out accuracy `1.0000`.
- **Tie & Bias Diagnostics:**
  - `family_tie_rate`: `0.0000` at `train_size = 16` (tested separately at `train_size = 1` where `family_tie = True` and tie-breaking favors `sum_threshold(0)`).
  - `threshold_tie_rate`: `0.1333` (`4/30` seeds had multiple adjacent thresholds with `0` training error).
- **Baseline Comparisons (Held-Out Accuracy / Family Selection Rate):**
  - `RuleDiscoveryAgent`: `0.9833` held-out accuracy / `1.0000` family selection
  - `MajorityBaseline`: `0.5611` held-out accuracy (`+0.4222` candidate gain)
  - `FixedThresholdBaseline (t=7)`: `0.6667` held-out accuracy / `0.5667` family selection (`+0.3167` candidate gain)
  - `RandomHypothesisBaseline`: `0.7250` held-out accuracy / `0.6000` family selection (`+0.2583` candidate gain)

---

## 4. M10–M12 Prototype Benchmark Results (30 Seeds)

Artifacts:
- `RI/results/prototype_demo_report.json`
- `RI/results/prototype_benchmark.json`
- `RI/results/prototype_skill_memory.json`
- `RI/results/experiment_suite_summary.json`

### 4.1 M10 End-to-End Prototype (`m10_end_to_end`, 30 Seeds Across 6 Task Families)
- **Task Pass Rate:** `1.0000` (`30/30` tasks met all train, held-out, disjointness, and runtime criteria)
- **Mean Development Accuracy:** `1.0000`
- **Mean Held-Out Accuracy:** `0.9944`
- **Learning Loop Trigger Rate:** `0.5000` (`15/30` tasks — automatically triggered on `mod_sum`, `coord_box`, and `composed_and` tasks where initial primitive pass had counterexamples)
- **Mean Runtime per Task:** `~0.70 ms` (CPU-only)
- **Held-Out Baselines:**
  - `majority`: `0.6069` (`+0.3875` prototype gain)
  - `fixed_rule (t=7)`: `0.6319` (`+0.3625` prototype gain)
  - `random`: `0.5097` (`+0.4847` prototype gain)

### 4.2 M11 Skill-Memory, Compositional Transfer & Continual Learning (`m11_skill_transfer_and_continual`, 30 Seeds)
- **Direct Skill Reuse Rate:** `0.9333` (`28/30` seeds reused the exact stored skill; `mean_direct_reuse_accuracy = 1.0000`)
- **Compositional Transfer Rate (`composed_and` Held-Out Family):** `0.9000` (`27/30` seeds composed stored `sum_threshold` and `parity` skills with verified `IOContract` compatibility)
- **Compositional Transfer Held-Out Accuracy:**
  - `skill_memory_composition`: `0.9806`
  - `no_memory_single_primitive` (ablation without skill memory): `0.7653` (`+0.2153` composition gain)
  - `majority_baseline`: `0.7028` (`+0.2778` gain)
  - `fixed_rule_baseline`: `0.6931` (`+0.2875` gain)
  - `random_baseline`: `0.4875` (`+0.4931` gain)
- **4-Family Continual Learning (`sum_threshold` -> `parity` -> `diff_threshold` -> `coord_box`):**
  - `mean_initial_accuracy`: `0.9795`
  - `persistent_memory_retention_accuracy`: `0.9688`
  - `reset_memory_ablation_accuracy`: `0.6698` (`+0.2990` retention advantage for persistent skill memory)
  - `mean_forgetting_rate`: `0.0115`

### 4.3 M12 Guarded Self-Improvement (`m12_guarded_self_improvement`, 30 Held-Out Seeds)
- **Baseline Configuration (`v1`):** `enable_learning_loop = False`, `complexity_weight = 0.02`, `max_refinement_rounds = 1`
- **Candidate Configuration (`v2`):** `enable_learning_loop = True`, `complexity_weight = 0.01`, `max_refinement_rounds = 2`
- **Regression Gate (3 Core Tasks):**
  - Baseline mean accuracy: `0.9306`
  - Candidate mean accuracy: `0.9306`
  - Regression drop: `0.0000` (`passed = True`)
- **Disjoint Held-Out Gate (30 Tasks Across 6 Families, `minimum_gain = 0.05`):**
  - Baseline mean held-out accuracy: `0.8792` (task pass rate `0.6667`)
  - Candidate mean held-out accuracy: `0.9639` (task pass rate `0.9000`)
  - Mean paired gain: `+0.0847 >= 0.0500` (`passed = True`)
- **Decision:** `status = "promoted"`, `active_version = 2` (rollback to `v1` verified by negative test `test_non_improving_candidate_is_rejected_and_rolled_back`).

### 4.4 M13 Active Boundary Querying (`m13_active_boundary_querying`, 30 Seeds, `initial_train_size=10`, `query_pool_size=30`, `test_size=24`, `query_budget=3`)
- **Initial Tie Rate (`initial_tie_rate`):** `0.5667` (`17/30` seeds had multiple hypotheses tied at minimum training error before querying, with mean version-space size `3.10`).
- **Policy Comparison:**
  - `active_disagreement`: **`1.0000` held-out accuracy**, **`1.0000` exact rule recovery**, `1.0333` mean queries used, `0.8824` tie resolution rate (`15/17` tied seeds reduced to a unique hypothesis; the remaining 2 had no boundary point in the finite 30-point pool but still selected the exact true rule).
  - `random_query` (equal budget=3): `0.9306` held-out accuracy (`+0.0694` active gain), `0.6333` exact rule recovery (`+0.3667` active gain), `1.7000` mean queries used, `0.0588` tie resolution rate.
  - `passive_no_query` (0 queries): `0.9292` held-out accuracy (`+0.0708` active gain), `0.5667` exact rule recovery (`+0.4333` active gain).
  - Baselines: `majority = 0.5861`, `fixed_rule = 0.6500`.

### 4.5 M14 Multi-Operator Compositional Skill Language (`m14_compositional_skill_language`, 30 Seeds across `AND`, `OR`, `XOR`, `AND_NOT`, `train_size=14`, `test_size=24`)
- **Search Space Compression:** `memory_guided_composition` evaluates an average of **`6.8` candidates** vs **`5,482` candidates** for `unconstrained_depth2_enumeration` (**`806.18x` search compression**).
- **Structural Regularization Against Small-Sample Overfitting:**
  - `unconstrained_depth2_enumeration` achieves `1.0000` training accuracy on all 30 seeds (`train_size=14`), but drops to **`0.8597` held-out accuracy** (`overfitting_gap = 0.1403`, operator recovery `0.7667`) because brute-forcing 5,482 pairwise combinations finds spurious threshold/box pairs that accidentally fit 14 points.
  - `memory_guided_composition` (composing verified base skills from `SkillMemory`) achieves **`0.9806` held-out accuracy** (`overfitting_gap = 0.0099`, operator recovery `0.9333`), outperforming unconstrained depth-2 search by **`+0.1208`** and single primitives (`0.6931`) by **`+0.2875`**.
- **Held-Out Accuracy by Operator (`memory_guided` vs `unconstrained_depth2` vs `single_primitive`):**
  - `AND` (`n=8`): `0.9583` vs `0.8906` vs `0.7396`
  - `OR` (`n=8`): `1.0000` vs `0.8750` vs `0.7604`
  - `XOR` (`n=7`): `1.0000` vs `0.8810` vs `0.4464` (single primitives fail on `XOR` due to non-monotonic parity interaction)
  - `AND_NOT` (`n=7`): `0.9643` vs `0.7857` vs `0.8095`

### 4.6 M15 Non-Stationary Concept Drift, Noise Robustness & Lineage Recovery (`m15_drift_and_noise_robustness`, 30 Seeds)
- **5-Phase Continual Stream Accuracy (`mean_stream_held_out_accuracy`):**
  - `guarded_drift_controller`: **`0.9597`**
  - `naive_overwrite`: `0.9094` (`+0.0503` guarded gain)
  - `static_frozen`: `0.8286` (`+0.1311` guarded gain)
  - `majority_baseline`: `0.6253` (`+0.3344` guarded gain)
- **Per-Phase Breakdown (`guarded_drift_controller` vs `naive_overwrite` vs `static_frozen`):**
  1. `phase_1_clean_regime_a` (\(\eta=0.00, n=24\)): `0.9931` vs `0.9931` vs `0.9931` (`30/30` initial acquisitions).
  2. `phase_2_noisy_regime_a` (\(\eta=0.15, n=10\)): **`0.9792`** vs `0.8833` vs `0.9958` (`naive_overwrite` loses `11.0%` accuracy by re-fitting on a noisy 10-point batch, whereas `guarded_drift_controller` retains or protects the prior skill on `28/30` seeds).
  3. `phase_3_abrupt_drift_regime_b` (\(\eta=0.05, n=24, t_B = t_A + 4\)): **`0.9792`** vs `0.9792` vs `0.5889` (`static_frozen` collapses by `40.7%` under concept drift, whereas `guarded_drift_controller` adapts to `v2` on `30/30` seeds).
  4. `phase_4_corrupted_batch_shock` (\(\eta=0.40, n=10\)): **`0.9500`** vs `0.7861` vs `0.5708` (`guarded_drift_controller` rejects the un-realizable noisy shock or retains `v2` on `26/30` seeds, beating `naive_overwrite` by `+0.1639`).
  5. `phase_5_recurring_regime_a` (\(\eta=0.15, n=10\)): **`0.8972`** (`guarded_drift_controller` reactivates superseded `v1` from `SkillMemory` on `23/30` seeds via `recovered_prior_version`; on 4 seeds the 10-point sample had \(\le 2\) points in the drift band \([t_A, t_B-1]\) so `v2` appeared within `noise_tolerance`, and on 3 seeds `>20%` realized label noise exceeded `noise_tolerance`).
- **Noise Sensitivity Curve (30 Seeds, `train_size=24`, evaluated on noiseless held-out truth):**
  - `0%` noise: noisy-train acc `1.0000`, clean held-out acc **`0.9972`** (majority `0.5861`)
  - `5%` noise: noisy-train acc `0.9653`, clean held-out acc **`0.9847`** (majority `0.5806`)
  - `10%` noise: noisy-train acc `0.9181`, clean held-out acc **`0.9722`** (majority `0.5778`)
  - `20%` noise: noisy-train acc `0.8361`, clean held-out acc **`0.9250`** (majority `0.5944`)

### 4.7 M16 (`E9_heldout_rule_generalization`) — Relational Object-Graph Generalization (30 Seeds, 120 Tasks)
Artifacts:
- `RI/experiments/E9_heldout_rule_generalization/results/results.json`
- `RI/results/m16_summary.json`
- `RI/results/m16_ablation_results.json`

- **Identifiable Regimes (`A_compositional`, `B_structural_size_transfer`, `C1_heldout_translatable`, 90 Tasks):**
  - `ri_full`: Held-out accuracy **`0.9938 ± 0.0055`**, exact rule recovery **`0.9222 ± 0.0556`**, size-transfer drop (`small_3_5` -> `large_9_11`) **`+0.0009`**.
  - `ri_no_skill_memory`: Held-out accuracy `0.9676 ± 0.0189`, exact rule recovery `0.8111 ± 0.0813` (on Regime A drops to `0.9028` accuracy and `0.4667` exact recovery vs `0.9815` / `0.8000` for `ri_full`).
  - `ri_no_compositional` (`max_depth=1`): Held-out accuracy `0.9123 ± 0.0329`, exact rule recovery `0.6667 ± 0.0979` (`0.0000` exact recovery on Regime A).
  - `bounded_enumerative_search`: Held-out accuracy `0.8324 ± 0.0440`, exact rule recovery `0.5222 ± 0.1038`.
  - `supervised_reference` (3-NN over unnormalized counts & positional slots): Held-out accuracy `0.6114 ± 0.0233`, size-transfer drop `+0.0463` (`0.6269` on `small_3_5` -> `0.5806` on `large_9_11`).
  - `majority_prior`: Held-out accuracy `0.4873 ± 0.0091`.
  - `random_hypothesis`: Held-out accuracy `0.4802 ± 0.0235`.
- **Unidentifiable Out-of-Grammar Regime (`C2_heldout_unidentifiable`, 30 Tasks):**
  - `ri_full` abstains with `status = "unidentified_high_uncertainty"` on **`29/30` seeds (`96.67%`)** (false abstention rate on identifiable tasks: `1.11%`), whereas `bounded_enumerative_search` and `ablation_no_m15_validation_guard` have `0.00%` detection and silently output random-level predictions (`~0.499`).
- **Component Failure / Overhead Cases (`when_components_do_not_help_or_hurt`):**
  - Under a corrupted query oracle (`75%` flip rate) without M15 validation guarding, M13 active querying degrades held-out accuracy by **`-0.0917`** (`0.8167` -> `0.7250`).
  - When `SkillMemory` contains only irrelevant Regime-A unary skills on `C1_heldout_translatable`, M14 skill composition yields `0.0000` accuracy gain while adding `+7.67` candidate evaluations per task.

### 4.8 M17 (`E10_guarded_subprimitive_synthesis`) — Guarded Sub-Primitive Synthesis (30 Seeds, 90 Tasks + 90 Locked Regression Tasks)
Artifacts:
- `RI/experiments/E10_guarded_subprimitive_synthesis/results/results.json`
- `RI/results/m17_summary.json`
- `RI/results/m17_ablation_results.json`

- **`m17_full_guarded_synthesis`:**
  - Valid tasks (`A+B`) held-out accuracy: **`0.9958 [0.9910, 1.0000]`** (large-size \(N \in [8, 11]\) accuracy: **`0.9935 [0.9857, 1.0000]`**).
  - Family A (`A_primitive_synthesis`): Held-out accuracy **`1.0000`**, exact sub-primitive recovery **`1.0000`** (`30/30`), promotion rate `1.0000`.
  - Family B (`B_composition_with_synthesized`): Held-out accuracy **`0.9917 [0.9822, 1.0000]`**, exact composition recovery **`0.9000 [0.7908, 1.0000]`** (`27/30`), memory composition usage rate `0.9333` (`28/30`).
  - Family C (`C_spurious_and_noisy_traps`): False candidate rejection rate **`1.0000`** (`30/30`), false promotion rate **`0.0000`** (`0/30`), quarantine rate `1.0000`.
  - Locked M16 regression rate: **`0.0000`** (`0/30`), rollback verification drill pass rate: **`1.0000`** (`30/30`).
- **Comparison Baselines & Ablations:**
  - `m16_unchanged_grammar`: Valid (`A+B`) accuracy `0.7134 [0.6777, 0.7491]`, Family A exact recovery `0.0000`, Family B exact recovery `0.0000` (`+0.2824` paired gain for `m17_full_guarded_synthesis`).
  - `enumerative_no_skill_memory`: Valid (`A+B`) accuracy `0.9134`, Family A exact recovery `0.8667`, Family B exact composition recovery **`0.0000`**, Family C false promotion rate **`1.0000`** (`30/30`).
  - `synthesis_no_validation_guard`: Valid (`A+B`) accuracy `0.9296`, Family A exact recovery `0.8333`, Family B exact recovery `0.5667`, Family C false promotion rate **`0.3333`** (`10/30` — promotes all Trap 2 training-overfit rules).
  - `synthesis_no_adversarial_checks`: Valid (`A+B`) accuracy `0.9958`, Family C false promotion rate **`0.6667`** (`20/30` — promotes all Trap 0 positional-shortcut rules and Trap 1 confounded-twin rules).
  - `random_or_majority_reference`: Valid (`A+B`) accuracy `0.5000`, exact recovery `0.0000`.

### 4.9 M18 (`E11_active_disambiguation`) — Active Disambiguation & Experimental Intervention (30 Seeds, 150 Tasks + 150 Locked Regression Tasks)
Artifacts:
- `RI/experiments/E11_active_disambiguation/results/results.json`
- `RI/results/m18_summary.json`
- `RI/results/m18_ablation_results.json`

- **`ri_full` (Active Disambiguation + Equivalence Check + Corroborated Uncertainty + M17 Guard):**
  - Identifiable tasks (`A`, `B1`, `E`) exact rule identification rate: **`1.0000 [1.0000, 1.0000]`** (`75/75`), held-out accuracy: **`1.0000 [1.0000, 1.0000]`**.
  - Unidentifiable / contradictory tasks (`D`, `B2`) abstention rate: **`1.0000 [1.0000, 1.0000]`** (`45/45`), using **`0.00`** interventions on `D_unidentifiable_ambiguity` (`30/30` stopped immediately on `max IG == 0`).
  - Semantic equivalence handling rate (`C_semantically_equivalent`): **`1.0000 [1.0000, 1.0000]`** (`30/30` — eliminates non-equivalent competitors and resolves equivalent syntax pairs without wasting interventions or claiming single-syntax separation).
  - Noisy observation robustness (`B_noisy_observations`): **`1.0000`** (`30/30` — `15/15` exact identification on `B1_recoverable_single_flip` with corroboration margin `\ge 2`, and `15/15` safe abstention on `B2_unresolvable_contradictory_noise`).
  - Distinguishing intervention rate: **`0.9348`** (`215/230` interventions; `1.0000` on noiseless families `A, C, E`), mean interventions used: **`1.5333`**, cumulative realized entropy reduction: **`166.81` bits** (`1.1121` bits/task).
  - Safety & Regression: **`0/150` (`0.0000`) false identifications**, **`0/150` (`0.0000`) false promotions**, **`30/30` (`1.0000`) successful rollbacks**, **`0.0000` regression drop** on locked M16 and M17 suites.
- **Comparison Baselines & Ablations:**
  - `random_intervention`: Identifiable rule ID `0.3867` (`29/75`), distinguishing intervention rate `0.4054` (`180/444`), mean interventions `2.96`, equivalence handling `0.3333` (`10/30`).
  - `fixed_heuristic` (surface object-count & diversity heuristic): Identifiable rule ID **`0.0000`** (`0/75`), distinguishing intervention rate `0.0521` (`25/480`), mean interventions `3.20` (fooled by high-diversity `IG=0` decoy scenes).
  - `no_active_selection` (index-order selection without IG calculation): Identifiable rule ID **`0.0000`** (`0/75`), distinguishing intervention rate `0.0833` (`40/480`), mean interventions `3.20` (wastes all `3.0` interventions on `D`).
  - `no_equivalence_check`: Identifiable rule ID `0.4000` (`30/75`), semantic equivalence handling **`0.0000`** (`0/30` — fails whenever the true rule has an equivalent syntactic twin in the DSL).
  - `no_m17_guard` (isolated non-productive sandbox): Unidentifiable abstention **`0.0000`** (`0/45`), false identification rate **`0.4000`** (`60/150`), false promotion rate **`0.4000`** (`60/150` overall; `1.0000` (`45/45`) on `D` + `B2`), productive memory mutation **`False`** (`0` mutations).
  - `oracle_upper_bound` (post-hoc analysis only): Identifiable rule ID `1.0000` (`75/75`) in **`0.7667` mean interventions** (`1.0` step on `A` and `E` via clairvoyant `1-vs-3` isolation vs `2.0` steps for non-clairvoyant `2-vs-2` splitting in `ri_full`).

---

## 5. Known Limitations and Open Risks

1. **Bounded Hypothesis Space:** All rules in E7, E8, and M10–M12 come from 6 discrete 2D grid rule families (`sum_threshold`, `parity`, `diff_threshold`, `mod_sum`, `coord_box`, `composed_and`). High accuracy on these tasks does not imply open-ended concept invention or general intelligence.
2. **Finite-Sample Boundary Ambiguity:** On an 8×8 grid (64 points), random training subsets of size 16–28 occasionally omit points along the exact threshold boundary \(x + y = t - 1\), leading to threshold ties (`13.3%` in E8 at `train_size=16`, `6.7%` in M11 at `train_size=28`).
3. **Configuration-Level Self-Improvement:** M12 tunes allow-listed orchestrator hyperparameters (`PrototypeConfig`); it does not synthesize new primitive operators.
