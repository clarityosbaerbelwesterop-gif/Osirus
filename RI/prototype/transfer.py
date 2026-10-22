"""M11 — Skill-Memory, Composition, Held-Out Transfer, Quarantine, and Continual Learning Evaluation."""
from statistics import mean
from typing import Any, Dict, List
from .candidates import (
    FixedRuleBaselineModel,
    MajorityBaselineModel,
    RandomBaselineModel,
)
from .memory import SkillMemory
from .orchestrator import RIPrototypeOrchestrator
from .task import generate_grid_task


def run_transfer_and_continual_episode(seed: int) -> Dict[str, Any]:
    memory = SkillMemory()
    orchestrator = RIPrototypeOrchestrator(memory=memory, enable_learning_loop=True)

    # Phase 1: Acquire two primitive skills on distinct task families.
    t_val = 6 + (seed % 3)
    p_val = seed % 2
    task_sum = generate_grid_task(
        seed=seed * 10 + 1,
        family="sum_threshold",
        train_size=28,
        test_size=24,
        task_id=f"acq_sum_s{seed}",
        parameter_override={"threshold": t_val},
    )
    task_par = generate_grid_task(
        seed=seed * 10 + 2,
        family="parity",
        train_size=28,
        test_size=24,
        task_id=f"acq_parity_s{seed}",
        parameter_override={"parity": p_val},
    )

    rep_sum = orchestrator.run_task(task_sum, seed=seed)
    rep_par = orchestrator.run_task(task_par, seed=seed)

    # Phase 2: Direct Skill Reuse on a new sample of the same sum_threshold rule.
    task_reuse = generate_grid_task(
        seed=seed * 10 + 3,
        family="sum_threshold",
        train_size=14,
        test_size=24,
        task_id=f"reuse_sum_s{seed}",
        parameter_override={"threshold": t_val},
    )
    rep_reuse = orchestrator.run_task(task_reuse, seed=seed, persist_skill=False)

    # Phase 3: Compositional Transfer to a held-out composed_and task (sum_threshold AND parity)
    # where learning loop is disabled so the agent must rely on composing its stored skills.
    transfer_orchestrator = RIPrototypeOrchestrator(memory=memory, enable_learning_loop=False)
    no_memory_baseline_orch = RIPrototypeOrchestrator(memory=SkillMemory(), enable_learning_loop=False)

    task_composed = generate_grid_task(
        seed=seed * 10 + 4,
        family="composed_and",
        train_size=16,
        test_size=24,
        task_id=f"transfer_composed_s{seed}",
        parameter_override={"threshold": t_val, "parity": p_val},
    )
    rep_transfer = transfer_orchestrator.run_task(task_composed, seed=seed, persist_skill=True)
    rep_no_memory = no_memory_baseline_orch.run_task(task_composed, seed=seed, persist_skill=False)

    maj_preds = MajorityBaselineModel().fit(task_composed.train_examples).predict(task_composed.test_examples)
    fix_preds = FixedRuleBaselineModel(threshold=7).fit(task_composed.train_examples).predict(task_composed.test_examples)
    rnd_preds = RandomBaselineModel(seed=seed + 50_000).fit(task_composed.train_examples).predict(task_composed.test_examples)

    maj_acc = mean(int(p == e["label"]) for p, e in zip(maj_preds, task_composed.test_examples))
    fix_acc = mean(int(p == e["label"]) for p, e in zip(fix_preds, task_composed.test_examples))
    rnd_acc = mean(int(p == e["label"]) for p, e in zip(rnd_preds, task_composed.test_examples))

    # Phase 4:Continual learning across 4 sequential task families (sum, parity, diff, coord_box)
    # measuring post-sequence retention vs a reset-memory ablation.
    continual_specs = [
        generate_grid_task(seed * 10 + 5, family="sum_threshold", train_size=20, test_size=24, parameter_override={"threshold": t_val}),
        generate_grid_task(seed * 10 + 6, family="parity", train_size=20, test_size=24, parameter_override={"parity": p_val}),
        generate_grid_task(seed * 10 + 7, family="diff_threshold", train_size=20, test_size=24, parameter_override={"threshold": 1}),
        generate_grid_task(seed * 10 + 8, family="coord_box", train_size=20, test_size=24, parameter_override={"min_x": 3, "min_y": 3}),
    ]
    cont_memory = SkillMemory()
    cont_orch = RIPrototypeOrchestrator(memory=cont_memory, enable_learning_loop=True)
    initial_acc: List[float] = []
    for spec in continual_specs:
        r = cont_orch.run_task(spec, seed=seed, persist_skill=True)
        initial_acc.append(r.evaluation.held_out_accuracy)

    # Re-evaluate all 4 tasks using ONLY retained skills in cont_memory (no new candidate search).
    retained_acc: List[float] = []
    reset_acc: List[float] = []
    # In reset memory ablation, only the last task's skill remains in memory.
    reset_memory = SkillMemory()
    RIPrototypeOrchestrator(memory=reset_memory, enable_learning_loop=True).run_task(
        continual_specs[-1], seed=seed, persist_skill=True
    )

    for spec in continual_specs:
        # Score best retained skill from persistent memory on spec.
        persistent_cands = cont_memory.find_reusable_candidates(spec.constraints.allowed_actions)
        best_p = cont_orch.selector.select(persistent_cands, spec.train_examples, cont_orch.analyzer.analyze(spec))
        ev_p = cont_orch.evaluator.evaluate(best_p.selected, spec, seed=seed)
        retained_acc.append(ev_p.held_out_accuracy)

        # Score best retained skill from reset memory on spec.
        reset_cands = reset_memory.find_reusable_candidates(spec.constraints.allowed_actions)
        if reset_cands:
            best_r = cont_orch.selector.select(reset_cands, spec.train_examples, cont_orch.analyzer.analyze(spec))
            ev_r = cont_orch.evaluator.evaluate(best_r.selected, spec, seed=seed)
            reset_acc.append(ev_r.held_out_accuracy)
        else:
            maj_fallback = MajorityBaselineModel().fit(spec.train_examples).predict(spec.test_examples)
            reset_acc.append(mean(int(p == e["label"]) for p, e in zip(maj_fallback, spec.test_examples)))

    mean_initial = mean(initial_acc)
    mean_retained = mean(retained_acc)
    mean_reset = mean(reset_acc)
    forgetting = max(0.0, mean_initial - mean_retained)

    return {
        "seed": seed,
        "base_skills_acquired": int(rep_sum.evaluation.passed) + int(rep_par.evaluation.passed),
        "direct_reuse_succeeded": rep_reuse.reused_skill and rep_reuse.evaluation.passed,
        "direct_reuse_accuracy": rep_reuse.evaluation.held_out_accuracy,
        "compositional_transfer": {
            "composed_skill_used": rep_transfer.composed_skill,
            "held_out_accuracy": rep_transfer.evaluation.held_out_accuracy,
            "no_memory_single_primitive_accuracy": rep_no_memory.evaluation.held_out_accuracy,
            "majority_baseline_accuracy": maj_acc,
            "fixed_rule_baseline_accuracy": fix_acc,
            "random_baseline_accuracy": rnd_acc,
        },
        "continual_learning": {
            "mean_initial_accuracy": mean_initial,
            "persistent_memory_retention_accuracy": mean_retained,
            "reset_memory_ablation_accuracy": mean_reset,
            "forgetting_rate": forgetting,
            "active_skills_count": len(cont_memory.active_skills()),
        },
    }


def evaluate_skill_transfer_and_continual_learning(seeds: List[int]) -> Dict[str, Any]:
    if not seeds:
        raise ValueError("at least one seed required")
    rows = [run_transfer_and_continual_episode(s) for s in seeds]
    comp_acc = mean(r["compositional_transfer"]["held_out_accuracy"] for r in rows)
    no_mem_acc = mean(r["compositional_transfer"]["no_memory_single_primitive_accuracy"] for r in rows)
    maj_acc = mean(r["compositional_transfer"]["majority_baseline_accuracy"] for r in rows)
    fix_acc = mean(r["compositional_transfer"]["fixed_rule_baseline_accuracy"] for r in rows)
    rnd_acc = mean(r["compositional_transfer"]["random_baseline_accuracy"] for r in rows)

    return {
        "n_seeds": len(rows),
        "direct_reuse_rate": mean(float(r["direct_reuse_succeeded"]) for r in rows),
        "mean_direct_reuse_accuracy": mean(r["direct_reuse_accuracy"] for r in rows),
        "compositional_transfer_rate": mean(
            float(r["compositional_transfer"]["composed_skill_used"]) for r in rows
        ),
        "compositional_transfer_accuracy": {
            "skill_memory_composition": comp_acc,
            "no_memory_single_primitive": no_mem_acc,
            "majority_baseline": maj_acc,
            "fixed_rule_baseline": fix_acc,
            "random_baseline": rnd_acc,
        },
        "compositional_gain_over_baselines": {
            "no_memory_single_primitive": comp_acc - no_mem_acc,
            "majority_baseline": comp_acc - maj_acc,
            "fixed_rule_baseline": comp_acc - fix_acc,
            "random_baseline": comp_acc - rnd_acc,
        },
        "continual_learning": {
            "mean_initial_accuracy": mean(r["continual_learning"]["mean_initial_accuracy"] for r in rows),
            "persistent_memory_retention_accuracy": mean(
                r["continual_learning"]["persistent_memory_retention_accuracy"] for r in rows
            ),
            "reset_memory_ablation_accuracy": mean(
                r["continual_learning"]["reset_memory_ablation_accuracy"] for r in rows
            ),
            "mean_forgetting_rate": mean(r["continual_learning"]["forgetting_rate"] for r in rows),
        },
        "rows": rows,
        "limitations": [
            "Skill composition is limited to pairwise conjunctions (sum_threshold AND parity) with matching 2D grid contracts.",
            "Continual learning tasks come from stationary synthetic rule families on an 8x8 grid.",
        ],
    }
