"""M14 — Multi-Operator Compositional Hypothesis & Skill Language.

Extends pairwise conjunctions to a general bounded Boolean/relational combinator
algebra (AND, OR, XOR, AND_NOT) over IOContract-verified skills in SkillMemory,
comparing memory-guided composition against unconstrained depth-2 brute-force
enumeration and depth-1 single primitives.
"""
import random
from statistics import mean
from typing import Any, Dict, List, Optional, Tuple

from .analyzer import TaskAnalyzer
from .candidates import (
    CandidateGenerator,
    CandidateHypothesis,
    FixedRuleBaselineModel,
    MajorityBaselineModel,
    RandomBaselineModel,
)
from .memory import SkillMemory, SkillRecord
from .orchestrator import RIPrototypeOrchestrator
from .selector import CandidateSelector
from .task import TaskSpec, generate_grid_task

COMBINATORS = ("AND", "OR", "XOR", "AND_NOT")


def compose_skill_records(
    left: SkillRecord,
    right: SkillRecord,
    operator: str = "AND",
) -> CandidateHypothesis:
    """Compose two active, contract-compatible SkillRecords under a Boolean combinator."""
    if operator not in COMBINATORS:
        raise ValueError(f"unsupported combinator: {operator}")
    if left.status != "active" or right.status != "active":
        raise ValueError("only active skills can be composed")
    if not left.contract.is_compatible_with(right.contract):
        raise ValueError("incompatible IOContracts for composition")

    comp_id = f"composed_{operator}({left.skill_id}@v{left.version},{right.skill_id}@v{right.version})"
    return CandidateHypothesis(
        candidate_id=comp_id,
        family="composed_op",
        action_name="predict_composed",
        parameters={
            "operator": operator,
            "left_family": left.family,
            "left_params": dict(left.parameters),
            "right_family": right.family,
            "right_params": dict(right.parameters),
        },
        complexity=3,
        source="memory_composition",
        component_skills=(
            f"{left.skill_id}@v{left.version}",
            f"{right.skill_id}@v{right.version}",
        ),
    )


class CompositionalSkillSynthesizer:
    """Synthesize multi-operator composed candidates from SkillMemory or unconstrained primitives."""

    def __init__(self, operators: Tuple[str, ...] = COMBINATORS) -> None:
        for op in operators:
            if op not in COMBINATORS:
                raise ValueError(f"unknown operator: {op}")
        self.operators = tuple(operators)

    def synthesize_from_memory(self, memory: SkillMemory) -> List[CandidateHypothesis]:
        active = [s for s in memory.active_skills() if s.run_unit_tests() and s.family != "composed_op" and s.family != "composed_and"]
        candidates: List[CandidateHypothesis] = []
        for i, left in enumerate(active):
            for j, right in enumerate(active):
                if i == j or left.family == right.family:
                    continue
                for op in self.operators:
                    # For symmetric operators (AND, OR, XOR), only generate one ordering (i < j).
                    if op in ("AND", "OR", "XOR") and i > j:
                        continue
                    candidates.append(compose_skill_records(left, right, operator=op))
        return candidates

    def enumerate_unconstrained_depth2(
        self,
        families: Tuple[str, ...] = ("sum_threshold", "parity", "diff_threshold", "coord_box"),
    ) -> List[CandidateHypothesis]:
        gen = CandidateGenerator()
        primitives = gen.generate(
            allowed_actions=(
                "predict_sum_threshold",
                "predict_parity",
                "predict_diff_threshold",
                "predict_coord_box",
            ),
            include_composed=False,
            extra_families=list(families),
        )
        composed: List[CandidateHypothesis] = []
        for i, left in enumerate(primitives):
            for j, right in enumerate(primitives):
                if i == j or left.family == right.family:
                    continue
                for op in self.operators:
                    if op in ("AND", "OR", "XOR") and i > j:
                        continue
                    cid = f"enum_{op}({left.candidate_id},{right.candidate_id})"
                    composed.append(
                        CandidateHypothesis(
                            candidate_id=cid,
                            family="composed_op",
                            action_name="predict_composed",
                            parameters={
                                "operator": op,
                                "left_family": left.family,
                                "left_params": dict(left.parameters),
                                "right_family": right.family,
                                "right_params": dict(right.parameters),
                            },
                            complexity=3,
                            source="enumerated_depth2",
                        )
                    )
        return composed


def generate_multi_operator_composed_task(
    seed: int,
    operator: str,
    left_family: str,
    left_params: Dict[str, Any],
    right_family: str,
    right_params: Dict[str, Any],
    train_size: int = 14,
    test_size: int = 24,
) -> TaskSpec:
    if operator not in COMBINATORS:
        raise ValueError(f"unsupported operator: {operator}")
    rng = random.Random(seed)
    points = [(x, y) for x in range(8) for y in range(8)]
    rng.shuffle(points)

    def label_fn(x: int, y: int) -> int:
        lv = CandidateHypothesis.eval_primitive(left_family, left_params, x, y)
        rv = CandidateHypothesis.eval_primitive(right_family, right_params, x, y)
        return CandidateHypothesis.apply_operator(operator, lv, rv)

    examples = [{"x": x, "y": y, "label": label_fn(x, y)} for x, y in points]
    train = examples[:train_size]
    test = examples[train_size:train_size + test_size]
    return TaskSpec(
        task_id=f"m14_{operator.lower()}_{left_family}_{right_family}_s{seed}",
        family="composed_op",
        description=f"Classify 8x8 grid by {operator}({left_family}={left_params}, {right_family}={right_params}).",
        train_examples=train,
        test_examples=test,
        metadata={
            "seed": seed,
            "ground_truth_params": {
                "operator": operator,
                "left_family": left_family,
                "left_params": dict(left_params),
                "right_family": right_family,
                "right_params": dict(right_params),
            },
        },
    ).validate()


def evaluate_compositional_language(
    seeds: List[int],
    train_size: int = 14,
    test_size: int = 24,
) -> Dict[str, Any]:
    """Compare memory_guided_composition, unconstrained_depth2, and single_primitive_only."""
    if not seeds:
        raise ValueError("at least one seed required")

    synthesizer = CompositionalSkillSynthesizer(COMBINATORS)
    analyzer = TaskAnalyzer()
    selector = CandidateSelector(complexity_weight=0.01, reuse_bonus=0.005)
    generator = CandidateGenerator()

    # Precompute the unconstrained depth-2 pool once (deterministic and stateless) to measure search size.
    unconstrained_pool = synthesizer.enumerate_unconstrained_depth2(
        families=("sum_threshold", "parity", "diff_threshold", "coord_box")
    )
    single_primitives = generator.generate(
        allowed_actions=(
            "predict_sum_threshold",
            "predict_parity",
            "predict_diff_threshold",
            "predict_coord_box",
        ),
        include_composed=False,
        extra_families=["sum_threshold", "parity", "diff_threshold", "coord_box"],
    )

    pair_templates = (
        ("sum_threshold", "parity"),
        ("sum_threshold", "diff_threshold"),
        ("coord_box", "parity"),
    )

    rows: List[Dict[str, Any]] = []
    for idx, seed in enumerate(seeds):
        operator = COMBINATORS[idx % len(COMBINATORS)]
        left_fam, right_fam = pair_templates[idx % len(pair_templates)]

        t_val = 6 + (seed % 4)
        p_val = seed % 2
        d_val = (seed % 3) - 1
        bx_val = 2 + (seed % 2)
        by_val = 2 + ((seed // 2) % 2)

        param_map = {
            "sum_threshold": {"threshold": t_val},
            "parity": {"parity": p_val},
            "diff_threshold": {"threshold": d_val},
            "coord_box": {"min_x": bx_val, "min_y": by_val},
        }
        left_params = param_map[left_fam]
        right_params = param_map[right_fam]

        # Step 1: Acquire base skills into SkillMemory on abundant development data (train_size=28).
        memory = SkillMemory()
        acq_orch = RIPrototypeOrchestrator(memory=memory, enable_learning_loop=True)
        for p_idx, (fam_name, fam_params) in enumerate(((left_fam, left_params), (right_fam, right_params))):
            t_spec = generate_grid_task(
                seed=seed * 20 + p_idx + 1,
                family=fam_name,
                train_size=28,
                test_size=24,
                parameter_override=fam_params,
            )
            acq_orch.run_task(t_spec, seed=seed, persist_skill=True)

        # Step 2: Generate the held-out multi-operator composed task with moderate train_size (default 14).
        comp_task = generate_multi_operator_composed_task(
            seed=seed * 20 + 9,
            operator=operator,
            left_family=left_fam,
            left_params=left_params,
            right_family=right_fam,
            right_params=right_params,
            train_size=train_size,
            test_size=test_size,
        )
        analysis = analyzer.analyze(comp_task)

        # Policy A: Memory-guided composition (composes only verified skills in SkillMemory + primitives).
        mem_composed = synthesizer.synthesize_from_memory(memory)
        mem_candidates = mem_composed + [s.to_candidate() for s in memory.active_skills()]
        dec_mem = selector.select(mem_candidates, comp_task.train_examples, analysis)
        acc_mem = mean(
            int(dec_mem.selected.predict_one(e["x"], e["y"]) == e["label"])
            for e in comp_task.test_examples
        )

        # Policy B: Unconstrained depth-2 enumeration without SkillMemory priors.
        enum_candidates = single_primitives + unconstrained_pool
        dec_enum = selector.select(enum_candidates, comp_task.train_examples, analysis)
        acc_enum = mean(
            int(dec_enum.selected.predict_one(e["x"], e["y"]) == e["label"])
            for e in comp_task.test_examples
        )

        # Policy C: Single primitive only (depth 1).
        dec_prim = selector.select(single_primitives, comp_task.train_examples, analysis)
        acc_prim = mean(
            int(dec_prim.selected.predict_one(e["x"], e["y"]) == e["label"])
            for e in comp_task.test_examples
        )

        maj_preds = MajorityBaselineModel().fit(comp_task.train_examples).predict(comp_task.test_examples)
        fix_preds = FixedRuleBaselineModel(threshold=7).fit(comp_task.train_examples).predict(comp_task.test_examples)
        rnd_preds = RandomBaselineModel(seed=seed + 80_000).fit(comp_task.train_examples).predict(comp_task.test_examples)

        rows.append(
            {
                "seed": seed,
                "operator": operator,
                "left_family": left_fam,
                "right_family": right_fam,
                "memory_guided_composition": {
                    "train_accuracy": dec_mem.train_accuracy,
                    "held_out_accuracy": acc_mem,
                    "n_candidates_evaluated": dec_mem.n_candidates_evaluated,
                    "operator_matched": dec_mem.selected.parameters.get("operator") == operator,
                },
                "unconstrained_depth2_enumeration": {
                    "train_accuracy": dec_enum.train_accuracy,
                    "held_out_accuracy": acc_enum,
                    "n_candidates_evaluated": dec_enum.n_candidates_evaluated,
                    "operator_matched": dec_enum.selected.parameters.get("operator") == operator,
                },
                "single_primitive_only": {
                    "train_accuracy": dec_prim.train_accuracy,
                    "held_out_accuracy": acc_prim,
                    "n_candidates_evaluated": dec_prim.n_candidates_evaluated,
                },
                "baselines": {
                    "majority": mean(int(p == e["label"]) for p, e in zip(maj_preds, comp_task.test_examples)),
                    "fixed_rule": mean(int(p == e["label"]) for p, e in zip(fix_preds, comp_task.test_examples)),
                    "random": mean(int(p == e["label"]) for p, e in zip(rnd_preds, comp_task.test_examples)),
                },
            }
        )

    by_operator: Dict[str, Any] = {}
    for op in COMBINATORS:
        op_rows = [r for r in rows if r["operator"] == op]
        if op_rows:
            by_operator[op] = {
                "n_episodes": len(op_rows),
                "memory_guided_held_out_accuracy": mean(
                    r["memory_guided_composition"]["held_out_accuracy"] for r in op_rows
                ),
                "unconstrained_depth2_held_out_accuracy": mean(
                    r["unconstrained_depth2_enumeration"]["held_out_accuracy"] for r in op_rows
                ),
                "single_primitive_held_out_accuracy": mean(
                    r["single_primitive_only"]["held_out_accuracy"] for r in op_rows
                ),
            }

    mem_mean = mean(r["memory_guided_composition"]["held_out_accuracy"] for r in rows)
    enum_mean = mean(r["unconstrained_depth2_enumeration"]["held_out_accuracy"] for r in rows)
    prim_mean = mean(r["single_primitive_only"]["held_out_accuracy"] for r in rows)
    maj_mean = mean(r["baselines"]["majority"] for r in rows)

    mem_cands = mean(r["memory_guided_composition"]["n_candidates_evaluated"] for r in rows)
    enum_cands = mean(r["unconstrained_depth2_enumeration"]["n_candidates_evaluated"] for r in rows)

    return {
        "n_seeds": len(rows),
        "train_size": train_size,
        "test_size": test_size,
        "operators_tested": list(COMBINATORS),
        "policies": {
            "memory_guided_composition": {
                "mean_train_accuracy": mean(r["memory_guided_composition"]["train_accuracy"] for r in rows),
                "mean_held_out_accuracy": mem_mean,
                "overfitting_gap": mean(
                    r["memory_guided_composition"]["train_accuracy"]
                    - r["memory_guided_composition"]["held_out_accuracy"]
                    for r in rows
                ),
                "operator_recovery_rate": mean(
                    float(r["memory_guided_composition"]["operator_matched"]) for r in rows
                ),
                "mean_candidates_evaluated": mem_cands,
            },
            "unconstrained_depth2_enumeration": {
                "mean_train_accuracy": mean(
                    r["unconstrained_depth2_enumeration"]["train_accuracy"] for r in rows
                ),
                "mean_held_out_accuracy": enum_mean,
                "overfitting_gap": mean(
                    r["unconstrained_depth2_enumeration"]["train_accuracy"]
                    - r["unconstrained_depth2_enumeration"]["held_out_accuracy"]
                    for r in rows
                ),
                "operator_recovery_rate": mean(
                    float(r["unconstrained_depth2_enumeration"]["operator_matched"]) for r in rows
                ),
                "mean_candidates_evaluated": enum_cands,
            },
            "single_primitive_only": {
                "mean_train_accuracy": mean(r["single_primitive_only"]["train_accuracy"] for r in rows),
                "mean_held_out_accuracy": prim_mean,
                "mean_candidates_evaluated": mean(
                    r["single_primitive_only"]["n_candidates_evaluated"] for r in rows
                ),
            },
        },
        "search_compression_ratio": round(enum_cands / max(1.0, mem_cands), 2),
        "by_operator": by_operator,
        "baselines": {
            "majority": maj_mean,
            "fixed_rule": mean(r["baselines"]["fixed_rule"] for r in rows),
            "random": mean(r["baselines"]["random"] for r in rows),
        },
        "memory_guided_gain": {
            "vs_unconstrained_depth2": mem_mean - enum_mean,
            "vs_single_primitive": mem_mean - prim_mean,
            "vs_majority": mem_mean - maj_mean,
        },
        "rows": rows,
        "limitations": [
            "Compositional expressions are bounded to depth-2 binary Boolean operators over 2D grid skills.",
            "Memory-guided composition requires that relevant base skills were previously acquired and verified.",
        ],
    }
