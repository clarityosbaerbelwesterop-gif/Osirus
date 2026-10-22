"""CLI entry point for the RI M10–M12 Prototype.

Usage from repository root:
  python RI/run_prototype.py
  python RI/run_prototype.py --mode demo
  python RI/run_prototype.py --mode benchmark --seeds 0 1 2 ... 29
"""
import argparse
import json
from pathlib import Path
from statistics import mean
from typing import Any, Dict, List

from prototype.active_query import (
    ActiveBoundaryQuerier,
    evaluate_active_boundary_querying,
)
from prototype.compositional_language import (
    CompositionalSkillSynthesizer,
    evaluate_compositional_language,
    generate_multi_operator_composed_task,
)
from prototype.drift_and_noise import (
    DriftAndNoiseController,
    evaluate_drift_and_noise_robustness,
    run_drift_stream_episode,
)
from prototype.memory import SkillMemory
from prototype.orchestrator import RIPrototypeOrchestrator
from prototype.self_improvement import (
    GuardedSelfImprover,
    PrototypeConfig,
    propose_configuration_improvement,
)
from prototype.task import TaskSpec, ensure_no_secrets, generate_grid_task
from prototype.transfer import evaluate_skill_transfer_and_continual_learning

ROOT = Path(__file__).resolve().parent


def run_demo(output_path: Path, memory_path: Path) -> Dict[str, Any]:
    """Run a 5-stage end-to-end demonstration of M10–M12 capabilities."""
    if memory_path.exists():
        memory_path.unlink()
    memory = SkillMemory(storage_path=memory_path)
    orchestrator = RIPrototypeOrchestrator(memory=memory, enable_learning_loop=True)

    tasks = [
        generate_grid_task(
            seed=10,
            family="sum_threshold",
            train_size=20,
            test_size=24,
            task_id="demo_1_acquire_sum_threshold",
            parameter_override={"threshold": 6},
        ),
        generate_grid_task(
            seed=20,
            family="parity",
            train_size=20,
            test_size=24,
            task_id="demo_2_acquire_parity",
            parameter_override={"parity": 0},
        ),
        generate_grid_task(
            seed=30,
            family="sum_threshold",
            train_size=16,
            test_size=24,
            task_id="demo_3_reuse_sum_threshold",
            parameter_override={"threshold": 6},
        ),
        generate_grid_task(
            seed=40,
            family="composed_and",
            train_size=20,
            test_size=24,
            task_id="demo_4_compose_sum_and_parity",
            parameter_override={"threshold": 6, "parity": 0},
        ),
        generate_grid_task(
            seed=50,
            family="mod_sum",
            train_size=24,
            test_size=24,
            task_id="demo_5_learning_loop_mod_sum",
            parameter_override={"modulus": 3, "remainder": 1},
        ),
    ]

    reports = []
    for idx, task in enumerate(tasks):
        rep = orchestrator.run_task(task, seed=idx, persist_skill=True)
        reports.append(rep.to_dict())

    # M13 Demo: Active boundary disambiguation on a small sample (train_size=8, pool=32).
    m13_full = generate_grid_task(
        seed=60,
        family="sum_threshold",
        train_size=40,
        test_size=24,
        task_id="demo_6_m13_active_boundary_query",
        parameter_override={"threshold": 8},
    )
    m13_cands = orchestrator.generator.generate(
        allowed_actions=m13_full.constraints.allowed_actions,
        include_composed=False,
        extra_families=["sum_threshold", "parity", "diff_threshold"],
    )
    querier = ActiveBoundaryQuerier(policy="active_disagreement", budget=3, seed=60)
    aug_train, q_trace = querier.query_and_augment(
        m13_cands,
        m13_full.train_examples[:8],
        m13_full.train_examples[8:],
    )
    m13_dec = orchestrator.selector.select(m13_cands, aug_train, orchestrator.analyzer.analyze(m13_full))
    m13_acc = mean(
        int(m13_dec.selected.predict_one(e["x"], e["y"]) == e["label"])
        for e in m13_full.test_examples
    )

    # M14 Demo: Synthesize XOR composition from stored skills in memory.
    synthesizer = CompositionalSkillSynthesizer()
    xor_task = generate_multi_operator_composed_task(
        seed=70,
        operator="XOR",
        left_family="sum_threshold",
        left_params={"threshold": 6},
        right_family="parity",
        right_params={"parity": 0},
        train_size=14,
        test_size=24,
    )
    mem_comp_cands = synthesizer.synthesize_from_memory(memory)
    m14_dec = orchestrator.selector.select(
        mem_comp_cands,
        xor_task.train_examples,
        orchestrator.analyzer.analyze(xor_task),
    )
    m14_acc = mean(
        int(m14_dec.selected.predict_one(e["x"], e["y"]) == e["label"])
        for e in xor_task.test_examples
    )

    # M15 Demo: 5-phase continual drift & noise stream episode.
    m15_demo_ep = run_drift_stream_episode(seed=0)

    summary = {
        "mode": "demo",
        "n_tasks": len(reports),
        "success_rate": mean(float(r["passed"]) for r in reports),
        "mean_held_out_accuracy": mean(r["evaluation"]["held_out_accuracy"] for r in reports),
        "mean_runtime_ms": round(mean(r["total_runtime_ms"] for r in reports), 4),
        "skills_reused_count": sum(1 for r in reports if r["reused_skill"]),
        "skills_composed_count": sum(1 for r in reports if r["composed_skill"]),
        "learning_loop_triggered_count": sum(1 for r in reports if r["learning_loop"]["triggered"]),
        "baseline_mean_held_out_accuracy": {
            "majority": mean(r["evaluation"]["baselines"]["majority"] for r in reports),
            "fixed_rule": mean(r["evaluation"]["baselines"]["fixed_rule"] for r in reports),
            "random": mean(r["evaluation"]["baselines"]["random"] for r in reports),
        },
        "m13_active_query_demo": {
            "initial_version_space_size": q_trace.initial_version_space_size,
            "final_version_space_size": q_trace.final_version_space_size,
            "queries_used": q_trace.queries_used,
            "tie_resolved": q_trace.tie_resolved,
            "selected_candidate_id": m13_dec.selected.candidate_id,
            "held_out_accuracy": m13_acc,
        },
        "m14_compositional_language_demo": {
            "task_operator": "XOR",
            "n_memory_compositions_evaluated": len(mem_comp_cands),
            "selected_candidate_id": m14_dec.selected.candidate_id,
            "held_out_accuracy": m14_acc,
        },
        "m15_drift_and_noise_demo": {
            "guarded_stream_accuracy": m15_demo_ep["policies"]["guarded_drift_controller"]["mean_stream_accuracy"],
            "naive_overwrite_stream_accuracy": m15_demo_ep["policies"]["naive_overwrite"]["mean_stream_accuracy"],
            "static_frozen_stream_accuracy": m15_demo_ep["policies"]["static_frozen"]["mean_stream_accuracy"],
            "guarded_actions_by_phase": {
                k: v["action_taken"]
                for k, v in m15_demo_ep["policies"]["guarded_drift_controller"]["phases"].items()
            },
        },
        "skill_memory_summary": memory.summary(),
        "tasks": reports,
        "limitations": [
            "Operate over bounded discrete 8x8 grid rule families; not a general intelligence system.",
            "All candidate actions are restricted to an explicit allow-list with step and timeout bounds.",
        ],
    }
    raw = json.dumps(summary, indent=2) + "\n"
    ensure_no_secrets(raw)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(raw, encoding="utf-8")
    return summary


def run_benchmark(seeds: List[int], output_path: Path) -> Dict[str, Any]:
    """Run multi-seed benchmarks for M10 (end-to-end), M11 (transfer/continual), and M12 (self-improvement)."""
    if not seeds:
        raise ValueError("at least one seed required")

    # M10: End-to-end multi-seed evaluation across all 6 task families.
    families = ("sum_threshold", "parity", "diff_threshold", "mod_sum", "coord_box", "composed_and")
    m10_rows = []
    for idx, seed in enumerate(seeds):
        fam = families[idx % len(families)]
        task = generate_grid_task(seed=seed + 500, family=fam, train_size=22, test_size=24)
        orch = RIPrototypeOrchestrator(memory=SkillMemory(), enable_learning_loop=True)
        rep = orch.run_task(task, seed=seed, persist_skill=True)
        m10_rows.append(
            {
                "seed": seed,
                "task_id": task.task_id,
                "family": fam,
                "passed": rep.evaluation.passed,
                "train_accuracy": rep.evaluation.train_accuracy,
                "held_out_accuracy": rep.evaluation.held_out_accuracy,
                "baselines": rep.evaluation.baselines,
                "learning_loop_triggered": rep.refinement.triggered,
                "runtime_ms": round(rep.total_runtime_ms, 4),
            }
        )

    m10_acc = mean(r["held_out_accuracy"] for r in m10_rows)
    m10_maj = mean(r["baselines"]["majority"] for r in m10_rows)
    m10_fix = mean(r["baselines"]["fixed_rule"] for r in m10_rows)
    m10_rnd = mean(r["baselines"]["random"] for r in m10_rows)

    m10_summary = {
        "n_seeds": len(m10_rows),
        "task_pass_rate": mean(float(r["passed"]) for r in m10_rows),
        "mean_train_accuracy": mean(r["train_accuracy"] for r in m10_rows),
        "mean_held_out_accuracy": m10_acc,
        "mean_runtime_ms": round(mean(r["runtime_ms"] for r in m10_rows), 4),
        "learning_loop_trigger_rate": mean(float(r["learning_loop_triggered"]) for r in m10_rows),
        "baselines": {
            "majority": m10_maj,
            "fixed_rule": m10_fix,
            "random": m10_rnd,
        },
        "mean_gain_over_baselines": {
            "majority": m10_acc - m10_maj,
            "fixed_rule": m10_acc - m10_fix,
            "random": m10_acc - m10_rnd,
        },
        "rows": m10_rows,
    }

    # M11: Skill memory, reuse, compositional transfer, and continual learning.
    m11_summary = evaluate_skill_transfer_and_continual_learning(seeds)

    # M12: Guarded self-improvement gate evaluation.
    baseline_cfg = PrototypeConfig(version=1, enable_learning_loop=False, complexity_weight=0.02)
    candidate_cfg = propose_configuration_improvement(baseline_cfg, "composed_and_modular_tasks")
    improver = GuardedSelfImprover(minimum_gain=0.05, max_regression_drop=0.0)
    m12_summary = improver.evaluate_candidate(baseline_cfg, candidate_cfg, held_out_seeds=seeds)

    # M13: Active boundary querying for hypothesis disambiguation.
    m13_summary = evaluate_active_boundary_querying(seeds)

    # M14: Multi-operator compositional skill language (AND, OR, XOR, AND_NOT).
    m14_summary = evaluate_compositional_language(seeds)

    # M15: Non-stationary concept drift, label noise robustness, quarantine & rollback.
    m15_summary = evaluate_drift_and_noise_robustness(seeds)

    payload = {
        "n_seeds": len(seeds),
        "m10_end_to_end": m10_summary,
        "m11_skill_transfer_and_continual": m11_summary,
        "m12_guarded_self_improvement": m12_summary,
        "m13_active_boundary_querying": m13_summary,
        "m14_compositional_skill_language": m14_summary,
        "m15_drift_and_noise_robustness": m15_summary,
        "limitations": [
            "All evaluations operate on synthetic 8x8 discrete grid rule families.",
            "Results validate the software architecture, bounded hypothesis search, active boundary querying, compositional skill reuse, drift handling, and promotion gates—not general intelligence.",
        ],
    }
    raw = json.dumps(payload, indent=2) + "\n"
    ensure_no_secrets(raw)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(raw, encoding="utf-8")
    return payload


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Run the RI M10–M12 Prototype.")
    parser.add_argument(
        "--mode",
        choices=("demo", "benchmark", "all"),
        default="demo",
        help="Execution mode: 'demo' (5-task walkthrough), 'benchmark' (30-seed M10–M12), or 'all'.",
    )
    parser.add_argument("--seeds", nargs="+", type=int, default=list(range(30)))
    parser.add_argument(
        "--demo-output",
        default=str(ROOT / "results/prototype_demo_report.json"),
    )
    parser.add_argument(
        "--memory-output",
        default=str(ROOT / "results/prototype_skill_memory.json"),
    )
    parser.add_argument(
        "--benchmark-output",
        default=str(ROOT / "results/prototype_benchmark.json"),
    )
    args = parser.parse_args(argv)

    if args.mode in ("demo", "all"):
        demo_res = run_demo(Path(args.demo_output), Path(args.memory_output))
        print(
            json.dumps(
                {k: v for k, v in demo_res.items() if k not in ("tasks", "skill_memory_summary")},
                indent=2,
            )
        )

    if args.mode in ("benchmark", "all"):
        bench_res = run_benchmark(args.seeds, Path(args.benchmark_output))
        compact = {
            "n_seeds": bench_res["n_seeds"],
            "m10_end_to_end": {
                k: v for k, v in bench_res["m10_end_to_end"].items() if k != "rows"
            },
            "m11_skill_transfer_and_continual": {
                k: v for k, v in bench_res["m11_skill_transfer_and_continual"].items() if k != "rows"
            },
            "m12_guarded_self_improvement": {
                k: v for k, v in bench_res["m12_guarded_self_improvement"].items() if k != "rows"
            },
            "m13_active_boundary_querying": {
                k: v for k, v in bench_res["m13_active_boundary_querying"].items() if k != "rows"
            },
            "m14_compositional_skill_language": {
                k: v for k, v in bench_res["m14_compositional_skill_language"].items() if k != "rows"
            },
            "m15_drift_and_noise_robustness": {
                k: v for k, v in bench_res["m15_drift_and_noise_robustness"].items() if k != "rows"
            },
        }
        print(json.dumps(compact, indent=2))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
