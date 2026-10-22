# M16 — Generalization to Unseen Rule Languages and Relational Object Graphs (`E9`)

## 1. Research Question and Falsifiable Hypotheses

**Core Research Question:** Can RI induce formal relational rules from small, noisy example sets over variable-size object scenes and generalize to (A) unseen combinations of previously acquired operator skills, (B) unseen object-set sizes (\(N_{\text{train}} \in [3, 5] \to N_{\text{test}} \in [9, 11]\)), and (C) rule classes completely held out from prior skill training—while honestly flagging unidentifiable out-of-grammar rule classes rather than fabricating false discoveries?

### Pre-Registered Hypotheses
- **H16.1 (Compositional Generalization — Regime A):** Composing verified depth-1 skills stored in `SkillMemory` (`M14`) over unseen binary combinators (`XOR`, `AND_NOT`, `AND`, `OR`) achieves higher held-out accuracy and exact rule recovery than both depth-1 non-compositional search (`ri_no_compositional`) and unconstrained depth-2 enumerative search (`bounded_enumerative_search`, `ri_no_skill_memory`) under identical sample and candidate budgets.
- **H16.2 (Structural Size Generalization — Regime B):** Evaluating permutation-invariant relational primitives (`argmax_size_has_charge`, `argmax_size_has_color`, `charge_ratio_ge`) enables zero-shot transfer from small object sets (\(N \in [3, 5]\)) to large object sets (\(N \in [9, 11]\)) with near-zero size-transfer degradation, whereas a supervised feature baseline (`supervised_reference`) using fixed positional slots and raw counts degrades as \(N\) increases.
- **H16.3 (Held-Out Rule Class Identification vs. Principled Abstention — Regimes C1 & C2):**
  - On **C1 (`C1_heldout_translatable`)**—where pairwise relational rules (`exists_pair_same_color_close_size`, `exists_directed_dominance`) are held out from warm-up memory but expressible in the bounded grammar—RI recovers the underlying rule via grammar search, validation guarding (`M15`), and active disagreement querying (`M13`).
  - On **C2 (`C2_heldout_unidentifiable`)**—where the true rule is a non-local ternary cyclic triad parity rule outside the hypothesis grammar—RI cannot recover the rule (`exact_rule_recovery_rate = 0.0`), and the `M15` validation consistency gate flags `status = "unidentified_high_uncertainty"` (`abstained = True`) on the vast majority of episodes.

---

## 2. Architecture Reuse, Gaps Addressed, and Data Model

### Reused vs. Extended Components
- **Reused Architectural Principles:**
  - `M13` Shannon-entropy version-space disagreement querying (`ActiveBoundaryQuerier` pattern adapted to relational scene pools in `RIRelationalAgent`).
  - `M14` unit-test-gated skill registration and multi-operator binary composition (`RelationalSkillMemory`).
  - `M15` joint training/validation consistency scoring and noise-tolerant selection.
  - Central validation runner `RI/run_experiments.py` and `.github/workflows/ri-validation.yml`.
- **Gaps Identified in M8–M15 and Closed in M16 (`E9`):**
  1. *Fixed 2D coordinate inputs `(x, y)` in E7/E8/M10–M15:* Replaced in `E9` by variable-size unordered object scenes \(S = \{o_1, \dots, o_N\}\) with \(N \in [3, 11]\) and four discrete attributes per object (`color` \(\in \{0,1,2\}\), `size` \(\in \{1..6\}\), `charge` \(\in \{0,1\}\), `pos` \(\in \{0..9\}\)).
  2. *Duplicate/equivalent candidate expressions:* Added canonical 28-scene truth-table fingerprinting (`semantic_signature` over `CANONICAL_PROBE_SCENES`), removing `237` semantically redundant ASTs before full depth-2 evaluation.
  3. *Lack of an out-of-grammar unidentifiable control:* Added Regime `C2_heldout_unidentifiable` and an explicit abstention state (`status = "unidentified_high_uncertainty"`, `abstained = True`).

---

## 3. Formal Definition of the Relational Rule Language

Each scene is a finite multiset of \(N\) objects \(S = \{o_1, \dots, o_N\}\).

### 3.1 Level-1 Relational Primitives (`eval_primitive_node`)
1. `exists_color_size_ge(c, s)`: \(\exists o \in S: o.\text{color} = c \land o.\text{size} \ge s\)
2. `all_size_ge(s)`: \(\forall o \in S: o.\text{size} \ge s\)
3. `charge_ratio_ge(num, den)`: \(\text{den} \cdot \sum_{o \in S} o.\text{charge} \ge \text{num} \cdot |S|\)
4. `parity_sum_charge(p)`: \(\left(\sum_{o \in S} o.\text{charge}\right) \bmod 2 = p\)
5. `argmax_size_has_charge(ch)`: \(o^*.\text{charge} = \text{ch}\), where \(o^* = \arg\max_{o \in S}(o.\text{size}, o.\text{pos}, o.\text{color}, o.\text{charge})\)
6. `argmax_size_has_color(c)`: \(o^*.\text{color} = c\)
7. `exists_pair_same_color_close_size(d)` *(C1 held-out relational pair primitive)*: \(\exists i < j: o_i.\text{color} = o_j.\text{color} \land |o_i.\text{size} - o_j.\text{size}| \le d\)
8. `exists_directed_dominance(src_c, dst_c)` *(C1 held-out relational dominance primitive)*: \(\exists o_1, o_2 \in S: o_1.\text{color} = \text{src\_c} \land o_2.\text{color} = \text{dst\_c} \land o_1.\text{size} \ge o_2.\text{size} + 1 \land o_1.\text{charge} = o_2.\text{charge}\)

### 3.2 Level-2 Compositional Combinators (`eval_combinator`, Depth \(\le 2\))
- Unary (`depth = 1`): `ID(P)`, `NOT(P)`
- Binary (`depth = 2`): `AND(P1, P2)`, `OR(P1, P2)`, `XOR(P1, P2)`, `AND_NOT(P1, P2)`, `IMPLIES(P1, P2)`

### 3.3 Out-of-Grammar Rule Class (`C2_heldout_unidentifiable`)
- `eval_out_of_grammar_cyclic_triad(S, target_rem)`: Computes the parity of ordered color triads \((o_i, o_j, o_k) \in C_0 \times C_1 \times C_2\) satisfying \((o_i.\text{size} \cdot (o_j.\text{pos}+1) + o_k.\text{size} + o_i.\text{charge} - o_j.\text{charge}) \equiv \text{target\_rem} \pmod 3\), XORed with position-weighted attribute parities. Because this rule depends on higher-order ternary modular interactions and object positions, no expression in the depth-2 relational grammar can represent it.

---

## 4. Experimental Design, Anti-Leakage Controls, and Baselines

### Splits and Budgets (Per Task Episode)
- **Seeds:** 30 seeds (`0..29`) \(\times\) 4 regimes = **120 task episodes**.
- **Splits:**
  - `train_examples`: `10` scenes (`5%` label noise: `train_label_noise_prob = 0.05`).
  - `val_examples`: `10` scenes (disjoint from train, query pool, and test).
  - `query_pool`: `16` scenes available for up to `query_budget = 3` active queries.
  - `test_examples`: `36` noiseless held-out scenes stratified into three object-count buckets: `small_3_5` (\(N \in [3, 5]\), 12 scenes), `medium_6_8` (\(N \in [6, 8]\), 12 scenes), and `large_9_11` (\(N \in [9, 11]\), 12 scenes).
- **Anti-Leakage Enforcement:**
  - `RelationalTaskSplit.verify_no_leakage()` checks canonical multiset disjointness across splits.
  - `strip_labels()` removes `"label"` and all metadata before passing test examples to `predict()`, and `predict()` raises `ValueError` if any test item contains `"label"`.

### Evaluated Methods and Fair Baselines (M16.3)
1. **`ri_full`:** Full M16 RI agent (`max_depth=2`, `max_candidates=420`, M14 `SkillMemory` composition, M13 active disagreement querying with `budget=3`, M15 validation guard & abstention gate `min_identifiable_accuracy=0.81`).
2. **`majority_prior`:** Predicts the majority label on `train + val`.
3. **`supervised_reference`:** Distance-weighted 3-Nearest-Neighbour classifier over a 8-dimensional vector of unnormalized scene counts/sums and first-3-object positional attributes, fit on `train + val`.
4. **`bounded_enumerative_search`:** Enumerative search over the identical 420-candidate grammar on `train_examples` without `SkillMemory`, without M13 active queries, and without M15 validation guarding.
5. **`ri_no_skill_memory`:** `ri_full` with `use_skill_memory = False`.
6. **`ri_no_compositional`:** `ri_full` restricted to `max_depth = 1` (no binary combinators).
7. **`random_hypothesis`:** Seeded uniform random draw from the bounded grammar.

---

## 5. Exact Reproducible Commands

```bash
# 1. Run E9 unit tests (11 tests)
cd RI/experiments/E9_heldout_rule_generalization
python3 -m unittest -v

# 2. Run 30-seed E9 evaluation and generate all M16 JSON artifacts
python3 evaluate.py --seeds $(seq 0 29) --train-size 10 --val-size 10 --query-pool-size 16 --test-size 36 --noise 0.05 --output results/results.json

# 3. From repository root: run the entire RI validation suite (E2–E9 + top-level tests + M10–M15 prototype)
cd /workspace
python3 RI/run_experiments.py
```

---

## 6. Measured Results Across 30 Seeds (120 Tasks)

*Provenance:* Locally measured (`Python 3.12.3`) and confirmed by GitHub Actions (`Python 3.12.15`). Raw artifacts saved in `RI/experiments/E9_heldout_rule_generalization/results/results.json`, `RI/results/m16_summary.json`, and `RI/results/m16_ablation_results.json`.

### 6.1 Main Comparison Table (Identifiable Regimes A, B, C1 vs. Unidentifiable C2)

| Method | Identifiable Held-Out Acc (95% CI) | Identifiable Exact Recovery (95% CI) | Regime A (Compositional) Acc | Regime B (Size Transfer) Acc | Regime C1 (Held-Out Class) Acc | Regime C2 Abstention / Detection Rate | Mean Candidates Evaluated | Mean Runtime / Task |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **`ri_full`** | **`0.9938 ± 0.0055`** | **`0.9222 ± 0.0556`** | **`0.9815 ± 0.0157`** | **`1.0000 ± 0.0000`** | **`1.0000 ± 0.0000`** | **`0.9667`** (`29/30`) | `354.45` (`157.8` on A) | `24.1 ms` |
| `ri_no_skill_memory` | `0.9676 ± 0.0189` | `0.8111 ± 0.0813` | `0.9028 ± 0.0496` | `1.0000 ± 0.0000` | `1.0000 ± 0.0000` | `0.9667` (`29/30`) | `420.00` | `26.8 ms` |
| `ri_no_compositional` (`depth=1`) | `0.9123 ± 0.0329` | `0.6667 ± 0.0979` | `0.7370 ± 0.0622` | `1.0000 ± 0.0000` | `1.0000 ± 0.0000` | `0.9667` (`29/30`) | `52.46` | `3.7 ms` |
| `bounded_enumerative_search` | `0.8324 ± 0.0440` | `0.5222 ± 0.1038` | `0.7269 ± 0.0748` | `0.8704 ± 0.0782` | `0.9000 ± 0.0620` | `0.0000` (`0/30`) | `420.00` | `10.5 ms` |
| `supervised_reference` (3-NN) | `0.6114 ± 0.0233` | `0.0000 ± 0.0000` | `0.5954 ± 0.0409` | `0.6843 ± 0.0271` | `0.5546 ± 0.0378` | `0.0000` (`0/30`) | `1.00` | `0.6 ms` |
| `majority_prior` | `0.4873 ± 0.0091` | `0.0000 ± 0.0000` | `0.5000 ± 0.0000` | `0.5000 ± 0.0000` | `0.4620 ± 0.0251` | `0.0000` (`0/30`) | `1.00` | `0.01 ms` |
| `random_hypothesis` | `0.4802 ± 0.0235` | `0.0000 ± 0.0000` | `0.4750 ± 0.0487` | `0.4630 ± 0.0327` | `0.5028 ± 0.0389` | `0.0000` (`0/30`) | `1.00` | `0.1 ms` |

### 6.2 Structural Object-Count Generalization (`small_3_5` \(\to\) `large_9_11`)
- **`ri_full`:** `small_3_5`: **`0.9944`**, `medium_6_8`: **`0.9935`**, `large_9_11`: **`0.9935`** (`mean_size_transfer_drop = +0.0009`).
- **`supervised_reference` (3-NN over unnormalized counts & first-3 positional slots):** `small_3_5`: `0.6269`, `medium_6_8`: `0.6269`, `large_9_11`: **`0.5806`** (`mean_size_transfer_drop = +0.0463` across all identifiable regimes, and in Regime B specifically drops because raw attribute counts scale with \(N\) and the maximum-size object frequently lies beyond index `2` when \(N \in [9, 11]\)).

### 6.3 Ablation Results and Component Contributions (`RI/results/m16_ablation_results.json`)

| Ablated Variant | Identifiable Held-Out Acc | Identifiable Exact Recovery | Accuracy Drop When Removed (95% CI) | Exact Recovery Drop When Removed (95% CI) | Key Mechanism Affected |
| --- | --- | --- | --- | --- | --- |
| **`ri_full` (All enabled)** | **`0.9938`** | **`0.9222`** | — | — | Reference (`false_abstention_rate = 0.0111`, `C2_detection = 0.9667`) |
| `ablation_no_m13_active_query` | `0.9870` | `0.9111` | `-0.0068 ± 0.0084` (`-0.0204` on Regime A) | `-0.0111 ± 0.0218` | Leaves boundary ties unresolved on `A_compositional` (`0.9611` vs `0.9815`) |
| `ri_no_skill_memory` (No M14) | `0.9676` | `0.8111` | **`-0.0262 ± 0.0185`** (**`-0.0787` on Regime A**) | **`-0.1111 ± 0.0653`** (**`-0.3333` on Regime A**) | Without verified base skills, depth-2 search on Regime A drops from `0.8000` to `0.4667` exact recovery |
| `ablation_no_m15_validation_guard` | `0.9383` | `0.8111` | **`-0.0556 ± 0.0290`** | **`-0.1111 ± 0.0653`** | Overfits `5%` noisy training labels and fails to detect `C2_heldout_unidentifiable` (`0.0000` vs `0.9667`) |
| `ri_no_compositional` (`depth=1`) | `0.9123` | `0.6667` | **`-0.0815 ± 0.0317`** (**`-0.2444` on Regime A**) | **`-0.2556 ± 0.0958`** (**`-0.8000` on Regime A**) | Cannot express binary combinations (`0.0000` exact recovery on Regime A) |

---

## 7. Error Analysis and Cases Where Components Do Not Help or Hurt

1. **When M13 Active Querying Degrades Accuracy (`m13_degrades_under_noisy_oracle_without_m15_guard`):**
   - If the active query oracle is corrupted (`oracle_noise_prob = 0.75`) and the M15 validation guard is disabled (`use_validation_guard = False`), hard version-space elimination discards the true rule whenever a queried boundary scene returns a flipped label. Across 30 seeds on Regime B (`train_size = 6`), held-out accuracy drops from **`0.8167 ± 0.0688`** (`passive_no_query`) down to **`0.7250 ± 0.0734`** (**`-0.0917` degradation**).
2. **When M14 Skill Memory Provides Zero Benefit (`m14_zero_gain_and_search_overhead_under_irrelevant_skills`):**
   - When `SkillMemory` is populated with verified unary skills from Regime A (`exists_color_size_ge`, `parity_sum_charge`) but the target task is `C1_heldout_translatable` (pairwise relational graph rules), M14 skill composition yields **`0.0000` accuracy gain** (`1.0000` vs `1.0000`) while evaluating an average of **`+7.67` extra candidates** per task.
3. **Why Regime `C2_heldout_unidentifiable` Cannot Be Solved (`held_out_accuracy = 0.4880`):**
   - Because the true rule in `C2` is a non-local ternary cyclic triad parity rule outside the hypothesis grammar, every candidate in the grammar has an expected true accuracy of `~0.50`.
   - `bounded_enumerative_search` (which lacks the M15 validation guard) finds spurious depth-2 rules that achieve high accuracy on the 10 training examples, reporting `status = "identified"` (`0%` abstention) while collapsing to `0.4991` on held-out test scenes.
   - `ri_full` detects the train/validation discrepancy and flags `status = "unidentified_high_uncertainty"` (`abstained = True`) on **`29/30` seeds (`96.67%`)**, with only `1/30` seed (`3.33%`) passing the `0.81` validation threshold by chance on a 10-scene validation split.

---

## 8. Known Limitations and Recommendations for M17

- **Bounded Primitive Vocabulary:** While `E9` generalizes across unseen operator combinations (`A`), unseen object counts (`B`), and held-out pairwise relational primitives (`C1`), it cannot invent a brand-new primitive operator when facing an out-of-grammar rule class (`C2`); it can only detect its own high uncertainty and abstain.
- **Recommendation for M17 (Program-Guided Primitive Invention Upon Abstention):**
  When `RIRelationalAgent` triggers `status = "unidentified_high_uncertainty"` across multiple related tasks (as in `C2`), introduce a guarded, type-checked sub-primitive synthesis step that proposes a new relational quantifier (such as ternary tuple aggregation) in a sandboxed staging memory and promotes it only if it passes a multi-split held-out generalization gate.
