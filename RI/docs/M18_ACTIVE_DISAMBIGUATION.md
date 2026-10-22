# M18 — Active Disambiguation & Experimental Intervention (`E11`)

## 1. Research Question

**Central Question:** When multiple candidate hypotheses in a relational DSL are 100% consistent with all passive training observations (`confounded_ambiguous_twin` in M17), can RI autonomously select targeted, admissible experimental scene interventions that maximize expected information gain, update its hypothesis space exclusively from observed responses, recognize syntactic equivalence vs. genuine unidentifiability, and integrate seamlessly with the M17 6-stage safety gate (`Candidate` → `Disambiguation` → `Validation` → `Adversarial Checks` → `Quarantine` → `Promotion` / `Rollback`) without accessing test labels or promoting uncorroborated rules?

---

## 2. Repository Analysis: Reused vs. New Components

### 2.1 Reused Foundations from M16 (`E9`) and M17 (`E10`)
- **Relational Object-Scene DSL:** Variable-size object multisets (`objects: List[Dict[str, int]]` with `color in (0, 1, 2)`, `size in (1..6)`, `charge in (0, 1)`, `pos in (0..11)`), `validate_scene_objects`, `strip_labels`, and order-invariant `scene_canonical_key`.
- **Base & Sub-Primitive Evaluators:** M16 unary/global primitives (`eval_m16_base_primitive`), M17 relational sub-primitives (`eval_subprimitive_dsl`, `CandidateRuleAST`), and structural invariance audits (`check_permutation_invariance`, `check_large_size_support`).
- **M17 6-Stage Guarded Skill Memory:** `GuardedSkillLibrary`, `SubPrimitiveLifecycleRecord`, `ActiveSkillEntry`, pre-promotion snapshots, unit-test verification, and deterministic `rollback()`.

### 2.2 New M18 Components (`RI/experiments/E11_active_disambiguation/`)
1. **`ExperimentalInterventionOracle` (`environment.py`):** Explicit boundary between agent intervention selection and environment observation. Enforces admissible intervention constraints (\(N \in [2, 6]\), `pos in [0..7]`), rejects duplicate scenes already present in `observed_keys`, enforces a hard `budget`, and supports controlled observation noise without exposing validation/test splits or the ground-truth AST.
2. **`InterventionSceneGenerator` (`environment.py`):** Synthesizes a bounded pool of up to `48` admissible, unlabeled experimental scenes (`split2v2_*` orthogonal Hadamard axes, `isolate_H*` single-hypothesis isolators, pairwise delta/dipole/triad probes, and high-diversity decoy scenes) strictly from the scene DSL.
3. **`SemanticEquivalenceChecker` (`agent.py`):** Partitions surviving syntactic hypotheses into semantic equivalence classes over `CANONICAL_PROBE_SCENES` plus all admissible candidate intervention scenes, selecting the minimal-complexity canonical representative per class.
4. **`ActiveDisambiguator` (`agent.py`):** Implements expected Shannon entropy reduction (`expected_information_gain`), deterministic tie-breaking, and both noiseless version-space elimination and noise-tolerant Bayesian/corroboration-margin updating.
5. **`M18ActiveDisambiguationAgent` (`agent.py`):** Integrates active disambiguation with the M17 validation, adversarial invariance, regression (locked M16 + locked M17 suites), quarantine, promotion, and rollback gates, plus read-only memory protection against the `no_m17_guard` ablation.

---

## 3. Formal Active Disambiguation Architecture

```text
Hypothesenmenge (H_0) -> Äquivalenzprüfung (C_0) -> Informative Experimente (X_cand)
  -> Auswahl (argmax IG) -> Beobachtung (Oracle) -> Hypothesenaktualisierung (H_t)
  -> Unabhängige Validierung (M17 Stage 2) & Adversarial Checks (M17 Stage 3)
  -> Promotion (Stage 5) oder Abstention & Quarantine (Stage 4) / Rollback (Stage 6)
```

### 3.1 Information Value Metric (`expected_information_gain`)
Let \(\mathcal{C}_t = \{c_1, \dots, c_K\}\) be the surviving semantic equivalence classes at step \(t\) with normalized prior weights \(w_k = P(c_k \mid D_{1:t-1})\) (\(\sum_{k=1}^K w_k = 1\), uniform \(w_k = 1/K\) at \(t = 0\)). The prior Shannon entropy is:
\[H(w) = -\sum_{k=1}^K w_k \log_2 w_k\]
For any admissible candidate scene \(x \in \mathcal{X}_{\text{cand}}\), each canonical representative \(c_k\) predicts \(\hat{y}_k(x) \in \{0, 1\}\). Under observation noise parameter \(\epsilon \in [0, 0.5)\) (\(\epsilon = 0.0\) in noiseless mode, \(\epsilon = 0.20\) in noisy mode):
\[P(Y = y \mid c_k, x) = \begin{cases} 1 - \epsilon & \text{if } \hat{y}_k(x) = y \\ \epsilon & \text{if } \hat{y}_k(x) \ne y \end{cases}\]
The marginal observation probability is \(P(Y = y \mid x) = \sum_{k=1}^K w_k P(Y = y \mid c_k, x)\), and the posterior weight vector given \(Y = y\) is \(w_k^{(y)} = \frac{w_k P(Y = y \mid c_k, x)}{P(Y = y \mid x)}\). The expected information gain (mutual information in bits) is:
\[\text{IG}(x; \mathcal{C}_t) = \max\left(0, \; H(w) - \sum_{y \in \{0, 1\}} P(Y = y \mid x) H\left(w^{(y)}\right)\right)\]
In the noiseless case (\(\epsilon = 0\)) with uniform weights over \(K\) classes where \(K_1\) predict `1` and \(K_0 = K - K_1\) predict `0`, \(\text{IG}(x) = H_{\text{binary}}(K_1 / K) \in [0, 1]\), which is maximized (\(\text{IG} = 1.0\) bit) by balanced `2-vs-2` (`K/2 vs K/2`) splits.

### 3.2 Deterministic Tie-Breaking Rule
When multiple candidate scenes \(x \in \mathcal{X}_{\text{cand}}\) achieve identical \(\text{IG}(x)\) (up to \(10^{-9}\)), `select_intervention` breaks ties deterministically via the tuple:
1. `1 if ig > 1e-9 else 0` (strictly positive information gain required),
2. `round(ig, 9)` (highest expected entropy reduction),
3. `-len(objects)` (smallest, minimal experimental scene),
4. `len({(o["color"], o["size"]) for o in objects})` (non-degenerate attribute diversity),
5. Lexicographically smallest `scene_canonical_key(objects)` (order-invariant canonical tuple, 100% independent of list ordering or test labels).

### 3.3 Behavior When No Distinguishing Intervention Exists (\(\max_x \text{IG}(x) = 0\))
- **Case 1 — Semantic Equivalence (`C_semantically_equivalent`):** All surviving syntactic hypotheses belong to a single semantic equivalence class (\(|\mathcal{C}_t| = 1, |\mathcal{H}_t| \ge 2\)). RI logs `equivalence_detected = True`, records all equivalent syntax expressions, sets `uniquely_identified_single_syntax = False` (never claiming one syntax form was empirically separated from its equivalent twin), stops immediately without wasting remaining intervention budget, and validates the canonical representative.
- **Case 2 — Unidentifiable Ambiguity (`D_unidentifiable_ambiguity`):** Multiple distinct semantic classes remain (\(|\mathcal{C}_t| \ge 2\)), but \(\max_{x \in \mathcal{X}_{\text{cand}}} \text{IG}(x) = 0.0\) because all admissible interventions in the constrained search space couple the distinguishing attributes. RI immediately stops (`interventions_used = 0`, `stopped_reason = "no_distinguishing_intervention_in_search_space"`), logs the remaining competing hypotheses, abstains (`abstained = True`), and quarantines (`promoted = False`).

### 3.4 Noisy Observation Update & Plotkin Corroboration Bound (`B_noisy_observations`)
Under noisy observations (\(\epsilon = 0.20\)), a single observation flip would cause naive hard elimination to discard the true hypothesis. RI therefore tracks match counts \(c_k\) and mismatch counts \(m_k\) per equivalence class, updates Bayesian weights \(w_k \propto (1-\epsilon)^{c_k}\epsilon^{m_k}\), tolerates up to `max_noisy_mismatches = 1`, and requires a **corroboration margin**:
\[\min_{j \ne k^*} \left(c_{k^*} - c_j\right) \ge \text{min\_noisy\_corroboration\_margin} = 2 \quad \text{and} \quad m_{k^*} \le 1\]
By the Plotkin bound in coding theory, for \(M = 4\) competing hypotheses to achieve a pairwise Hamming distance \(d_{\min} \ge 4\) (so that after 1 adversarial bit flip the true hypothesis still leads every rival by \(\ge 2\) matches), at least \(n = 6\) binary queries across the 3 orthogonal Hadamard `2-vs-2` axes are required (\(\lfloor 4n / \binom{4}{2} \rfloor = \lfloor 2n/3 \rfloor \ge 4 \implies n \ge 6\)).
- In **`B1_recoverable_single_flip`** (`even seeds`, `budget = 6`, first observation flipped): RI overrides the initial contradictory flip using 3 Hadamard `2-vs-2` axes + corroborating queries, reaching `corroboration_margin = 2` on `15/15` seeds.
- In **`B2_unresolvable_contradictory_noise`** (`odd seeds`, `budget = 2`, alternating flips): No hypothesis can reach `corroboration_margin >= 2`; RI refuses to adopt a rule from a single contradictory observation, abstaining and quarantining on `15/15` seeds.

### 3.5 Methodological Limitations of the Metric
1. **Uniform Class Prior:** `expected_information_gain` assumes a uniform prior over surviving equivalence classes at \(t = 0\); if complexity priors were strongly skewed, one-step myopic entropy could differ from multi-step optimal decision trees.
2. **Myopic One-Step Lookahead:** Greedy maximization of one-step mutual information is optimal for dyadic splits (`2-vs-2` on 4 classes), but in arbitrary non-dyadic hypothesis spaces myopic selection can be suboptimal by a constant factor compared to full dynamic programming.
3. **Finite Equivalence Probing:** Semantic equivalence is decided over `CANONICAL_PROBE_SCENES` (`48` scenes across \(N \in [2, 11]\)) plus all `48` task candidate scenes (`96` scenes total); for unrestricted Turing-complete languages equivalence is undecidable.

---

## 4. Five Task Families in `E11_active_disambiguation`

1. **`A_identifiable_competing_rules`:** 4 semantically distinct relational rules (`forall_color_charged(1,1)`, `forall_color_charged(2,1)`, `pair_same_color_charged(1)`, `pair_same_size_charged(3)`) match 100% of `train_examples`. Resolved by 2 informative interventions (`2.0` bits entropy reduction).
2. **`B_noisy_observations`:** Controlled noisy intervention oracle (`B1` single early flip with `budget = 6`; `B2` contradictory flips with `budget = 2` and corrupted validation).
3. **`C_semantically_equivalent`:** Syntactically distinct equivalent pairs (`forall_color_charged` \(\equiv\) `no_color_opposite_charge`, `pair_color_size_delta` \(\equiv\) `converse_pair_size_deficit`, `pair_proximal_dipole` \(\equiv\) `symmetric_charge_split_within_gap`) confounded on `train_examples` with non-equivalent competitors.
4. **`D_unidentifiable_ambiguity`:** `forall_color_charged(1,1)` vs `forall_color_charged(2,1)` under a color-coupled intervention constraint (`coupled_colors = (1, 2)`) where \(\max_x \text{IG}(x) = 0.0\).
5. **`E_adversarial_heuristic_trap`:** Candidate pool prepended with 6 rich 6-object decoy scenes (all 3 colors, 6 distinct sizes, `IG = 0.0`) that fool surface complexity/diversity heuristics (`fixed_heuristic`, `no_active_selection`), alongside compact 3-object `IG = 1.0` bit splitters.

---

## 5. Measured Benchmark Results (30 Seeds, 150 Main Tasks + 150 Locked Regression Tasks)

*Provenance:* Executed across 30 seeds (`0..29`). Artifacts written to `RI/experiments/E11_active_disambiguation/results/results.json`, `RI/results/m18_summary.json`, and `RI/results/m18_ablation_results.json`. All rate/probability 95% confidence intervals are clamped to \([0.0, 1.0]\).

### 5.1 Overall Comparison Across All 7 Systems (30 Seeds)

| System / Ablation | Identifiable Rule ID Rate (`num/den`, 95% CI) | Identifiable Held-Out Acc (95% CI) | Unidentifiable Abstention Rate (`num/den`) | False ID Rate (`num/den`) | Mean Interventions Used | Distinguishing Intervention Rate (`num/den`) | Mean Expected IG / Step (bits) | Cumulative Entropy Reduction (bits) | Equivalence Handling Rate (`num/den`) | Noisy Robustness Rate (`num/den`) | False Promotion Rate (`num/den`) | Rollbacks (`ok/fail`) | M16/M17 Regression Rate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **`ri_full`** | **`1.0000`** (`75/75`, `[1.00, 1.00]`) | **`1.0000`** (`[1.00, 1.00]`) | **`1.0000`** (`45/45`) | **`0.0000`** (`0/150`) | **`1.53`** | **`0.9348`** (`215/230`) | **`0.6675`** | **`166.81`** (`1.11`/task) | **`1.0000`** (`30/30`) | **`1.0000`** (`30/30`) | **`0.0000`** (`0/150`) | **`30/0`** (`1.00`) | **`0.0000`** (`0/30`) |
| `random_intervention` | `0.3867` (`29/75`, `[0.28, 0.50]`) | `0.7700` (`[0.73, 0.81]`) | `1.0000` (`45/45`) | `0.0000` (`0/150`) | `2.96` | `0.4054` (`180/444`) | `0.2922` | `123.02` (`0.82`/task) | `0.3333` (`10/30`) | `0.5333` (`16/30`) | `0.0000` (`0/150`) | `20/0` (`1.00`) | `0.0000` (`0/30`) |
| `fixed_heuristic` | `0.0000` (`0/75`, `[0.00, 0.00]`) | `0.6215` (`[0.60, 0.64]`) | `1.0000` (`45/45`) | `0.0000` (`0/150`) | `3.20` | `0.0521` (`25/480`) | `0.0272` | `11.40` (`0.08`/task) | `0.0000` (`0/30`) | `0.5000` (`15/30`) | `0.0000` (`0/150`) | `0/0` (`1.00`) | `0.0000` (`0/30`) |
| `no_active_selection` | `0.0000` (`0/75`, `[0.00, 0.00]`) | `0.6215` (`[0.60, 0.64]`) | `1.0000` (`45/45`) | `0.0000` (`0/150`) | `3.20` | `0.0833` (`40/480`) | `0.0379` | `19.30` (`0.13`/task) | `0.0000` (`0/30`) | `0.5000` (`15/30`) | `0.0000` (`0/150`) | `0/0` (`1.00`) | `0.0000` (`0/30`) |
| `no_equivalence_check` | `0.4000` (`30/75`, `[0.29, 0.51]`) | `0.7663` (`[0.72, 0.81]`) | `1.0000` (`45/45`) | `0.0000` (`0/150`) | `1.93` | `0.8966` (`260/290`) | `0.6700` | `196.65` (`1.31`/task) | **`0.0000`** (`0/30`) | `0.5000` (`15/30`) | `0.0000` (`0/150`) | `30/0` (`1.00`) | `0.0000` (`0/30`) |
| `no_m17_guard` *(isolated)* | `0.8000` (`60/75`, `[0.71, 0.89]`) | `0.8952` (`[0.85, 0.94]`) | **`0.0000`** (`0/45`) | **`0.4000`** (`60/150`) | `1.67` | `1.0000` (`250/250`) | `0.9967` | `245.85` (`1.64`/task) | `1.0000` (`30/30`) | **`0.0000`** (`0/30`) | **`0.4000`** (`60/150`) | `0/0` (`1.00`) | `0.0000` (`0/30`) |
| `oracle_upper_bound` *(analysis)* | `1.0000` (`75/75`, `[1.00, 1.00]`) | `1.0000` (`[1.00, 1.00]`) | `1.0000` (`45/45`) | `0.0000` (`0/150`) | **`0.77`** | `1.0000` (`115/115`) | `0.9329` | `209.77` (`1.40`/task) | `1.0000` (`30/30`) | `1.0000` (`30/30`) | `0.0000` (`0/150`) | `0/0` (`1.00`) | `0.0000` (`0/30`) |

### 5.2 Per-Family Breakdown for `ri_full` (30 Seeds per Family)

| Task Family | Exact Rule ID Rate (`num/den`) | Abstention Rate (`num/den`) | Held-Out Accuracy (95% CI) | Mean Interventions Used | Mean Entropy Reduction (bits) | False Promotions (`num/den`) |
| --- | --- | --- | --- | --- | --- | --- |
| **`A_identifiable_competing_rules`** | **`1.0000`** (`30/30`) | `0.0000` (`0/30`) | **`1.0000 [1.0000, 1.0000]`** | `2.00` (budget `3`) | `2.0000` | `0/30` (`0.0000`) |
| **`B_noisy_observations` (All 30)** | **`0.5000`** (`15/30` — `15/15` on `B1`) | **`0.5000`** (`15/30` — `15/15` on `B2`) | **`0.7981 [0.7201, 0.8762]`** (`1.0000` on `B1`) | `3.50` (`5.0` on `B1`, `2.0` on `B2`) | `1.3742` | `0/30` (`0.0000`) |
| **`C_semantically_equivalent`** | **`1.0000`** (`30/30` canonical) | `0.0000` (`0/30`) | **`1.0000 [1.0000, 1.0000]`** | `2.00` (eliminates competitors, `0` wasted on twin) | `1.9924` | `0/30` (`0.0000`) |
| **`D_unidentifiable_ambiguity`** | `0.0000` (`0/30`, unidentifiable) | **`1.0000`** (`30/30`) | `0.4111 [0.3829, 0.4393]` (base fallback) | **`0.00`** (stops immediately on `IG=0`) | `0.0000` | `0/30` (`0.0000`) |
| **`E_adversarial_heuristic_trap`** | **`1.0000`** (`30/30`) | `0.0000` (`0/30`) | **`1.0000 [1.0000, 1.0000]`** | `2.00` (ignores all 6 `IG=0` decoys) | `2.0000` | `0/30` (`0.0000`) |

---

## 6. Reproducible Commands

```bash
# 1. Run M18 (E11) unit, safety, anti-leakage, and end-to-end tests (15 tests)
cd RI/experiments/E11_active_disambiguation
python3 -B -m unittest -v

# 2. Run 30-seed E11 benchmark and generate results.json, m18_summary.json, m18_ablation_results.json
python3 evaluate.py --seeds $(seq 0 29) --train-size 16 --val-size 14 --independent-size-val 14 --test-size 36 --intervention-budget 3 --output results/results.json

# 3. Run the complete RI validation suite (E2–E11 + top-level tests + M10–M15 prototype)
cd /workspace
python3 RI/run_experiments.py
```

---

## 7. Known Limitations and Recommendation for M19

1. **Bounded Scene Intervention Space:** Experimental interventions are synthesized within a typed relational DSL (\(N \in [2, 6]\), `pos in [0..7]`, `48` candidate scenes per task). While this cleanly separates informative interventions from surface-complex decoys, it does not synthesize open-ended physical experiments outside the scene grammar.
2. **Recommendation for M19 (Adaptive Sequential Confidence Bounds for Stopping & Abstention):** In M18, noisy corroboration uses a pre-registered integer match margin (`min_noisy_corroboration_margin = 2`, `max_noisy_mismatches = 1`) and fixed validation accuracy gates (`0.85`). M19 should replace fixed thresholds with sequential concentration / likelihood-ratio stopping bounds (e.g., Wald SPRT / empirical Bernstein bounds) that adapt the required intervention count to the empirical noise variance online.
