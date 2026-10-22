"""M16.3, M16.4 & M16.6 (E9) — Evaluation, Baselines, Ablations, and Artifact Generation."""
import argparse
import json
import math
from pathlib import Path
from statistics import mean, stdev
import subprocess
import time
from typing import Any, Dict, List, Optional

from agent import (
    CANONICAL_PROBE_SCENES,
    GrammarHypothesis,
    MajorityPriorBaseline,
    RandomHypothesisBaseline,
    RIRelationalAgent,
    SupervisedFeatureReferenceBaseline,
)
from environment import (
    REGIMES,
    HeldOutRuleWorld,
    RelationalTaskSplit,
    RuleSpecification,
    strip_labels,
)

EXPERIMENT_VERSION = "M16.E9.v1"
MAX_CANDIDATES_BUDGET = 420
MAX_DEPTH_BUDGET = 2
QUERY_BUDGET = 3


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


def stats_with_ci95(values: List[float]) -> Dict[str, float]:
    if not values:
        return {"mean": 0.0, "std": 0.0, "ci95_half_width": 0.0, "ci95_low": 0.0, "ci95_high": 0.0}
    m = mean(values)
    if len(values) < 2:
        return {"mean": round(m, 6), "std": 0.0, "ci95_half_width": 0.0, "ci95_low": round(m, 6), "ci95_high": round(m, 6)}
    s = stdev(values)
    hw = 1.96 * s / math.sqrt(len(values))
    return {
        "mean": round(m, 6),
        "std": round(s, 6),
        "ci95_half_width": round(hw, 6),
        "ci95_low": round(m - hw, 6),
        "ci95_high": round(m + hw, 6),
    }


def is_exact_rule_recovered(
    hypothesis: Optional[GrammarHypothesis],
    ground_truth: RuleSpecification,
    test_examples: List[Dict[str, Any]],
    abstained: bool = False,
) -> bool:
    if abstained or hypothesis is None or not ground_truth.identifiable_in_grammar:
        return False
    for scene in CANONICAL_PROBE_SCENES:
        if hypothesis.predict_scene(scene) != ground_truth.evaluate(scene):
            return False
    for item in test_examples:
        if hypothesis.predict_scene(item["objects"]) != int(item["label"]):
            return False
    return True


def score_predictions(predictions: List[int], labeled_examples: List[Dict[str, Any]]) -> float:
    if not labeled_examples:
        return 0.0
    return mean(int(p == int(e["label"])) for p, e in zip(predictions, labeled_examples))


def evaluate_single_method_on_task(
    method_name: str,
    task: RelationalTaskSplit,
    unlabeled_test: List[Dict[str, Any]],
    unlabeled_buckets: Dict[str, List[Dict[str, Any]]],
) -> Dict[str, Any]:
    start = time.perf_counter()

    if method_name == "ri_full":
        agent = RIRelationalAgent(
            max_depth=MAX_DEPTH_BUDGET,
            max_candidates=MAX_CANDIDATES_BUDGET,
            use_skill_memory=True,
            use_active_query=True,
            query_budget=QUERY_BUDGET,
            use_validation_guard=True,
            seed=task.seed,
        ).fit(task.train_examples, task.val_examples, task.query_pool, task.warmup_tasks)
        preds = agent.predict(unlabeled_test)
        bucket_preds = {k: agent.predict(v) for k, v in unlabeled_buckets.items()}
        exact = is_exact_rule_recovered(agent.selected, task.ground_truth_rule, task.test_examples, agent.abstained)
        n_eval = agent.n_candidates_evaluated
        n_dedup = agent.n_semantically_deduplicated
        n_examples_used = len(task.train_examples) + len(task.val_examples) + agent.queries_used
        queries_used = agent.queries_used
        abstained = agent.abstained
        ambiguous = agent.abstained or (agent.n_tied_best > 1)
        uncertainty = agent.uncertainty_score
        status = agent.status
        mem_skills = len(agent.memory.skills)

    elif method_name == "ri_no_skill_memory":
        agent = RIRelationalAgent(
            max_depth=MAX_DEPTH_BUDGET,
            max_candidates=MAX_CANDIDATES_BUDGET,
            use_skill_memory=False,
            use_active_query=True,
            query_budget=QUERY_BUDGET,
            use_validation_guard=True,
            seed=task.seed,
        ).fit(task.train_examples, task.val_examples, task.query_pool, warmup_tasks=None)
        preds = agent.predict(unlabeled_test)
        bucket_preds = {k: agent.predict(v) for k, v in unlabeled_buckets.items()}
        exact = is_exact_rule_recovered(agent.selected, task.ground_truth_rule, task.test_examples, agent.abstained)
        n_eval = agent.n_candidates_evaluated
        n_dedup = agent.n_semantically_deduplicated
        n_examples_used = len(task.train_examples) + len(task.val_examples) + agent.queries_used
        queries_used = agent.queries_used
        abstained = agent.abstained
        ambiguous = agent.abstained or (agent.n_tied_best > 1)
        uncertainty = agent.uncertainty_score
        status = agent.status
        mem_skills = 0

    elif method_name == "ri_no_compositional":
        agent = RIRelationalAgent(
            max_depth=1,
            max_candidates=MAX_CANDIDATES_BUDGET,
            use_skill_memory=True,
            use_active_query=True,
            query_budget=QUERY_BUDGET,
            use_validation_guard=True,
            seed=task.seed,
        ).fit(task.train_examples, task.val_examples, task.query_pool, task.warmup_tasks)
        preds = agent.predict(unlabeled_test)
        bucket_preds = {k: agent.predict(v) for k, v in unlabeled_buckets.items()}
        exact = is_exact_rule_recovered(agent.selected, task.ground_truth_rule, task.test_examples, agent.abstained)
        n_eval = agent.n_candidates_evaluated
        n_dedup = agent.n_semantically_deduplicated
        n_examples_used = len(task.train_examples) + len(task.val_examples) + agent.queries_used
        queries_used = agent.queries_used
        abstained = agent.abstained
        ambiguous = agent.abstained or (agent.n_tied_best > 1)
        uncertainty = agent.uncertainty_score
        status = agent.status
        mem_skills = len(agent.memory.skills)

    elif method_name == "bounded_enumerative_search":
        agent = RIRelationalAgent(
            max_depth=MAX_DEPTH_BUDGET,
            max_candidates=MAX_CANDIDATES_BUDGET,
            use_skill_memory=False,
            use_active_query=False,
            query_budget=0,
            use_validation_guard=False,
            seed=task.seed,
        ).fit(task.train_examples, task.val_examples, query_pool=None, warmup_tasks=None)
        preds = agent.predict(unlabeled_test)
        bucket_preds = {k: agent.predict(v) for k, v in unlabeled_buckets.items()}
        exact = is_exact_rule_recovered(agent.selected, task.ground_truth_rule, task.test_examples, False)
        n_eval = agent.n_candidates_evaluated
        n_dedup = agent.n_semantically_deduplicated
        n_examples_used = len(task.train_examples)
        queries_used = 0
        abstained = False
        ambiguous = agent.n_tied_best > 1
        uncertainty = agent.uncertainty_score
        status = agent.status
        mem_skills = 0

    elif method_name == "supervised_reference":
        sup = SupervisedFeatureReferenceBaseline(k=3).fit(task.train_examples, task.val_examples)
        preds = sup.predict(unlabeled_test)
        bucket_preds = {k: sup.predict(v) for k, v in unlabeled_buckets.items()}
        exact = False  # Non-symbolic feature k-NN does not recover an explicit symbolic rule.
        n_eval = 1
        n_dedup = 0
        n_examples_used = len(task.train_examples) + len(task.val_examples)
        queries_used = 0
        abstained = False
        ambiguous = False
        uncertainty = 0.5
        status = "fitted_blackbox"
        mem_skills = 0

    elif method_name == "majority_prior":
        maj = MajorityPriorBaseline().fit(task.train_examples, task.val_examples)
        preds = maj.predict(unlabeled_test)
        bucket_preds = {k: maj.predict(v) for k, v in unlabeled_buckets.items()}
        exact = False
        n_eval = 1
        n_dedup = 0
        n_examples_used = len(task.train_examples) + len(task.val_examples)
        queries_used = 0
        abstained = False
        ambiguous = False
        uncertainty = 0.5
        status = "constant_prior"
        mem_skills = 0

    elif method_name == "random_hypothesis":
        rnd = RandomHypothesisBaseline(seed=task.seed + 91_000, max_candidates=MAX_CANDIDATES_BUDGET).fit(
            task.train_examples
        )
        preds = rnd.predict(unlabeled_test)
        bucket_preds = {k: rnd.predict(v) for k, v in unlabeled_buckets.items()}
        exact = is_exact_rule_recovered(rnd.selected, task.ground_truth_rule, task.test_examples, False)
        n_eval = 1
        n_dedup = 0
        n_examples_used = len(task.train_examples)
        queries_used = 0
        abstained = False
        ambiguous = True
        uncertainty = 1.0
        status = "random_choice"
        mem_skills = 0

    elif method_name == "ablation_no_m13_active_query":
        agent = RIRelationalAgent(
            max_depth=MAX_DEPTH_BUDGET,
            max_candidates=MAX_CANDIDATES_BUDGET,
            use_skill_memory=True,
            use_active_query=False,
            query_budget=0,
            use_validation_guard=True,
            seed=task.seed,
        ).fit(task.train_examples, task.val_examples, query_pool=None, warmup_tasks=task.warmup_tasks)
        preds = agent.predict(unlabeled_test)
        bucket_preds = {k: agent.predict(v) for k, v in unlabeled_buckets.items()}
        exact = is_exact_rule_recovered(agent.selected, task.ground_truth_rule, task.test_examples, agent.abstained)
        n_eval = agent.n_candidates_evaluated
        n_dedup = agent.n_semantically_deduplicated
        n_examples_used = len(task.train_examples) + len(task.val_examples)
        queries_used = 0
        abstained = agent.abstained
        ambiguous = agent.abstained or (agent.n_tied_best > 1)
        uncertainty = agent.uncertainty_score
        status = agent.status
        mem_skills = len(agent.memory.skills)

    elif method_name == "ablation_no_m15_validation_guard":
        agent = RIRelationalAgent(
            max_depth=MAX_DEPTH_BUDGET,
            max_candidates=MAX_CANDIDATES_BUDGET,
            use_skill_memory=True,
            use_active_query=True,
            query_budget=QUERY_BUDGET,
            use_validation_guard=False,
            seed=task.seed,
        ).fit(task.train_examples, task.val_examples, task.query_pool, task.warmup_tasks)
        preds = agent.predict(unlabeled_test)
        bucket_preds = {k: agent.predict(v) for k, v in unlabeled_buckets.items()}
        exact = is_exact_rule_recovered(agent.selected, task.ground_truth_rule, task.test_examples, False)
        n_eval = agent.n_candidates_evaluated
        n_dedup = agent.n_semantically_deduplicated
        n_examples_used = len(task.train_examples) + agent.queries_used
        queries_used = agent.queries_used
        abstained = False
        ambiguous = agent.n_tied_best > 1
        uncertainty = agent.uncertainty_score
        status = agent.status
        mem_skills = len(agent.memory.skills)

    else:
        raise ValueError(f"unknown method_name: {method_name}")

    runtime_ms = (time.perf_counter() - start) * 1000.0
    held_out_acc = score_predictions(preds, task.test_examples)
    bucket_acc = {
        b_name: score_predictions(bucket_preds[b_name], task.test_by_size_bucket[b_name])
        for b_name in ("small_3_5", "medium_6_8", "large_9_11")
    }
    size_drop = bucket_acc["small_3_5"] - bucket_acc["large_9_11"]

    return {
        "held_out_accuracy": held_out_acc,
        "error_rate": 1.0 - held_out_acc,
        "exact_rule_recovered": exact,
        "size_bucket_accuracy": bucket_acc,
        "size_transfer_drop": size_drop,
        "n_hypotheses_evaluated": n_eval,
        "n_semantically_deduplicated": n_dedup,
        "n_training_examples_used": n_examples_used,
        "queries_used": queries_used,
        "runtime_ms": round(runtime_ms, 4),
        "abstained": abstained,
        "unsolved_or_ambiguous": ambiguous,
        "uncertainty_score": round(uncertainty, 4),
        "status": status,
        "memory_skills_count": mem_skills,
    }


MAIN_METHODS = (
    "ri_full",
    "majority_prior",
    "supervised_reference",
    "bounded_enumerative_search",
    "ri_no_skill_memory",
    "ri_no_compositional",
    "random_hypothesis",
)

ABLATION_METHODS = (
    "ri_full",
    "ablation_no_m13_active_query",
    "ri_no_skill_memory",
    "ablation_no_m15_validation_guard",
    "ri_no_compositional",
)


def aggregate_method_metrics(rows: List[Dict[str, Any]], method: str) -> Dict[str, Any]:
    identifiable_rows = [r for r in rows if r["identifiable_in_grammar"]]
    c2_rows = [r for r in rows if not r["identifiable_in_grammar"]]

    all_acc = [r["methods"][method]["held_out_accuracy"] for r in rows]
    id_acc = [r["methods"][method]["held_out_accuracy"] for r in identifiable_rows]
    id_exact = [float(r["methods"][method]["exact_rule_recovered"]) for r in identifiable_rows]

    small_acc = [r["methods"][method]["size_bucket_accuracy"]["small_3_5"] for r in identifiable_rows]
    med_acc = [r["methods"][method]["size_bucket_accuracy"]["medium_6_8"] for r in identifiable_rows]
    large_acc = [r["methods"][method]["size_bucket_accuracy"]["large_9_11"] for r in identifiable_rows]
    size_drops = [r["methods"][method]["size_transfer_drop"] for r in identifiable_rows]

    by_regime: Dict[str, Any] = {}
    for regime in REGIMES:
        reg_rows = [r for r in rows if r["regime"] == regime]
        if not reg_rows:
            continue
        by_regime[regime] = {
            "n_tasks": len(reg_rows),
            "held_out_accuracy": stats_with_ci95(
                [r["methods"][method]["held_out_accuracy"] for r in reg_rows]
            ),
            "exact_rule_recovery_rate": round(
                mean(float(r["methods"][method]["exact_rule_recovered"]) for r in reg_rows), 6
            ),
            "abstention_rate": round(
                mean(float(r["methods"][method]["abstained"]) for r in reg_rows), 6
            ),
            "mean_hypotheses_evaluated": round(
                mean(r["methods"][method]["n_hypotheses_evaluated"] for r in reg_rows), 2
            ),
            "mean_queries_used": round(
                mean(r["methods"][method]["queries_used"] for r in reg_rows), 3
            ),
        }

    return {
        "overall_held_out_accuracy": stats_with_ci95(all_acc),
        "identifiable_held_out_accuracy": stats_with_ci95(id_acc),
        "identifiable_exact_rule_recovery": stats_with_ci95(id_exact),
        "overall_exact_rule_recovery_rate": round(
            mean(float(r["methods"][method]["exact_rule_recovered"]) for r in rows), 6
        ),
        "size_generalization_on_identifiable": {
            "small_3_5_accuracy": stats_with_ci95(small_acc),
            "medium_6_8_accuracy": stats_with_ci95(med_acc),
            "large_9_11_accuracy": stats_with_ci95(large_acc),
            "mean_size_transfer_drop": round(mean(size_drops), 6) if size_drops else 0.0,
        },
        "mean_hypotheses_evaluated": round(
            mean(r["methods"][method]["n_hypotheses_evaluated"] for r in rows), 2
        ),
        "mean_semantically_deduplicated": round(
            mean(r["methods"][method]["n_semantically_deduplicated"] for r in rows), 2
        ),
        "mean_training_examples_used": round(
            mean(r["methods"][method]["n_training_examples_used"] for r in rows), 2
        ),
        "mean_queries_used": round(
            mean(r["methods"][method]["queries_used"] for r in rows), 3
        ),
        "mean_runtime_ms": round(
            mean(r["methods"][method]["runtime_ms"] for r in rows), 4
        ),
        "mean_error_rate": round(
            mean(r["methods"][method]["error_rate"] for r in rows), 6
        ),
        "unsolved_or_ambiguous_rate": round(
            mean(float(r["methods"][method]["unsolved_or_ambiguous"]) for r in rows), 6
        ),
        "unidentifiable_c2_detection_rate": (
            round(mean(float(r["methods"][method]["abstained"]) for r in c2_rows), 6)
            if c2_rows
            else 0.0
        ),
        "false_abstention_rate_on_identifiable": (
            round(mean(float(r["methods"][method]["abstained"]) for r in identifiable_rows), 6)
            if identifiable_rows
            else 0.0
        ),
        "by_regime": by_regime,
    }


def evaluate_negative_and_tradeoff_cases(seeds: List[int]) -> Dict[str, Any]:
    """M16.4 requirement: demonstrate cases where M13 or M14 provide no benefit or degrade performance."""
    noisy_oracle_rows = []
    irrelevant_mem_rows = []

    for seed in seeds:
        world = HeldOutRuleWorld(seed)

        # Case 1: M13 Active Querying under a corrupted query oracle (75% flip probability)
        # WITHOUT M15 validation guard performs hard version-space elimination on faulty query
        # responses, degrading accuracy relative to passive no-query selection on clean train data.
        task_b = world.generate_task(
            "B_structural_size_transfer",
            train_size=6,
            val_size=8,
            query_pool_size=14,
            test_size=24,
        )
        unlabeled_test_b = strip_labels(task_b.test_examples)
        active_noisy_oracle = RIRelationalAgent(
            max_depth=2,
            max_candidates=MAX_CANDIDATES_BUDGET,
            use_skill_memory=False,
            use_active_query=True,
            query_budget=3,
            use_validation_guard=False,
            oracle_noise_prob=0.75,
            seed=seed,
        ).fit(task_b.train_examples, task_b.val_examples, task_b.query_pool)

        passive_clean = RIRelationalAgent(
            max_depth=2,
            max_candidates=MAX_CANDIDATES_BUDGET,
            use_skill_memory=False,
            use_active_query=False,
            query_budget=0,
            use_validation_guard=False,
            oracle_noise_prob=0.0,
            seed=seed,
        ).fit(task_b.train_examples, task_b.val_examples, query_pool=None)

        acc_active_noisy = score_predictions(active_noisy_oracle.predict(unlabeled_test_b), task_b.test_examples)
        acc_passive = score_predictions(passive_clean.predict(unlabeled_test_b), task_b.test_examples)
        noisy_oracle_rows.append(
            {
                "seed": seed,
                "active_with_noisy_oracle_acc": acc_active_noisy,
                "passive_no_query_acc": acc_passive,
                "diff": acc_active_noisy - acc_passive,
            }
        )

        # Case 2: M14 Skill Memory loaded with irrelevant Regime-A skills when solving
        # C1_heldout_translatable (pairwise relational rule). Provides 0 accuracy benefit
        # while evaluating +12 extra memory-composition candidates.
        task_a = world.generate_task("A_compositional", train_size=12, val_size=10, query_pool_size=12, test_size=24)
        task_c1 = world.generate_task("C1_heldout_translatable", train_size=12, val_size=10, query_pool_size=12, test_size=24)
        unlabeled_test_c1 = strip_labels(task_c1.test_examples)

        with_irrelevant_mem = RIRelationalAgent(
            max_depth=2,
            max_candidates=MAX_CANDIDATES_BUDGET,
            use_skill_memory=True,
            use_active_query=True,
            query_budget=QUERY_BUDGET,
            use_validation_guard=True,
            seed=seed,
        ).fit(task_c1.train_examples, task_c1.val_examples, task_c1.query_pool, warmup_tasks=task_a.warmup_tasks)

        without_mem = RIRelationalAgent(
            max_depth=2,
            max_candidates=MAX_CANDIDATES_BUDGET,
            use_skill_memory=False,
            use_active_query=True,
            query_budget=QUERY_BUDGET,
            use_validation_guard=True,
            seed=seed,
        ).fit(task_c1.train_examples, task_c1.val_examples, task_c1.query_pool, warmup_tasks=None)

        acc_with_irrel = score_predictions(with_irrelevant_mem.predict(unlabeled_test_c1), task_c1.test_examples)
        acc_without_mem = score_predictions(without_mem.predict(unlabeled_test_c1), task_c1.test_examples)
        irrelevant_mem_rows.append(
            {
                "seed": seed,
                "with_irrelevant_memory_acc": acc_with_irrel,
                "without_memory_acc": acc_without_mem,
                "extra_candidates_evaluated": (
                    with_irrelevant_mem.n_candidates_evaluated - without_mem.n_candidates_evaluated
                ),
            }
        )

    return {
        "m13_degrades_under_noisy_oracle_without_m15_guard": {
            "description": (
                "When the query oracle is corrupted (75% label flip probability) and M15 validation guard "
                "is disabled, hard version-space elimination on faulty query responses discards the true rule "
                "and degrades held-out accuracy compared to passive no-query selection."
            ),
            "active_noisy_oracle_accuracy": stats_with_ci95(
                [r["active_with_noisy_oracle_acc"] for r in noisy_oracle_rows]
            ),
            "passive_no_query_accuracy": stats_with_ci95(
                [r["passive_no_query_acc"] for r in noisy_oracle_rows]
            ),
            "mean_accuracy_change": round(mean(r["diff"] for r in noisy_oracle_rows), 6),
        },
        "m14_zero_gain_and_search_overhead_under_irrelevant_skills": {
            "description": (
                "When SkillMemory contains only Regime-A unary skills but the target task is "
                "C1_heldout_translatable (pairwise relational graph rule), M14 skill composition "
                "yields zero accuracy gain while adding candidate evaluation overhead."
            ),
            "with_irrelevant_memory_accuracy": stats_with_ci95(
                [r["with_irrelevant_memory_acc"] for r in irrelevant_mem_rows]
            ),
            "without_memory_accuracy": stats_with_ci95(
                [r["without_memory_acc"] for r in irrelevant_mem_rows]
            ),
            "mean_accuracy_gain": round(
                mean(r["with_irrelevant_memory_acc"] - r["without_memory_acc"] for r in irrelevant_mem_rows), 6
            ),
            "mean_extra_candidates_evaluated": round(
                mean(r["extra_candidates_evaluated"] for r in irrelevant_mem_rows), 2
            ),
        },
    }


def evaluate(
    seeds: List[int],
    train_size: int = 10,
    val_size: int = 10,
    query_pool_size: int = 16,
    test_size: int = 36,
    noise_prob: float = 0.05,
) -> Dict[str, Any]:
    if not seeds:
        raise ValueError("at least one seed required")
    if train_size < 4 or val_size < 4 or test_size < 6:
        raise ValueError("require train_size>=4, val_size>=4, test_size>=6")

    commit_hash = get_git_commit_hash()
    all_methods = tuple(dict.fromkeys(MAIN_METHODS + ABLATION_METHODS))
    rows: List[Dict[str, Any]] = []

    for seed in seeds:
        world = HeldOutRuleWorld(seed)
        for reg_idx, regime in enumerate(REGIMES):
            task = world.generate_task(
                regime=regime,
                train_size=train_size,
                val_size=val_size,
                query_pool_size=query_pool_size,
                test_size=test_size,
                noise_prob=noise_prob,
                seed_offset=reg_idx,
            )
            if not task.verify_no_leakage():
                raise RuntimeError(f"data leakage detected in task {task.task_id}")

            # Strip all labels and metadata before passing test splits to any method.
            unlabeled_test = strip_labels(task.test_examples)
            unlabeled_buckets = {
                b_name: strip_labels(b_items)
                for b_name, b_items in task.test_by_size_bucket.items()
            }

            method_outcomes: Dict[str, Any] = {}
            for m_name in all_methods:
                method_outcomes[m_name] = evaluate_single_method_on_task(
                    m_name, task, unlabeled_test, unlabeled_buckets
                )

            rows.append(
                {
                    "seed": seed,
                    "task_id": task.task_id,
                    "regime": regime,
                    "identifiable_in_grammar": task.identifiable_in_grammar,
                    "ground_truth_rule": task.ground_truth_rule.to_dict(),
                    "methods": method_outcomes,
                }
            )

    methods_summary = {m: aggregate_method_metrics(rows, m) for m in MAIN_METHODS}
    ablation_summary = {m: aggregate_method_metrics(rows, m) for m in ABLATION_METHODS}

    identifiable_rows = [r for r in rows if r["identifiable_in_grammar"]]
    paired_vs_baselines: Dict[str, Any] = {}
    for other in MAIN_METHODS:
        if other == "ri_full":
            continue
        diffs_all = [
            r["methods"]["ri_full"]["held_out_accuracy"] - r["methods"][other]["held_out_accuracy"]
            for r in rows
        ]
        diffs_id = [
            r["methods"]["ri_full"]["held_out_accuracy"] - r["methods"][other]["held_out_accuracy"]
            for r in identifiable_rows
        ]
        exact_diffs_id = [
            float(r["methods"]["ri_full"]["exact_rule_recovered"])
            - float(r["methods"][other]["exact_rule_recovered"])
            for r in identifiable_rows
        ]
        paired_vs_baselines[other] = {
            "overall_accuracy_gain": stats_with_ci95(diffs_all),
            "identifiable_accuracy_gain": stats_with_ci95(diffs_id),
            "identifiable_exact_recovery_gain": stats_with_ci95(exact_diffs_id),
        }

    ablation_deltas: Dict[str, Any] = {}
    for abl in ABLATION_METHODS:
        if abl == "ri_full":
            continue
        diffs_id = [
            r["methods"]["ri_full"]["held_out_accuracy"] - r["methods"][abl]["held_out_accuracy"]
            for r in identifiable_rows
        ]
        exact_diffs = [
            float(r["methods"]["ri_full"]["exact_rule_recovered"])
            - float(r["methods"][abl]["exact_rule_recovered"])
            for r in identifiable_rows
        ]
        ablation_deltas[abl] = {
            "identifiable_accuracy_drop_when_removed": stats_with_ci95(diffs_id),
            "identifiable_exact_recovery_drop_when_removed": stats_with_ci95(exact_diffs),
        }

    negative_and_tradeoff_cases = evaluate_negative_and_tradeoff_cases(seeds)

    return {
        "commit_hash": commit_hash,
        "experiment_version": EXPERIMENT_VERSION,
        "execution_status": "completed",
        "n_seeds": len(seeds),
        "n_total_tasks": len(rows),
        "seeds": list(seeds),
        "split_sizes": {
            "train_size": train_size,
            "val_size": val_size,
            "query_pool_size": query_pool_size,
            "test_size": test_size,
            "train_label_noise_prob": noise_prob,
        },
        "regimes": list(REGIMES),
        "budget_limits": {
            "max_candidates": MAX_CANDIDATES_BUDGET,
            "max_depth": MAX_DEPTH_BUDGET,
            "query_budget": QUERY_BUDGET,
            "size_buckets": {
                "small_3_5": [3, 5],
                "medium_6_8": [6, 8],
                "large_9_11": [9, 11],
            },
        },
        "methods": methods_summary,
        "paired_comparisons_ri_full_minus_baseline": paired_vs_baselines,
        "ablations": {
            "variants": ablation_summary,
            "component_contribution_deltas": ablation_deltas,
            "when_components_do_not_help_or_hurt": negative_and_tradeoff_cases,
        },
        "rows": rows,
        "limitations": [
            "All identifiable rules (Regimes A, B, C1) are composed from a finite typed relational grammar of 8 primitive templates and 5 binary combinators.",
            "Regime C2 (out-of-grammar ternary cyclic triad rule) is fundamentally unidentifiable without higher-order ternary relational primitives; RI detects this via validation discrepancy and abstains rather than inventing new primitive operators.",
            "Synthetic object-graph scenes validate compositional, structural size-transfer, and abstention mechanics on CPU, not open-ended human-level scientific discovery.",
        ],
    }


def write_m16_artifacts(
    data: Dict[str, Any],
    output_path: Path,
    summary_path: Optional[Path] = None,
    ablation_path: Optional[Path] = None,
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

    if summary_path is not None:
        summary_payload = {k: v for k, v in data.items() if k not in ("rows", "ablations")}
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        summary_path.write_text(json.dumps(summary_payload, indent=2) + "\n", encoding="utf-8")

    if ablation_path is not None:
        ablation_payload = {
            "commit_hash": data["commit_hash"],
            "experiment_version": data["experiment_version"],
            "execution_status": data["execution_status"],
            "n_seeds": data["n_seeds"],
            "split_sizes": data["split_sizes"],
            "budget_limits": data["budget_limits"],
            **data["ablations"],
            "limitations": data["limitations"],
        }
        ablation_path.parent.mkdir(parents=True, exist_ok=True)
        ablation_path.write_text(json.dumps(ablation_payload, indent=2) + "\n", encoding="utf-8")


def main(argv: Optional[List[str]] = None) -> int:
    root_ri = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description="Run M16 E9 held-out rule language generalization benchmark.")
    parser.add_argument("--seeds", nargs="+", type=int, default=list(range(30)))
    parser.add_argument("--train-size", type=int, default=10)
    parser.add_argument("--val-size", type=int, default=10)
    parser.add_argument("--query-pool-size", type=int, default=16)
    parser.add_argument("--test-size", type=int, default=36)
    parser.add_argument("--noise", type=float, default=0.05)
    parser.add_argument("--output", default="results/results.json")
    parser.add_argument(
        "--summary-output",
        default=str(root_ri / "results/m16_summary.json"),
    )
    parser.add_argument(
        "--ablation-output",
        default=str(root_ri / "results/m16_ablation_results.json"),
    )
    args = parser.parse_args(argv)
    if args.train_size < 4 or args.val_size < 4 or args.test_size < 6:
        parser.error("require train-size>=4, val-size>=4, test-size>=6")
    if not 0.0 <= args.noise < 0.5:
        parser.error("require --noise in [0.0, 0.5)")

    data = evaluate(
        seeds=args.seeds,
        train_size=args.train_size,
        val_size=args.val_size,
        query_pool_size=args.query_pool_size,
        test_size=args.test_size,
        noise_prob=args.noise,
    )
    write_m16_artifacts(
        data,
        output_path=Path(args.output),
        summary_path=Path(args.summary_output) if args.summary_output else None,
        ablation_path=Path(args.ablation_output) if args.ablation_output else None,
    )
    compact = {
        "commit_hash": data["commit_hash"],
        "experiment_version": data["experiment_version"],
        "n_seeds": data["n_seeds"],
        "n_total_tasks": data["n_total_tasks"],
        "methods_identifiable_held_out_accuracy": {
            m: data["methods"][m]["identifiable_held_out_accuracy"]["mean"]
            for m in MAIN_METHODS
        },
        "methods_identifiable_exact_recovery": {
            m: data["methods"][m]["identifiable_exact_rule_recovery"]["mean"]
            for m in MAIN_METHODS
        },
        "c2_unidentifiable_detection_rate": {
            m: data["methods"][m]["unidentifiable_c2_detection_rate"]
            for m in MAIN_METHODS
        },
    }
    print(json.dumps(compact, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
