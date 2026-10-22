"""M18 (E11) — Evaluation, Baselines, Ablations, Oracle Upper Bound Analysis, and Artifact Generation.

Compares 7 systems across 30 seeds on identical admissible scenes, budgets, and data splits:
  1. ri_full: Active Disambiguation + Equivalence Check + Corroborated Uncertainty + M17 Guard
  2. random_intervention: Deterministically seeded random intervention selection + M17 Guard
  3. fixed_heuristic: Pre-registered surface diversity/complexity heuristic + M17 Guard
  4. no_active_selection: Selection without information value calculation + M17 Guard
  5. no_equivalence_check: Active Disambiguation without semantic equivalence check + M17 Guard
  6. no_m17_guard: Isolated non-productive ablation without M17 validation/adversarial/ambiguity guard
  7. oracle_upper_bound: Post-hoc analysis-only upper bound on information value (never enters RI decision path)
"""
import argparse
import json
import math
from pathlib import Path
from statistics import mean, stdev
import subprocess
import time
from typing import Any, Dict, List, Optional, Tuple

from agent import (
    CANONICAL_PROBE_SCENES,
    PRE_REGISTERED_M18_GATE,
    ActiveDisambiguator,
    CandidateRuleAST,
    GuardedSkillLibrary,
    M18ActiveDisambiguationAgent,
    SemanticEquivalenceChecker,
    check_large_size_support,
    check_permutation_invariance,
    truth_table_signature,
)
from environment import (
    TASK_FAMILIES,
    ActiveDisambiguationWorld,
    ExperimentalInterventionOracle,
    M18TaskRule,
    scene_canonical_key,
    strip_labels,
)

EXPERIMENT_VERSION = "M18.E11.v1"

METHODS = (
    "ri_full",
    "random_intervention",
    "fixed_heuristic",
    "no_active_selection",
    "no_equivalence_check",
    "no_m17_guard",
    "oracle_upper_bound",
)

METRIC_DEFINITIONS = {
    "identifiable_exact_rule_identification_rate": (
        "Fraction of identifiable tasks (A, B1_recoverable_noise, E) where the system does not abstain "
        "and selects a rule functionally identical to the ground-truth target rule across all canonical probes and held-out test scenes."
    ),
    "unidentifiable_abstention_rate": (
        "Fraction of unidentifiable or unresolvable tasks (D_unidentifiable_ambiguity and B2_unresolvable_contradictory_noise) "
        "where the system rightly abstains and blocks promotion."
    ),
    "false_identification_rate": (
        "Fraction of all tasks where the system claims identification (abstained == False) but either the task is "
        "unidentifiable or the selected rule disagrees with ground truth."
    ),
    "mean_interventions_used": (
        "Mean number of experimental intervention scenes queried from ExperimentalInterventionOracle per task."
    ),
    "distinguishing_intervention_rate": (
        "Fraction of executed interventions that reduced the surviving hypothesis count or posterior Shannon entropy."
    ),
    "mean_expected_information_gain_bits": (
        "Mean expected Shannon entropy reduction IG(x; H_t) in bits per executed intervention."
    ),
    "cumulative_entropy_reduction_bits": (
        "Sum (and per-task mean) of realized Shannon entropy reductions (H_0 - H_final) in bits across tasks."
    ),
    "semantic_equivalence_handling_rate": (
        "Fraction of Family C tasks where semantically equivalent syntax pairs are detected and resolved to their "
        "canonical representative with 0 unnecessary interventions and without claiming unique single-syntax separation."
    ),
    "noisy_observation_robustness_rate": (
        "Fraction of Family B tasks handled according to uncertainty rules: recovering the exact rule via multi-step "
        "corroboration on B1_recoverable_single_flip and abstaining/quarantining on B2_unresolvable_contradictory_noise."
    ),
    "false_promotion_rate": (
        "Fraction of tasks where an unvalidated, ambiguous, unidentifiable, or false rule is promoted."
    ),
    "rollback_success_rate": (
        "Fraction of rollback verification drills that restore the exact prior GuardedSkillLibrary version and active skill list."
    ),
    "m16_m17_regression_rate": (
        "Fraction of seeds with any accuracy drop (> 0.0) on locked M16 or M17 regression suites after M18 promotions."
    ),
}


def get_git_commit_hash() -> str:
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=Path(__file__).resolve().parent,
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
        return out if out else "unknown"
    except Exception:
        return "unknown"


def clamped_ci95(values: List[float], clamp_unit: bool = True) -> Dict[str, float]:
    """Compute mean, std, and 95% confidence interval clamped to [0.0, 1.0] for probabilities/rates."""
    if not values:
        return {
            "mean": 0.0,
            "std": 0.0,
            "ci95_half_width": 0.0,
            "ci95_low": 0.0,
            "ci95_high": 0.0,
        }
    m = mean(values)
    if len(values) < 2:
        s = 0.0
        hw = 0.0
    else:
        s = stdev(values)
        hw = 1.96 * s / math.sqrt(len(values))
    lo = m - hw
    hi = m + hw
    if clamp_unit:
        lo = max(0.0, min(1.0, lo))
        hi = max(0.0, min(1.0, hi))
        m = max(0.0, min(1.0, m))
    return {
        "mean": round(m, 6),
        "std": round(s, 6),
        "ci95_half_width": round(hw, 6),
        "ci95_low": round(lo, 6),
        "ci95_high": round(hi, 6),
    }


def rate_with_counts(flags: List[bool]) -> Dict[str, Any]:
    """Return numerator, denominator, and clamped 95% CI stats for a binary rate."""
    num = sum(1 for f in flags if f)
    den = len(flags)
    float_vals = [float(bool(f)) for f in flags]
    stats = clamped_ci95(float_vals, clamp_unit=True)
    return {
        "numerator": num,
        "denominator": den,
        **stats,
    }


def score_predictions(preds: List[int], labeled_examples: List[Dict[str, Any]]) -> float:
    if not labeled_examples:
        return 0.0
    return mean(int(p == int(e["label"])) for p, e in zip(preds, labeled_examples))


def is_exact_semantic_match(
    cand: Optional[CandidateRuleAST],
    ground_truth: M18TaskRule,
    test_examples: List[Dict[str, Any]],
) -> bool:
    if cand is None:
        return False
    for scene in CANONICAL_PROBE_SCENES:
        if cand.predict_scene_unchecked(scene) != ground_truth.evaluate(scene):
            return False
    for item in test_examples:
        if cand.predict_scene_unchecked(item["objects"]) != int(item["label"]):
            return False
    return True


def run_oracle_upper_bound_on_task(
    task: Dict[str, Any],
    seed: int,
) -> Dict[str, Any]:
    """Post-hoc analysis-only Oracle Upper Bound on achievable information gain and accuracy.

    Uses privileged knowledge of the ground-truth rule ONLY inside this evaluation-side analysis
    function to select the single intervention scene that isolates the true semantic class in 1 step
    (whenever such a scene exists in the admissible pool). Never enters `M18ActiveDisambiguationAgent`.
    """
    helper = M18ActiveDisambiguationAgent(seed=seed)
    train_ex = task["train_examples"]
    dsl_pool = helper.synthesizer.synthesize_subprimitive_candidates(include_equivalent_twins=True)
    passing = [
        c
        for c in dsl_pool
        if helper._accuracy(c, train_ex) >= PRE_REGISTERED_M18_GATE["min_train_accuracy"]
        and check_permutation_invariance(c)
        and check_large_size_support(c)
    ]
    if not passing:
        passing = [dsl_pool[0]]

    initial_keys = {scene_canonical_key(e["objects"]) for e in train_ex}
    admissible_scenes = helper.scene_generator.generate_admissible_scenes(
        observed_keys=initial_keys,
        seed=seed,
        include_adversarial_decoys=bool(task.get("include_adversarial_decoys", False)),
        coupled_colors=task.get("coupled_colors"),
    )
    checker = SemanticEquivalenceChecker()
    classes = checker.partition(passing, extra_scenes=[s["objects"] for s in admissible_scenes])
    init_sem = len(classes)
    init_ent = math.log2(init_sem) if init_sem > 1 else 0.0

    gt_rule: M18TaskRule = task["ground_truth_rule"]
    gt_sig = tuple(gt_rule.evaluate(s) for s in CANONICAL_PROBE_SCENES)

    if not task["identifiable"]:
        # Even the oracle upper bound knows when no distinguishing intervention exists in the search space
        base_cands = helper.synthesizer.generate_m16_base_grammar(include_depth2=True)
        best_base = max(base_cands, key=lambda c: (helper._accuracy(c, train_ex), -c.complexity))
        preds_all = best_base.predict_all(strip_labels(task["test_examples"]))
        return {
            "held_out_accuracy": score_predictions(preds_all, task["test_examples"]),
            "exact_rule_identified": False,
            "abstained": True,
            "false_identification": False,
            "promoted": False,
            "false_promotion": False,
            "equivalence_correctly_handled": False,
            "noisy_correctly_handled": (task["family"] == "B_noisy_observations"),
            "interventions_used": 0,
            "n_distinguishing_interventions": 0,
            "expected_ig_sum": 0.0,
            "realized_entropy_reduction_bits": 0.0,
            "n_candidate_scenes_evaluated": len(admissible_scenes),
            "n_hypothesis_candidates_evaluated": len(dsl_pool),
            "status": "oracle_abstained_unidentifiable",
            "selected_expression": best_base.format_dsl(),
        }

    # Find canonical class matching ground truth
    true_class = next(
        (ec for ec in classes if truth_table_signature(ec.canonical) == gt_sig),
        classes[0],
    )
    if init_sem == 1:
        preds_all = true_class.canonical.predict_all(strip_labels(task["test_examples"]))
        return {
            "held_out_accuracy": score_predictions(preds_all, task["test_examples"]),
            "exact_rule_identified": True,
            "abstained": False,
            "false_identification": False,
            "promoted": True,
            "false_promotion": False,
            "equivalence_correctly_handled": len(true_class.members) > 1,
            "noisy_correctly_handled": (task["family"] == "B_noisy_observations"),
            "interventions_used": 0,
            "n_distinguishing_interventions": 0,
            "expected_ig_sum": 0.0,
            "realized_entropy_reduction_bits": 0.0,
            "n_candidate_scenes_evaluated": 0,
            "n_hypothesis_candidates_evaluated": len(dsl_pool),
            "status": "oracle_equivalent_resolved",
            "selected_expression": true_class.canonical.format_dsl(),
        }

    # Oracle lookahead: check if a single scene in admissible_scenes uniquely isolates true_class!
    isolated_in_one = False
    reps = [ec.canonical for ec in classes]
    uniform_w = [1.0 / len(reps) for _ in reps]
    best_one_step_ig = 0.0
    for s_item in admissible_scenes:
        objs = s_item["objects"]
        true_pred = true_class.canonical.predict_scene_unchecked(objs)
        matching = [ec for ec in classes if ec.canonical.predict_scene_unchecked(objs) == true_pred]
        if len(matching) == 1:
            isolated_in_one = True
            best_one_step_ig = ActiveDisambiguator.expected_information_gain(reps, uniform_w, objs)
            break

    steps_needed = 1 if isolated_in_one else 2
    preds_all = true_class.canonical.predict_all(strip_labels(task["test_examples"]))
    return {
        "held_out_accuracy": score_predictions(preds_all, task["test_examples"]),
        "exact_rule_identified": True,
        "abstained": False,
        "false_identification": False,
        "promoted": True,
        "false_promotion": False,
        "equivalence_correctly_handled": len(true_class.members) > 1,
        "noisy_correctly_handled": (task["family"] == "B_noisy_observations"),
        "interventions_used": steps_needed,
        "n_distinguishing_interventions": steps_needed,
        "expected_ig_sum": best_one_step_ig if isolated_in_one else init_ent,
        "realized_entropy_reduction_bits": init_ent,
        "n_candidate_scenes_evaluated": len(admissible_scenes),
        "n_hypothesis_candidates_evaluated": len(dsl_pool),
        "status": "oracle_upper_bound_identified",
        "selected_expression": true_class.canonical.format_dsl(),
    }


def build_agent_for_method(
    method: str,
    seed: int,
    productive_library: Optional[GuardedSkillLibrary] = None,
) -> Optional[M18ActiveDisambiguationAgent]:
    if method == "ri_full":
        return M18ActiveDisambiguationAgent(
            selection_policy="information_gain",
            use_equivalence_check=True,
            use_m17_guard=True,
            productive_library=productive_library,
            seed=seed,
        )
    if method == "random_intervention":
        return M18ActiveDisambiguationAgent(
            selection_policy="random_intervention",
            use_equivalence_check=True,
            use_m17_guard=True,
            productive_library=productive_library,
            seed=seed,
        )
    if method == "fixed_heuristic":
        return M18ActiveDisambiguationAgent(
            selection_policy="fixed_heuristic",
            use_equivalence_check=True,
            use_m17_guard=True,
            productive_library=productive_library,
            seed=seed,
        )
    if method == "no_active_selection":
        return M18ActiveDisambiguationAgent(
            selection_policy="no_active_selection",
            use_equivalence_check=True,
            use_m17_guard=True,
            productive_library=productive_library,
            seed=seed,
        )
    if method == "no_equivalence_check":
        return M18ActiveDisambiguationAgent(
            selection_policy="information_gain",
            use_equivalence_check=False,
            use_m17_guard=True,
            productive_library=productive_library,
            seed=seed,
        )
    if method == "no_m17_guard":
        return M18ActiveDisambiguationAgent(
            selection_policy="information_gain",
            use_equivalence_check=True,
            use_m17_guard=False,
            productive_library=productive_library,
            seed=seed,
        )
    if method == "oracle_upper_bound":
        return None
    raise ValueError(f"unknown method: {method}")


def run_method_on_bundle(method: str, bundle) -> Dict[str, Any]:
    start = time.perf_counter()

    if method == "oracle_upper_bound":
        task_results: Dict[str, Any] = {}
        for fam in TASK_FAMILIES:
            t = bundle.tasks_by_family[fam]
            task_results[fam] = run_oracle_upper_bound_on_task(t, seed=bundle.seed)
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        return {
            "tasks": task_results,
            "m16_regression_drop": 0.0,
            "m17_regression_drop": 0.0,
            "successful_rollbacks": 0,
            "failed_rollbacks": 0,
            "rollback_drill_passed": True,
            "productive_memory_mutated_by_ablation": False,
            "active_skills_count": 0,
            "runtime_ms": round(elapsed_ms, 4),
        }

    # For `no_m17_guard`, pass a read-only productive library to prove 0 mutation of productive SkillMemory.
    shared_prod_lib: Optional[GuardedSkillLibrary] = None
    if method == "no_m17_guard":
        shared_prod_lib = GuardedSkillLibrary(read_only_guard=True)

    agent = build_agent_for_method(method, bundle.seed, productive_library=shared_prod_lib)
    assert agent is not None
    agent.lock_regression_suites(
        bundle.locked_m16_regression_tasks,
        bundle.locked_m17_regression_tasks,
    )
    agent.acquire_warmup_base_skills(bundle.base_warmup_tasks)

    task_results = {}
    for fam in TASK_FAMILIES:
        t = bundle.tasks_by_family[fam]
        outcome = agent.solve_task(
            t,
            m16_regression_tasks=bundle.locked_m16_regression_tasks,
            m17_regression_tasks=bundle.locked_m17_regression_tasks,
        )
        sel: CandidateRuleAST = outcome["selected_candidate"]
        preds_all = sel.predict_all(strip_labels(t["test_examples"]))
        acc_all = score_predictions(preds_all, t["test_examples"])
        exact_match = is_exact_semantic_match(sel, t["ground_truth_rule"], t["test_examples"])

        abstained = bool(outcome["abstained"])
        promoted = bool(outcome["promoted"])
        identifiable = bool(t["identifiable"])
        disambig = outcome["disambiguation"]

        exact_identified = identifiable and (not abstained) and exact_match
        false_identified = (not abstained) and ((not identifiable) or (not exact_match))
        false_promoted = promoted and ((not bool(t["should_promote"])) or (not exact_match))

        eq_handled = (
            fam == "C_semantically_equivalent"
            and bool(outcome["equivalence_detected"])
            and not bool(outcome["uniquely_identified_single_syntax"])
            and disambig.interventions_used == disambig.n_distinguishing_interventions
            and exact_identified
        )
        noisy_handled = fam == "B_noisy_observations" and (
            (identifiable and exact_identified and disambig.corroboration_margin >= 2)
            or ((not identifiable) and abstained and (not promoted))
        )

        rec = outcome["lifecycle_record"]
        task_results[fam] = {
            "held_out_accuracy": acc_all,
            "exact_rule_identified": exact_identified,
            "abstained": abstained,
            "false_identification": false_identified,
            "promoted": promoted,
            "false_promotion": false_promoted,
            "equivalence_correctly_handled": eq_handled,
            "noisy_correctly_handled": noisy_handled,
            "interventions_used": disambig.interventions_used,
            "n_distinguishing_interventions": disambig.n_distinguishing_interventions,
            "expected_ig_sum": sum(s.expected_information_gain_bits for s in disambig.steps),
            "realized_entropy_reduction_bits": disambig.cumulative_entropy_reduction_bits,
            "n_candidate_scenes_evaluated": outcome["n_candidate_scenes_evaluated"],
            "n_hypothesis_candidates_evaluated": outcome["n_hypothesis_candidates_evaluated"],
            "status": outcome["status"],
            "stopped_reason": disambig.stopped_reason,
            "selected_expression": sel.format_dsl(),
            "surviving_expressions": list(disambig.surviving_Expressions),
            "equivalent_expressions": list(disambig.equivalent_expressions),
            "corroboration_margin": disambig.corroboration_margin,
            "rejection_reasons": list(rec.quarantine_or_rejection_reasons) if rec is not None else [],
        }

    m16_drop, m17_drop = agent.compute_regression_drops(
        bundle.locked_m16_regression_tasks,
        bundle.locked_m17_regression_tasks,
    )

    # Stage 6 Rollback Verification Drill on guarded methods that promoted at least one skill:
    successful_rollbacks = 0
    failed_rollbacks = 0
    rollback_drill_passed = True
    if agent.use_m17_guard and agent.library._snapshots:
        ver_before = agent.library.version
        skills_before = list(agent.library.active_skills)
        prom_before = list(agent.library.promoted_records)
        try:
            restored_ver = agent.library.rollback()
            if (restored_ver == ver_before - 1) and (
                len(agent.library.active_skills) == len(skills_before) - 1
            ):
                successful_rollbacks += 1
            else:
                failed_rollbacks += 1
                rollback_drill_passed = False
        except Exception:
            failed_rollbacks += 1
            rollback_drill_passed = False
        # Restore state after verification drill
        agent.library.version = ver_before
        agent.library.active_skills = skills_before
        agent.library.promoted_records = prom_before
        if agent.library.rolled_back_records:
            agent.library.rolled_back_records.pop()

    prod_mutated = False
    if shared_prod_lib is not None:
        prod_mutated = (shared_prod_lib.version != 1) or (len(shared_prod_lib.active_skills) != 0)

    elapsed_ms = (time.perf_counter() - start) * 1000.0
    return {
        "tasks": task_results,
        "m16_regression_drop": m16_drop,
        "m17_regression_drop": m17_drop,
        "successful_rollbacks": successful_rollbacks,
        "failed_rollbacks": failed_rollbacks,
        "rollback_drill_passed": rollback_drill_passed,
        "productive_memory_mutated_by_ablation": prod_mutated,
        "active_skills_count": len(agent.library.active_skills),
        "runtime_ms": round(elapsed_ms, 4),
    }


def aggregate_method(rows: List[Dict[str, Any]], method: str) -> Dict[str, Any]:
    # 1. Identifiable competing-rule tasks: Family A, Family E, and even-seed B1 recoverable noisy tasks
    identifiable_flags: List[bool] = []
    identifiable_accs: List[float] = []
    for r in rows:
        t_map = r["methods"][method]["tasks"]
        for fam in ("A_identifiable_competing_rules", "E_adversarial_heuristic_trap"):
            identifiable_flags.append(bool(t_map[fam]["exact_rule_identified"]))
            identifiable_accs.append(float(t_map[fam]["held_out_accuracy"]))
        if r["seed"] % 2 == 0:  # B1_recoverable_single_flip
            identifiable_flags.append(bool(t_map["B_noisy_observations"]["exact_rule_identified"]))
            identifiable_accs.append(float(t_map["B_noisy_observations"]["held_out_accuracy"]))

    # 2. Unidentifiable / unresolvable tasks: Family D (30 seeds) + odd-seed B2 contradictory noise (15 seeds)
    unidentifiable_abstain_flags: List[bool] = []
    fam_d_abstain_flags: List[bool] = []
    for r in rows:
        t_map = r["methods"][method]["tasks"]
        d_abs = bool(t_map["D_unidentifiable_ambiguity"]["abstained"])
        fam_d_abstain_flags.append(d_abs)
        unidentifiable_abstain_flags.append(d_abs)
        if r["seed"] % 2 == 1:  # B2_unresolvable_contradictory_noise
            unidentifiable_abstain_flags.append(bool(t_map["B_noisy_observations"]["abstained"]))

    # 3. False identification rate across all 150 tasks (30 seeds x 5 families)
    false_id_flags = [
        bool(r["methods"][method]["tasks"][fam]["false_identification"])
        for r in rows
        for fam in TASK_FAMILIES
    ]

    # 4. Interventions used & distinguishing intervention rate
    all_interventions = [
        float(r["methods"][method]["tasks"][fam]["interventions_used"])
        for r in rows
        for fam in TASK_FAMILIES
    ]
    total_interventions = sum(
        int(r["methods"][method]["tasks"][fam]["interventions_used"])
        for r in rows
        for fam in TASK_FAMILIES
    )
    total_distinguishing = sum(
        int(r["methods"][method]["tasks"][fam]["n_distinguishing_interventions"])
        for r in rows
        for fam in TASK_FAMILIES
    )
    per_seed_dist_rates: List[float] = []
    for r in rows:
        s_used = sum(int(r["methods"][method]["tasks"][f]["interventions_used"]) for f in TASK_FAMILIES)
        s_dist = sum(
            int(r["methods"][method]["tasks"][f]["n_distinguishing_interventions"]) for f in TASK_FAMILIES
        )
        per_seed_dist_rates.append((s_dist / s_used) if s_used > 0 else 0.0)

    # 5. Information gain and cumulative entropy reduction
    total_ig_sum = sum(
        float(r["methods"][method]["tasks"][fam]["expected_ig_sum"])
        for r in rows
        for fam in TASK_FAMILIES
    )
    mean_ig_per_intervention = (total_ig_sum / total_interventions) if total_interventions > 0 else 0.0
    all_entropy_red = [
        float(r["methods"][method]["tasks"][fam]["realized_entropy_reduction_bits"])
        for r in rows
        for fam in TASK_FAMILIES
    ]
    cumulative_entropy_red = sum(all_entropy_red)

    # 6. Semantic equivalence handling rate (Family C)
    eq_flags = [
        bool(r["methods"][method]["tasks"]["C_semantically_equivalent"]["equivalence_correctly_handled"])
        for r in rows
    ]

    # 7. Noisy observation robustness (Family B overall + B1 recoverable + B2 contradictory)
    noisy_all_flags = [
        bool(r["methods"][method]["tasks"]["B_noisy_observations"]["noisy_correctly_handled"])
        for r in rows
    ]
    noisy_b1_flags = [
        bool(r["methods"][method]["tasks"]["B_noisy_observations"]["exact_rule_identified"])
        for r in rows
        if r["seed"] % 2 == 0
    ]
    noisy_b2_flags = [
        bool(
            r["methods"][method]["tasks"]["B_noisy_observations"]["abstained"]
            and not r["methods"][method]["tasks"]["B_noisy_observations"]["promoted"]
        )
        for r in rows
        if r["seed"] % 2 == 1
    ]

    # 8. False promotions
    false_prom_all_flags = [
        bool(r["methods"][method]["tasks"][fam]["false_promotion"])
        for r in rows
        for fam in TASK_FAMILIES
    ]
    false_prom_unidentifiable_flags = [
        bool(r["methods"][method]["tasks"]["D_unidentifiable_ambiguity"]["false_promotion"])
        for r in rows
    ] + [
        bool(r["methods"][method]["tasks"]["B_noisy_observations"]["false_promotion"])
        for r in rows
        if r["seed"] % 2 == 1
    ]

    # 9. Rollback statistics & M16/M17 regression
    succ_rollbacks = sum(int(r["methods"][method]["successful_rollbacks"]) for r in rows)
    fail_rollbacks = sum(int(r["methods"][method]["failed_rollbacks"]) for r in rows)
    m16_drops = [float(r["methods"][method]["m16_regression_drop"]) for r in rows]
    m17_drops = [float(r["methods"][method]["m17_regression_drop"]) for r in rows]
    reg_flags = [
        bool(r["methods"][method]["m16_regression_drop"] > 0.0 or r["methods"][method]["m17_regression_drop"] > 0.0)
        for r in rows
    ]

    # 10. Per-family summary
    by_family: Dict[str, Any] = {}
    for fam in TASK_FAMILIES:
        f_acc = [float(r["methods"][method]["tasks"][fam]["held_out_accuracy"]) for r in rows]
        f_id = [bool(r["methods"][method]["tasks"][fam]["exact_rule_identified"]) for r in rows]
        f_abs = [bool(r["methods"][method]["tasks"][fam]["abstained"]) for r in rows]
        f_int = [float(r["methods"][method]["tasks"][fam]["interventions_used"]) for r in rows]
        f_ent = [float(r["methods"][method]["tasks"][fam]["realized_entropy_reduction_bits"]) for r in rows]
        f_fprom = [bool(r["methods"][method]["tasks"][fam]["false_promotion"]) for r in rows]
        by_family[fam] = {
            "held_out_accuracy": clamped_ci95(f_acc, clamp_unit=True),
            "exact_rule_identification_rate": rate_with_counts(f_id),
            "abstention_rate": rate_with_counts(f_abs),
            "false_promotion_rate": rate_with_counts(f_fprom),
            "mean_interventions_used": clamped_ci95(f_int, clamp_unit=False),
            "mean_entropy_reduction_bits": clamped_ci95(f_ent, clamp_unit=False),
        }

    scene_evals = [
        float(r["methods"][method]["tasks"][fam]["n_candidate_scenes_evaluated"])
        for r in rows
        for fam in TASK_FAMILIES
    ]
    hyp_evals = [
        float(r["methods"][method]["tasks"][fam]["n_hypothesis_candidates_evaluated"])
        for r in rows
        for fam in TASK_FAMILIES
    ]
    runtimes = [float(r["methods"][method]["runtime_ms"]) for r in rows]

    return {
        "identifiable_exact_rule_identification_rate": rate_with_counts(identifiable_flags),
        "identifiable_held_out_accuracy": clamped_ci95(identifiable_accs, clamp_unit=True),
        "unidentifiable_abstention_rate": rate_with_counts(unidentifiable_abstain_flags),
        "family_d_unidentifiable_abstention_rate": rate_with_counts(fam_d_abstain_flags),
        "false_identification_rate": rate_with_counts(false_id_flags),
        "mean_interventions_used": clamped_ci95(all_interventions, clamp_unit=False),
        "distinguishing_intervention_rate": {
            "numerator": total_distinguishing,
            "denominator": total_interventions,
            "overall_ratio": round(
                (total_distinguishing / total_interventions) if total_interventions > 0 else 0.0, 6
            ),
            **clamped_ci95(per_seed_dist_rates, clamp_unit=True),
        },
        "information_value_reduction": {
            "mean_expected_ig_bits_per_intervention": round(mean_ig_per_intervention, 6),
            "mean_realized_entropy_reduction_bits_per_task": clamped_ci95(
                all_entropy_red, clamp_unit=False
            ),
            "cumulative_realized_entropy_reduction_bits": round(cumulative_entropy_red, 6),
        },
        "semantic_equivalence_handling_rate": rate_with_counts(eq_flags),
        "noisy_observation_robustness": {
            "overall_robustness_rate": rate_with_counts(noisy_all_flags),
            "b1_recoverable_single_flip_identification_rate": rate_with_counts(noisy_b1_flags),
            "b2_contradictory_noise_safe_abstention_rate": rate_with_counts(noisy_b2_flags),
        },
        "false_promotions": {
            "overall_false_promotion_rate": rate_with_counts(false_prom_all_flags),
            "unidentifiable_and_noisy_trap_false_promotion_rate": rate_with_counts(
                false_prom_unidentifiable_flags
            ),
        },
        "rollback_and_regression_stats": {
            "successful_rollbacks_count": succ_rollbacks,
            "failed_rollbacks_count": fail_rollbacks,
            "rollback_success_rate": (
                round(succ_rollbacks / (succ_rollbacks + fail_rollbacks), 6)
                if (succ_rollbacks + fail_rollbacks) > 0
                else 1.0
            ),
            "mean_m16_regression_drop": round(mean(m16_drops), 6),
            "mean_m17_regression_drop": round(mean(m17_drops), 6),
            "m16_m17_regression_rate": rate_with_counts(reg_flags),
            "productive_memory_mutated_by_no_guard_ablation": any(
                bool(r["methods"][method]["productive_memory_mutated_by_ablation"]) for r in rows
            ),
        },
        "runtime_and_candidate_stats": {
            "mean_candidate_scenes_evaluated_per_task": round(mean(scene_evals), 2),
            "mean_hypothesis_candidates_evaluated_per_task": round(mean(hyp_evals), 2),
            "mean_runtime_ms_per_seed": round(mean(runtimes), 4),
            "total_runtime_ms": round(sum(runtimes), 4),
        },
        "by_family": by_family,
    }


def evaluate(
    seeds: List[int],
    train_size: int = 16,
    val_size: int = 14,
    independent_size_val: int = 14,
    test_size: int = 36,
    intervention_budget: int = 3,
) -> Dict[str, Any]:
    if not seeds:
        raise ValueError("at least one seed required")
    commit_hash = get_git_commit_hash()
    suite_start = time.perf_counter()

    rows: List[Dict[str, Any]] = []
    for seed in seeds:
        world = ActiveDisambiguationWorld(seed)
        bundle = world.generate_bundle(
            train_size=train_size,
            val_size=val_size,
            independent_size_val=independent_size_val,
            test_size=test_size,
            intervention_budget=intervention_budget,
        )
        method_outcomes = {m: run_method_on_bundle(m, bundle) for m in METHODS}
        rows.append(
            {
                "seed": seed,
                "rules": {
                    fam: bundle.tasks_by_family[fam]["ground_truth_rule"].to_dict()
                    for fam in TASK_FAMILIES
                },
                "methods": method_outcomes,
            }
        )

    methods_summary = {m: aggregate_method(rows, m) for m in METHODS}

    # Concrete examples of successful disambiguation, equivalence resolution, and safe abstention
    disambiguation_examples = []
    abstention_examples = []
    equivalence_examples = []
    for r in rows[:3]:
        ri_tasks = r["methods"]["ri_full"]["tasks"]
        a_t = ri_tasks["A_identifiable_competing_rules"]
        c_t = ri_tasks["C_semantically_equivalent"]
        d_t = ri_tasks["D_unidentifiable_ambiguity"]
        disambiguation_examples.append(
            {
                "seed": r["seed"],
                "family": "A_identifiable_competing_rules",
                "target_rule": r["rules"]["A_identifiable_competing_rules"]["subprimitive"],
                "selected_expression": a_t["selected_expression"],
                "interventions_used": a_t["interventions_used"],
                "realized_entropy_reduction_bits": a_t["realized_entropy_reduction_bits"],
                "held_out_accuracy": a_t["held_out_accuracy"],
                "status": a_t["status"],
            }
        )
        equivalence_examples.append(
            {
                "seed": r["seed"],
                "family": "C_semantically_equivalent",
                "equivalent_expressions": c_t["equivalent_expressions"],
                "canonical_selected": c_t["selected_expression"],
                "interventions_used": c_t["interventions_used"],
                "status": c_t["status"],
            }
        )
        abstention_examples.append(
            {
                "seed": r["seed"],
                "family": "D_unidentifiable_ambiguity",
                "surviving_competing_expressions": d_t["surviving_expressions"],
                "interventions_used": d_t["interventions_used"],
                "stopped_reason": d_t["stopped_reason"],
                "abstained": d_t["abstained"],
                "promoted": d_t["promoted"],
                "status": d_t["status"],
            }
        )

    # Paired comparisons: ri_full minus each comparison method on identifiable accuracy & false promotion rate
    paired_comparisons: Dict[str, Any] = {}
    for other in METHODS:
        if other == "ri_full":
            continue
        id_diffs = []
        fprom_diffs = []
        for r in rows:
            ri_t = r["methods"]["ri_full"]["tasks"]
            ot_t = r["methods"][other]["tasks"]
            for fam in ("A_identifiable_competing_rules", "E_adversarial_heuristic_trap"):
                id_diffs.append(
                    float(ri_t[fam]["exact_rule_identified"]) - float(ot_t[fam]["exact_rule_identified"])
                )
            for fam in TASK_FAMILIES:
                fprom_diffs.append(
                    float(ri_t[fam]["false_promotion"]) - float(ot_t[fam]["false_promotion"])
                )
        paired_comparisons[other] = {
            "identifiable_ae_exact_identification_gain": clamped_ci95(id_diffs, clamp_unit=False),
            "false_promotion_rate_difference": clamped_ci95(fprom_diffs, clamp_unit=False),
        }

    total_suite_ms = (time.perf_counter() - suite_start) * 1000.0
    return {
        "commit_hash": commit_hash,
        "experiment_version": EXPERIMENT_VERSION,
        "execution_status": "completed",
        "n_seeds": len(seeds),
        "seeds": list(seeds),
        "split_sizes": {
            "train_size": train_size,
            "val_size": val_size,
            "independent_size_val": independent_size_val,
            "test_size": test_size,
        },
        "budgets": {
            "default_intervention_budget": intervention_budget,
            "noisy_recoverable_b1_intervention_budget": 6,
            "noisy_contradictory_b2_intervention_budget": 2,
            "max_candidate_scenes_per_task": 48,
            "max_dsl_hypothesis_candidates": 72,
        },
        "pre_registered_gate": dict(PRE_REGISTERED_M18_GATE),
        "metric_definitions": dict(METRIC_DEFINITIONS),
        "task_families": list(TASK_FAMILIES),
        "methods": methods_summary,
        "paired_comparisons_ri_full_minus_other": paired_comparisons,
        "examples": {
            "successful_disambiguations": disambiguation_examples,
            "semantic_equivalence_resolutions": equivalence_examples,
            "safe_abstentions": abstention_examples,
        },
        "total_benchmark_runtime_ms": round(total_suite_ms, 2),
        "rows": rows,
        "limitations": [
            "Candidate experimental interventions are synthesized within a bounded scene DSL (N in [2..6], pos in [0..7], up to 48 candidate scenes per task).",
            "Expected information gain assumes a uniform prior over surviving equivalence classes and a symmetric observation noise parameter.",
            "Semantic equivalence is audited over a finite canonical probe set plus all admissible candidate intervention scenes; undecidable equivalence in unrestricted languages is out of scope.",
            "All experiments run on synthetic relational object scenes on CPU and do not establish general intelligence.",
        ],
    }


def write_m18_artifacts(
    data: Dict[str, Any],
    output_path: Path,
    summary_path: Optional[Path] = None,
    ablation_path: Optional[Path] = None,
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

    if summary_path is not None:
        summary_payload = {k: v for k, v in data.items() if k != "rows"}
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        summary_path.write_text(json.dumps(summary_payload, indent=2) + "\n", encoding="utf-8")

    if ablation_path is not None:
        ablation_payload = {
            "commit_hash": data["commit_hash"],
            "experiment_version": data["experiment_version"],
            "execution_status": data["execution_status"],
            "n_seeds": data["n_seeds"],
            "budgets": data["budgets"],
            "pre_registered_gate": data["pre_registered_gate"],
            "metric_definitions": data["metric_definitions"],
            "comparison_and_ablation_systems": {m: data["methods"][m] for m in METHODS},
            "paired_comparisons_ri_full_minus_other": data["paired_comparisons_ri_full_minus_other"],
            "examples": data["examples"],
            "total_benchmark_runtime_ms": data["total_benchmark_runtime_ms"],
            "limitations": data["limitations"],
        }
        ablation_path.parent.mkdir(parents=True, exist_ok=True)
        ablation_path.write_text(json.dumps(ablation_payload, indent=2) + "\n", encoding="utf-8")


def main(argv: Optional[List[str]] = None) -> int:
    root_ri = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description="Run M18 E11 active disambiguation benchmark.")
    parser.add_argument("--seeds", nargs="+", type=int, default=list(range(30)))
    parser.add_argument("--train-size", type=int, default=16)
    parser.add_argument("--val-size", type=int, default=14)
    parser.add_argument("--independent-size-val", type=int, default=14)
    parser.add_argument("--test-size", type=int, default=36)
    parser.add_argument("--intervention-budget", type=int, default=3)
    parser.add_argument("--output", default="results/results.json")
    parser.add_argument(
        "--summary-output",
        default=str(root_ri / "results/m18_summary.json"),
    )
    parser.add_argument(
        "--ablation-output",
        default=str(root_ri / "results/m18_ablation_results.json"),
    )
    args = parser.parse_args(argv)
    if args.train_size < 6 or args.val_size < 6 or args.independent_size_val < 6 or args.test_size < 12:
        parser.error("require train-size>=6, val-size>=6, independent-size-val>=6, test-size>=12")

    data = evaluate(
        seeds=args.seeds,
        train_size=args.train_size,
        val_size=args.val_size,
        independent_size_val=args.independent_size_val,
        test_size=args.test_size,
        intervention_budget=args.intervention_budget,
    )
    write_m18_artifacts(
        data,
        output_path=Path(args.output),
        summary_path=Path(args.summary_output) if args.summary_output else None,
        ablation_path=Path(args.ablation_output) if args.ablation_output else None,
    )
    compact = {
        "commit_hash": data["commit_hash"],
        "experiment_version": data["experiment_version"],
        "n_seeds": data["n_seeds"],
        "identifiable_exact_rule_identification_rate": {
            m: data["methods"][m]["identifiable_exact_rule_identification_rate"]["mean"]
            for m in METHODS
        },
        "unidentifiable_abstention_rate": {
            m: data["methods"][m]["unidentifiable_abstention_rate"]["mean"] for m in METHODS
        },
        "semantic_equivalence_handling_rate": {
            m: data["methods"][m]["semantic_equivalence_handling_rate"]["mean"] for m in METHODS
        },
        "overall_false_promotion_rate": {
            m: data["methods"][m]["false_promotions"]["overall_false_promotion_rate"]["mean"]
            for m in METHODS
        },
    }
    print(json.dumps(compact, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
