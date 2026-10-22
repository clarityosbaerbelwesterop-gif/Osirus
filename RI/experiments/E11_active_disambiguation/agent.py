"""M18 (E11) — Active Disambiguation & Experimental Intervention Pipeline.

Implements the deterministic M18 pipeline integrated with the M17 6-stage safety lifecycle:
  Hypothesenmenge -> Äquivalenzprüfung -> Informative Experimente -> Auswahl ->
  Beobachtung -> Hypothesenaktualisierung -> Unabhängige Validierung (M17 Stage 2) ->
  Adversarial Checks (M17 Stage 3) -> Quarantine / Abstention oder Promotion / Rollback.

Also implements all required comparison systems and ablations:
  1. ri_full: Active Disambiguation + Equivalence Check + Corroborated Uncertainty + M17 Guard
  2. random_intervention: Seeded random intervention selection + M17 Guard
  3. fixed_heuristic: Surface diversity/complexity heuristic selection + M17 Guard
  4. no_active_selection: Selection without information value calculation + M17 Guard
  5. no_equivalence_check: Active Disambiguation without semantic equivalence collapsing + M17 Guard
  6. no_m17_guard: Isolated non-productive ablation without M17 validation/adversarial/ambiguity guard
     (hard-blocked from mutating productive SkillMemory)
"""
from collections import Counter
from dataclasses import dataclass, field
from functools import lru_cache
import math
import random
from typing import Any, Dict, List, Optional, Tuple

from environment import (
    ADMISSIBLE_INTERVENTION_POSITIONS,
    ADMISSIBLE_INTERVENTION_SIZE_RANGE,
    CHARGES,
    COLORS,
    POSITIONS,
    SIZES,
    ExperimentalInterventionOracle,
    InterventionSceneGenerator,
    eval_combinator,
    eval_m16_base_primitive,
    eval_subprimitive_dsl,
    scene_canonical_key,
    validate_admissible_intervention_scene,
    validate_scene_objects,
)

BINARY_COMBINATORS = ("AND", "OR", "XOR", "AND_NOT")

PRE_REGISTERED_M18_GATE = {
    "min_train_accuracy": 0.90,
    "min_val_accuracy": 0.85,
    "min_independent_size_val_accuracy": 0.85,
    "min_gain_over_base_grammar": 0.12,
    "require_permutation_invariance": True,
    "require_non_degenerate_large_size_support": True,
    "max_surviving_semantic_classes": 1,
    "max_regression_drop": 0.0,
    "assumed_observation_noise": 0.20,
    "max_noisy_mismatches": 1,
    "min_noisy_corroboration_margin": 2,
}


def build_probe_scenes(seed: int = 2027, n_probes: int = 48) -> List[List[Dict[str, int]]]:
    """Fixed unlabeled probe scenes spanning the full defined domain (N in [2..11], pos in [0..11]).

    Includes targeted single-color, pairwise delta, dipole, and large-scale scenes so that
    semantically distinct DSL primitives always produce distinct truth-table signatures, while
    syntactically distinct equivalent forms produce identical truth-table signatures.
    """
    rng = random.Random(seed)
    probes: List[List[Dict[str, int]]] = []

    # Targeted diagnostic probe scenes (unlabeled) covering all attribute decouplings:
    for c in COLORS:
        probes.append(
            [
                {"color": c, "size": 2, "charge": 1, "pos": 0},
                {"color": (c + 1) % 3, "size": 4, "charge": 0, "pos": 3},
                {"color": (c + 2) % 3, "size": 5, "charge": 0, "pos": 7},
            ]
        )
        probes.append(
            [
                {"color": c, "size": 2, "charge": 1, "pos": 0},
                {"color": c, "size": 5, "charge": 1, "pos": 2},
                {"color": c, "size": 4, "charge": 0, "pos": 6},
            ]
        )
        probes.append(
            [
                {"color": c, "size": 3, "charge": 1, "pos": 1},
                {"color": c, "size": 3, "charge": 0, "pos": 2},
                {"color": (c + 1) % 3, "size": 1, "charge": 0, "pos": 8},
            ]
        )
    for s in (3, 4):
        probes.append(
            [
                {"color": 0, "size": s, "charge": 1, "pos": 0},
                {"color": 1, "size": s, "charge": 1, "pos": 4},
                {"color": 2, "size": 1, "charge": 0, "pos": 9},
            ]
        )
    for c1 in (0, 1):
        for delta in (1, 2, 3):
            probes.append(
                [
                    {"color": c1, "size": 2, "charge": 0, "pos": 0},
                    {"color": 2, "size": 2 + delta, "charge": 0, "pos": 5},
                    {"color": 1, "size": 1, "charge": 0, "pos": 10},
                ]
            )

    while len(probes) < n_probes:
        n_obj = 3 + (len(probes) % 8)
        objs = [
            {
                "color": rng.choice(COLORS),
                "size": rng.choice(SIZES),
                "charge": rng.choice(CHARGES),
                "pos": rng.choice(POSITIONS),
            }
            for _ in range(n_obj)
        ]
        probes.append(objs)
    return probes


CANONICAL_PROBE_SCENES = build_probe_scenes()
LARGE_PROBE_SCENES = [s for s in CANONICAL_PROBE_SCENES if len(s) >= 7]


@dataclass(frozen=True)
class CandidateRuleAST:
    """Explicit AST representing an M16 base rule, a synthesized sub-primitive, or a composition."""

    candidate_id: str
    origin: str  # "m16_base", "synthesized_subprimitive", "syntactic_equivalent_twin", "memory_composition"
    combinator: str
    left_kind: str  # "m16_base" or "subprimitive"
    left_name: str
    left_params: Dict[str, Any]
    right_kind: Optional[str] = None
    right_name: Optional[str] = None
    right_params: Optional[Dict[str, Any]] = None
    depth: int = 1
    complexity: int = 1

    def _eval_node(self, kind: str, name: str, params: Dict[str, Any], objects: List[Dict[str, int]]) -> int:
        if kind == "m16_base":
            return eval_m16_base_primitive(name, params, objects)
        if kind == "subprimitive":
            return eval_subprimitive_dsl(name, params, objects)
        raise ValueError(f"unknown node kind: {kind}")

    def predict_scene_unchecked(self, objects: List[Dict[str, int]]) -> int:
        lv = self._eval_node(self.left_kind, self.left_name, self.left_params, objects)
        if self.combinator in ("ID", "NOT"):
            return eval_combinator(self.combinator, lv)
        if self.right_kind is None or self.right_name is None or self.right_params is None:
            raise ValueError("binary combinator requires right node")
        rv = self._eval_node(self.right_kind, self.right_name, self.right_params, objects)
        return eval_combinator(self.combinator, lv, rv)

    def predict_scene(self, objects: List[Dict[str, int]]) -> int:
        validate_scene_objects(objects)
        return self.predict_scene_unchecked(objects)

    def predict_all(self, examples: List[Dict[str, Any]]) -> List[int]:
        for ex in examples:
            if "label" in ex:
                raise ValueError("test examples passed to predict_all() must not contain 'label'")
            validate_scene_objects(ex["objects"])
        return [self.predict_scene_unchecked(ex["objects"]) for ex in examples]

    def format_dsl(self) -> str:
        l_str = f"{self.left_kind}:{self.left_name}({self.left_params})"
        if self.combinator == "ID":
            return l_str
        if self.combinator == "NOT":
            return f"NOT({l_str})"
        r_str = f"{self.right_kind}:{self.right_name}({self.right_params})"
        return f"{self.combinator}({l_str}, {r_str})"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "candidate_id": self.candidate_id,
            "origin": self.origin,
            "expression": self.format_dsl(),
            "combinator": self.combinator,
            "left_kind": self.left_kind,
            "left_name": self.left_name,
            "left_params": dict(self.left_params),
            "right_kind": self.right_kind,
            "right_name": self.right_name,
            "right_params": dict(self.right_params) if self.right_params is not None else None,
            "depth": self.depth,
            "complexity": self.complexity,
        }


def truth_table_signature(
    cand: CandidateRuleAST,
    probes: List[List[Dict[str, int]]] = CANONICAL_PROBE_SCENES,
) -> Tuple[int, ...]:
    return tuple(cand.predict_scene_unchecked(s) for s in probes)


def check_permutation_invariance(
    cand: CandidateRuleAST,
    scenes: List[List[Dict[str, int]]] = CANONICAL_PROBE_SCENES,
    seed: int = 909,
) -> bool:
    """Verify that shuffling object order in scenes never alters the candidate's output."""
    rng = random.Random(seed)
    for scene in scenes:
        orig_pred = cand.predict_scene_unchecked(scene)
        for _ in range(3):
            shuffled = list(scene)
            rng.shuffle(shuffled)
            if cand.predict_scene_unchecked(shuffled) != orig_pred:
                return False
    return True


def check_large_size_support(
    cand: CandidateRuleAST,
    large_scenes: List[List[Dict[str, int]]] = LARGE_PROBE_SCENES,
) -> bool:
    """Verify that the candidate does not collapse to a constant 0 or 1 across all large scenes (N >= 7)."""
    preds = {cand.predict_scene_unchecked(s) for s in large_scenes}
    return len(preds) > 1


class SubPrimitiveSynthesizer:
    """Bounded enumerative synthesizer over the M16 base grammar and the M17/M18 sub-primitive DSL."""

    def __init__(self, max_base_candidates: int = 160, max_dsl_candidates: int = 72) -> None:
        if max_base_candidates < 1 or max_dsl_candidates < 1:
            raise ValueError("candidate budgets must be >= 1")
        self.max_base_candidates = max_base_candidates
        self.max_dsl_candidates = max_dsl_candidates

    @staticmethod
    def enumerate_m16_base_primitives() -> List[Tuple[str, Dict[str, Any], int]]:
        prims: List[Tuple[str, Dict[str, Any], int]] = []
        for c in COLORS:
            for s in (4, 5, 6):
                prims.append(("exists_color_size_ge", {"color": c, "min_size": s}, 1))
        for s in (2, 3, 4):
            prims.append(("all_size_ge", {"min_size": s}, 1))
        for num, den in ((1, 3), (1, 2), (2, 3)):
            prims.append(("charge_ratio_ge", {"num": num, "den": den}, 1))
        for p in (0, 1):
            prims.append(("parity_sum_charge", {"parity": p}, 1))
        for ch in (0, 1):
            prims.append(("argmax_size_has_charge", {"charge": ch}, 2))
        for c in COLORS:
            prims.append(("argmax_size_has_color", {"color": c}, 2))
        return prims

    @staticmethod
    def enumerate_dsl_subprimitives(include_equivalent_twins: bool = True) -> List[Tuple[str, Dict[str, Any], int, str]]:
        """Enumerate candidate sub-primitives from the bounded M17/M18 DSL."""
        dsl: List[Tuple[str, Dict[str, Any], int, str]] = []
        # 1. Pair color size delta
        for c1 in (0, 1):
            for c2 in (1, 2):
                if c1 == c2:
                    continue
                for delta in (1, 2, 3):
                    dsl.append(
                        ("pair_color_size_delta", {"c1": c1, "c2": c2, "delta": delta}, 2, "synthesized_subprimitive")
                    )

        # 2. Pair proximal dipole
        for c in COLORS:
            for gap in (1, 2, 3):
                dsl.append(("pair_proximal_dipole", {"color": c, "max_gap": gap}, 2, "synthesized_subprimitive"))

        # 3. Triad monotone size across distinct colors
        for ch in (0, 1):
            dsl.append(("triad_monotone_size_distinct_color", {"charge": ch}, 3, "synthesized_subprimitive"))

        # 4. Non-vacuous universal color charge
        for c in COLORS:
            for ch in (0, 1):
                dsl.append(("forall_color_charged", {"color": c, "charge": ch}, 2, "synthesized_subprimitive"))

        # 5. Pair same color charged & pair same size charged (competing relational hypotheses)
        for c in COLORS:
            dsl.append(("pair_same_color_charged", {"color": c}, 2, "synthesized_subprimitive"))
        for s in (2, 3, 4, 5):
            dsl.append(("pair_same_size_charged", {"size": s}, 2, "synthesized_subprimitive"))

        # 6. Syntactically distinct, semantically equivalent twins (for Family C & Equivalence Check audit)
        if include_equivalent_twins:
            for c in COLORS:
                dsl.append(
                    ("no_color_opposite_charge", {"color": c, "charge": 1}, 3, "syntactic_equivalent_twin")
                )
            for c1 in (0, 1):
                for delta in (2, 3):
                    dsl.append(
                        (
                            "converse_pair_size_deficit",
                            {"c2": 2, "c1": c1, "delta": delta},
                            3,
                            "syntactic_equivalent_twin",
                        )
                    )
            for c in COLORS:
                for gap in (1, 2):
                    dsl.append(
                        (
                            "symmetric_charge_split_within_gap",
                            {"color": c, "max_gap": gap},
                            3,
                            "syntactic_equivalent_twin",
                        )
                    )

        # 7. Spurious / non-invariant templates in raw search space (caught by M17 adversarial checks)
        for ch in (0, 1):
            dsl.append(("spurious_slot0_charge", {"charge": ch}, 1, "synthesized_subprimitive"))
        for max_cnt in (4, 5):
            for c in COLORS:
                dsl.append(
                    ("spurious_exact_count_and_color", {"max_count": max_cnt, "color": c}, 1, "synthesized_subprimitive")
                )

        return dsl

    def generate_m16_base_grammar(self, include_depth2: bool = True) -> List[CandidateRuleAST]:
        return list(_cached_m16_base_grammar(self.max_base_candidates, include_depth2))

    def synthesize_subprimitive_candidates(self, include_equivalent_twins: bool = True) -> List[CandidateRuleAST]:
        return list(_cached_dsl_subprimitives(self.max_dsl_candidates, include_equivalent_twins))


@lru_cache(maxsize=32)
def _cached_m16_base_grammar(max_candidates: int, include_depth2: bool) -> Tuple[CandidateRuleAST, ...]:
    prims = SubPrimitiveSynthesizer.enumerate_m16_base_primitives()
    raw: List[CandidateRuleAST] = []
    for idx, (name, params, comp) in enumerate(prims):
        raw.append(
            CandidateRuleAST(
                candidate_id=f"m16_d1_id_{idx}_{name}",
                origin="m16_base",
                combinator="ID",
                left_kind="m16_base",
                left_name=name,
                left_params=dict(params),
                depth=1,
                complexity=comp,
            )
        )
        raw.append(
            CandidateRuleAST(
                candidate_id=f"m16_d1_not_{idx}_{name}",
                origin="m16_base",
                combinator="NOT",
                left_kind="m16_base",
                left_name=name,
                left_params=dict(params),
                depth=1,
                complexity=comp + 1,
            )
        )
    if include_depth2:
        core = [p for p in prims if p[0] in ("exists_color_size_ge", "parity_sum_charge", "charge_ratio_ge")]
        for i, (ln, lp, lc) in enumerate(core):
            for j, (rn, rp, rc) in enumerate(core):
                if i >= j or ln == rn:
                    continue
                for op in BINARY_COMBINATORS:
                    raw.append(
                        CandidateRuleAST(
                            candidate_id=f"m16_d2_{op.lower()}_{i}_{j}",
                            origin="m16_base",
                            combinator=op,
                            left_kind="m16_base",
                            left_name=ln,
                            left_params=dict(lp),
                            right_kind="m16_base",
                            right_name=rn,
                            right_params=dict(rp),
                            depth=2,
                            complexity=lc + rc + 2,
                        )
                    )
    unique: List[CandidateRuleAST] = []
    seen: set = set()
    for c in raw:
        sig = truth_table_signature(c)
        if sig in seen:
            continue
        seen.add(sig)
        unique.append(c)
        if len(unique) >= max_candidates:
            break
    return tuple(unique)


@lru_cache(maxsize=32)
def _cached_dsl_subprimitives(max_candidates: int, include_equivalent_twins: bool) -> Tuple[CandidateRuleAST, ...]:
    dsl_specs = SubPrimitiveSynthesizer.enumerate_dsl_subprimitives(
        include_equivalent_twins=include_equivalent_twins
    )
    raw: List[CandidateRuleAST] = []
    for idx, (name, params, comp, origin) in enumerate(dsl_specs):
        param_tag = "_".join(f"{k}{v}" for k, v in sorted(params.items()))
        raw.append(
            CandidateRuleAST(
                candidate_id=f"dsl_{idx:02d}_{name}_{param_tag}",
                origin=origin,
                combinator="ID",
                left_kind="subprimitive",
                left_name=name,
                left_params=dict(params),
                depth=1,
                complexity=comp,
            )
        )
    return tuple(raw[:max_candidates])


# --- Semantic Equivalence Checker (Äquivalenzprüfung) ---

@dataclass(frozen=True)
class EquivalenceClassRecord:
    signature: Tuple[int, ...]
    canonical: CandidateRuleAST
    members: Tuple[CandidateRuleAST, ...]

    @property
    def has_syntactic_variants(self) -> bool:
        return len(self.members) > 1

    def to_dict(self) -> Dict[str, Any]:
        return {
            "canonical_id": self.canonical.candidate_id,
            "canonical_expression": self.canonical.format_dsl(),
            "n_syntactic_members": len(self.members),
            "member_expressions": [m.format_dsl() for m in self.members],
        }


class SemanticEquivalenceChecker:
    """Partitions competing hypotheses into semantic equivalence classes over the full scene domain."""

    def __init__(self, probe_scenes: List[List[Dict[str, int]]] = CANONICAL_PROBE_SCENES) -> None:
        if not probe_scenes:
            raise ValueError("probe_scenes must not be empty")
        self.probe_scenes = probe_scenes

    def partition(
        self,
        hypotheses: List[CandidateRuleAST],
        extra_scenes: Optional[List[List[Dict[str, int]]]] = None,
    ) -> List[EquivalenceClassRecord]:
        if not hypotheses:
            raise ValueError("hypotheses must not be empty")
        all_probes = list(self.probe_scenes) + (list(extra_scenes) if extra_scenes else [])
        buckets: Dict[Tuple[int, ...], List[CandidateRuleAST]] = {}
        for h in hypotheses:
            sig = tuple(h.predict_scene_unchecked(s) for s in all_probes)
            buckets.setdefault(sig, []).append(h)

        classes: List[EquivalenceClassRecord] = []
        for sig, members in buckets.items():
            ordered = sorted(
                members,
                key=lambda c: (
                    c.complexity,
                    0 if c.origin == "synthesized_subprimitive" else 1,
                    c.candidate_id,
                ),
            )
            classes.append(
                EquivalenceClassRecord(
                    signature=sig,
                    canonical=ordered[0],
                    members=tuple(ordered),
                )
            )
        classes.sort(key=lambda ec: (ec.canonical.complexity, ec.canonical.candidate_id))
        return classes


# --- Active Disambiguation Step & Trace Records ---

@dataclass(frozen=True)
class InterventionStepRecord:
    step: int
    scene_id: str
    n_objects: int
    expected_information_gain_bits: float
    observed_label: int
    semantic_classes_before: int
    semantic_classes_after: int
    syntactic_hypotheses_before: int
    syntactic_hypotheses_after: int
    realized_entropy_reduction_bits: float
    distinguished_hypotheses: bool

    def to_dict(self) -> Dict[str, Any]:
        return {
            "step": self.step,
            "scene_id": self.scene_id,
            "n_objects": self.n_objects,
            "expected_information_gain_bits": round(self.expected_information_gain_bits, 6),
            "observed_label": self.observed_label,
            "semantic_classes_before": self.semantic_classes_before,
            "semantic_classes_after": self.semantic_classes_after,
            "syntactic_hypotheses_before": self.syntactic_hypotheses_before,
            "syntactic_hypotheses_after": self.syntactic_hypotheses_after,
            "realized_entropy_reduction_bits": round(self.realized_entropy_reduction_bits, 6),
            "distinguished_hypotheses": self.distinguished_hypotheses,
        }


@dataclass
class DisambiguationResult:
    selection_policy: str
    use_equivalence_check: bool
    initial_syntactic_count: int
    initial_semantic_classes: int
    final_syntactic_count: int
    final_semantic_classes: int
    equivalence_detected: bool
    equivalent_expressions: List[str]
    interventions_used: int
    intervention_budget: int
    n_distinguishing_interventions: int
    n_candidate_scenes_evaluated: int
    initial_entropy_bits: float
    final_entropy_bits: float
    cumulative_entropy_reduction_bits: float
    mean_expected_ig_bits: float
    resolved_unique_semantic_class: bool
    stopped_reason: str
    selected_hypothesis: Optional[CandidateRuleAST]
    surviving_Expressions: List[str]
    steps: List[InterventionStepRecord] = field(default_factory=list)
    posterior_by_candidate_id: Dict[str, float] = field(default_factory=dict)
    corroboration_margin: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "selection_policy": self.selection_policy,
            "use_equivalence_check": self.use_equivalence_check,
            "initial_syntactic_count": self.initial_syntactic_count,
            "initial_semantic_classes": self.initial_semantic_classes,
            "final_syntactic_count": self.final_syntactic_count,
            "final_semantic_classes": self.final_semantic_classes,
            "equivalence_detected": self.equivalence_detected,
            "equivalent_expressions": list(self.equivalence_expressions()),
            "interventions_used": self.interventions_used,
            "intervention_budget": self.intervention_budget,
            "n_distinguishing_interventions": self.n_distinguishing_interventions,
            "n_candidate_scenes_evaluated": self.n_candidate_scenes_evaluated,
            "initial_entropy_bits": round(self.initial_entropy_bits, 6),
            "final_entropy_bits": round(self.final_entropy_bits, 6),
            "cumulative_entropy_reduction_bits": round(self.cumulative_entropy_reduction_bits, 6),
            "mean_expected_ig_bits": round(self.mean_expected_ig_bits, 6),
            "resolved_unique_semantic_class": self.resolved_unique_semantic_class,
            "stopped_reason": self.stopped_reason,
            "selected_expression": (
                self.selected_hypothesis.format_dsl() if self.selected_hypothesis is not None else None
            ),
            "surviving_expressions": list(self.surviving_Expressions),
            "corroboration_margin": self.corroboration_margin,
            "steps": [s.to_dict() for s in self.steps],
        }

    def equivalence_expressions(self) -> List[str]:
        return self.equivalent_expressions


class ActiveDisambiguator:
    """Selects informative experimental interventions and updates the hypothesis version space.

    Strictly operates on:
      - `competing_hypotheses`: candidate rules consistent with initial training observations,
      - `candidate_scenes`: admissible unlabeled intervention scenes from `InterventionSceneGenerator`,
      - `oracle`: explicit `ExperimentalInterventionOracle` (never accesses validation or test labels).
    """

    POLICIES = (
        "information_gain",
        "random_intervention",
        "fixed_heuristic",
        "no_active_selection",
    )

    def __init__(
        self,
        selection_policy: str = "information_gain",
        use_equivalence_check: bool = True,
        noise_tolerant: bool = False,
        assumed_noise_prob: float = 0.20,
        max_noisy_mismatches: int = 1,
        min_corroboration_margin: int = 2,
        seed: int = 0,
    ) -> None:
        if selection_policy not in self.POLICIES:
            raise ValueError(f"unknown selection_policy: {selection_policy}")
        if not 0.0 <= assumed_noise_prob < 0.5:
            raise ValueError("assumed_noise_prob must be in [0.0, 0.5)")
        self.selection_policy = selection_policy
        self.use_equivalence_check = use_equivalence_check
        self.noise_tolerant = noise_tolerant
        self.assumed_noise_prob = assumed_noise_prob
        self.max_noisy_mismatches = max_noisy_mismatches
        self.min_corroboration_margin = min_corroboration_margin
        self.seed = seed
        self.equivalence_checker = SemanticEquivalenceChecker()

    @staticmethod
    def shannon_entropy(weights: List[float]) -> float:
        total = sum(weights)
        if total <= 0.0:
            return 0.0
        ent = 0.0
        for w in weights:
            if w > 0.0:
                p = w / total
                ent -= p * math.log2(p)
        return max(0.0, ent)

    @classmethod
    def expected_information_gain(
        cls,
        representatives: List[CandidateRuleAST],
        weights: List[float],
        scene_objects: List[Dict[str, int]],
        noise_prob: float = 0.0,
    ) -> float:
        """Compute expected Shannon entropy reduction IG(x; H) = H(H) - E_{Y|x}[H(H | x, Y)] in bits."""
        if len(representatives) <= 1:
            return 0.0
        total_w = sum(weights)
        if total_w <= 0.0:
            return 0.0
        norm_w = [w / total_w for w in weights]
        prior_h = cls.shannon_entropy(norm_w)
        if prior_h <= 1e-12:
            return 0.0

        preds = [rep.predict_scene_unchecked(scene_objects) for rep in representatives]
        if len(set(preds)) <= 1:
            # All active hypotheses predict the exact same outcome -> zero information value!
            return 0.0

        eps = noise_prob if 0.0 < noise_prob < 0.5 else 0.0
        post_weights_y1: List[float] = []
        post_weights_y0: List[float] = []
        for w, pred in zip(norm_w, preds):
            p_y1_given_h = (1.0 - eps) if pred == 1 else eps
            p_y0_given_h = eps if pred == 1 else (1.0 - eps)
            post_weights_y1.append(w * p_y1_given_h)
            post_weights_y0.append(w * p_y0_given_h)

        p_y1 = sum(post_weights_y1)
        p_y0 = sum(post_weights_y0)
        exp_post_h = 0.0
        if p_y1 > 1e-12:
            exp_post_h += p_y1 * cls.shannon_entropy(post_weights_y1)
        if p_y0 > 1e-12:
            exp_post_h += p_y0 * cls.shannon_entropy(post_weights_y0)

        return max(0.0, prior_h - exp_post_h)

    @staticmethod
    def _surface_heuristic_score(scene_objects: List[Dict[str, int]]) -> Tuple[int, int, int, int]:
        """Fixed surface heuristic: prefers scenes with more objects and more distinct colors/sizes."""
        n_obj = len(scene_objects)
        n_cols = len({o["color"] for o in scene_objects})
        n_sizes = len({o["size"] for o in scene_objects})
        n_charges = len({o["charge"] for o in scene_objects})
        return (n_obj, n_cols, n_sizes, n_charges)

    def select_intervention(
        self,
        representatives: List[CandidateRuleAST],
        weights: List[float],
        available_scenes: List[Dict[str, Any]],
        rng: random.Random,
    ) -> Tuple[Optional[int], float]:
        """Select the next intervention scene index from `available_scenes` and return `(index, ig_bits)`.

        Tie-breaking for `information_gain` is 100% deterministic and independent of test labels:
          1. Higher expected information gain `round(ig, 9)` (or top-2 rival separation in noisy mode),
          2. Smaller scene size `-len(objects)`,
          3. Higher pair attribute diversity `len({(color, size)})`,
          4. Lexicographically smallest `scene_canonical_key(objects)`.
        """
        if not available_scenes or len(representatives) <= 1:
            return None, 0.0

        noise_for_ig = self.assumed_noise_prob if self.noise_tolerant else 0.0

        if self.selection_policy == "information_gain":
            best_idx: Optional[int] = None
            best_ig: float = 0.0
            best_sort_key: Optional[Tuple[Any, ...]] = None

            for idx, scene_item in enumerate(available_scenes):
                objs = scene_item["objects"]
                ig = self.expected_information_gain(
                    representatives, weights, objs, noise_prob=noise_for_ig
                )
                diversity = len({(o["color"], o["size"]) for o in objs})
                canon_key = scene_canonical_key(objs)
                primary = (
                    1 if ig > 1e-9 else 0,
                    round(ig, 9),
                    -len(objs),
                    diversity,
                )
                if best_sort_key is None:
                    best_sort_key = (primary, canon_key)
                    best_idx = idx
                    best_ig = ig
                else:
                    prev_primary, prev_canon = best_sort_key
                    if primary > prev_primary or (primary == prev_primary and canon_key < prev_canon):
                        best_sort_key = (primary, canon_key)
                        best_idx = idx
                        best_ig = ig

            if best_ig <= 1e-9:
                # No admissible intervention in the candidate pool can separate the remaining hypotheses.
                return None, 0.0
            return best_idx, best_ig

        if self.selection_policy == "random_intervention":
            chosen_idx = rng.randrange(len(available_scenes))
            ig = self.expected_information_gain(
                representatives,
                weights,
                available_scenes[chosen_idx]["objects"],
                noise_prob=noise_for_ig,
            )
            return chosen_idx, ig

        if self.selection_policy == "fixed_heuristic":
            # Rank purely by surface complexity/diversity without computing hypothesis predictions or IG.
            scored = []
            for idx, scene_item in enumerate(available_scenes):
                objs = scene_item["objects"]
                scored.append((self._surface_heuristic_score(objs), -idx, idx))
            scored.sort(reverse=True)
            chosen_idx = scored[0][2]
            ig = self.expected_information_gain(
                representatives,
                weights,
                available_scenes[chosen_idx]["objects"],
                noise_prob=noise_for_ig,
            )
            return chosen_idx, ig

        # self.selection_policy == "no_active_selection":
        # Pick in fixed arrival order without computing information value for selection.
        chosen_idx = 0
        ig = self.expected_information_gain(
            representatives,
            weights,
            available_scenes[chosen_idx]["objects"],
            noise_prob=noise_for_ig,
        )
        return chosen_idx, ig

    def disambiguate(
        self,
        competing_hypotheses: List[CandidateRuleAST],
        candidate_scenes: List[Dict[str, Any]],
        oracle: ExperimentalInterventionOracle,
    ) -> DisambiguationResult:
        """Execute the Active Disambiguation loop over `competing_hypotheses`."""
        if not competing_hypotheses:
            raise ValueError("competing_hypotheses must not be empty")
        for s_item in candidate_scenes:
            if "label" in s_item:
                raise ValueError("candidate intervention scenes must not contain 'label'")
            validate_admissible_intervention_scene(s_item["objects"])

        extra_probe_objs = [s["objects"] for s in candidate_scenes]

        # Step 1: Equivalence Check (Äquivalenzprüfung)
        true_semantic_classes = self.equivalence_checker.partition(
            competing_hypotheses, extra_scenes=extra_probe_objs
        )
        initial_syntactic_count = len(competing_hypotheses)
        initial_semantic_count = len(true_semantic_classes)

        if self.use_equivalence_check:
            active_units: List[EquivalenceClassRecord] = list(true_semantic_classes)
        else:
            # Without equivalence check, treat every syntactically distinct hypothesis as its own unit.
            active_units = [
                EquivalenceClassRecord(
                    signature=truth_table_signature(h),
                    canonical=h,
                    members=(h,),
                )
                for h in sorted(competing_hypotheses, key=lambda c: (c.complexity, c.candidate_id))
            ]

        n_units_init = len(active_units)
        initial_entropy = math.log2(n_units_init) if n_units_init > 1 else 0.0

        # If all competing syntactic hypotheses belong to a single semantic equivalence class:
        if self.use_equivalence_check and initial_semantic_count == 1:
            only_class = active_units[0]
            eq_detected = len(only_class.members) > 1
            return DisambiguationResult(
                selection_policy=self.selection_policy,
                use_equivalence_check=self.use_equivalence_check,
                initial_syntactic_count=initial_syntactic_count,
                initial_semantic_classes=initial_semantic_count,
                final_syntactic_count=len(only_class.members),
                final_semantic_classes=1,
                equivalence_detected=eq_detected,
                equivalent_expressions=[m.format_dsl() for m in only_class.members],
                interventions_used=0,
                intervention_budget=oracle.budget,
                n_distinguishing_interventions=0,
                n_candidate_scenes_evaluated=0,
                initial_entropy_bits=0.0,
                final_entropy_bits=0.0,
                cumulative_entropy_reduction_bits=0.0,
                mean_expected_ig_bits=0.0,
                resolved_unique_semantic_class=True,
                stopped_reason=(
                    "semantically_equivalent_resolved_without_intervention"
                    if eq_detected
                    else "single_initial_hypothesis"
                ),
                selected_hypothesis=only_class.canonical,
                surviving_Expressions=[m.format_dsl() for m in only_class.members],
                steps=[],
                posterior_by_candidate_id={only_class.canonical.candidate_id: 1.0},
                corroboration_margin=0,
            )

        # Initialize weights and observation match/mismatch counters per unit
        matches: Dict[str, int] = {u.canonical.candidate_id: 0 for u in active_units}
        mismatches: Dict[str, int] = {u.canonical.candidate_id: 0 for u in active_units}
        weights: Dict[str, float] = {u.canonical.candidate_id: 1.0 / len(active_units) for u in active_units}

        available_scenes = [
            s
            for s in candidate_scenes
            if scene_canonical_key(s["objects"]) not in oracle.observed_keys
        ]
        rng = random.Random(self.seed * 613 + 29)
        steps: List[InterventionStepRecord] = []
        total_scene_evals = 0
        stopped_reason = "budget_exhausted"

        for step_idx in range(1, oracle.budget + 1):
            if not available_scenes:
                stopped_reason = "candidate_scene_pool_exhausted"
                break

            # Determine currently surviving units
            if not self.noise_tolerant:
                surviving_units = [u for u in active_units if mismatches[u.canonical.candidate_id] == 0]
            else:
                max_m = max(matches[u.canonical.candidate_id] for u in active_units)
                surviving_units = [
                    u
                    for u in active_units
                    if (max_m - matches[u.canonical.candidate_id]) < self.min_corroboration_margin
                ]

            if not self.noise_tolerant and len(surviving_units) <= 1:
                stopped_reason = "unique_hypothesis_resolved"
                break

            if self.noise_tolerant and len(surviving_units) == 1:
                lead_u = surviving_units[0]
                if mismatches[lead_u.canonical.candidate_id] <= self.max_noisy_mismatches:
                    stopped_reason = "corroborated_margin_reached"
                    break
                # Leader itself has too many mismatches (> max_noisy_mismatches): include runner-up to reflect ambiguity
                min_mm = min(mismatches[u.canonical.candidate_id] for u in active_units)
                surviving_units = [
                    u
                    for u in active_units
                    if mismatches[u.canonical.candidate_id] <= min_mm + 1
                ]

            pool_units = active_units if self.noise_tolerant else surviving_units
            reps = [u.canonical for u in pool_units]
            rep_weights = [weights[u.canonical.candidate_id] for u in pool_units]
            if self.selection_policy != "no_active_selection":
                total_scene_evals += len(available_scenes)
            else:
                total_scene_evals += 1

            chosen_idx, expected_ig = self.select_intervention(reps, rep_weights, available_scenes, rng)
            if chosen_idx is None:
                stopped_reason = "no_distinguishing_intervention_in_search_space"
                break

            chosen_scene = available_scenes.pop(chosen_idx)
            scene_objs = chosen_scene["objects"]

            # Record pre-observation state
            sem_before = len({u.signature for u in surviving_units}) if self.use_equivalence_check else len(surviving_units)
            syn_before = sum(len(u.members) for u in surviving_units)
            ent_before = self.shannon_entropy([weights[u.canonical.candidate_id] for u in surviving_units])

            # Step 2: Query explicit environment oracle
            observed_y = oracle.observe(scene_objs)

            # Step 3: Update hypothesis space (Beobachtung -> Hypothesenaktualisierung)
            eps = self.assumed_noise_prob if self.noise_tolerant else 0.0
            matching_any = any(
                u.canonical.predict_scene_unchecked(scene_objs) == observed_y for u in surviving_units
            )

            for u in active_units:
                cid = u.canonical.candidate_id
                pred_y = u.canonical.predict_scene_unchecked(scene_objs)
                if pred_y == observed_y:
                    matches[cid] += 1
                    if self.noise_tolerant:
                        weights[cid] *= 1.0 - eps
                else:
                    if not self.noise_tolerant and not matching_any:
                        # Contradictory observation when no surviving hypothesis matches: do not wipe out all hypotheses
                        pass
                    else:
                        mismatches[cid] += 1
                    if self.noise_tolerant:
                        weights[cid] *= eps
                    elif matching_any:
                        weights[cid] = 0.0

            # Normalize weights
            w_sum = sum(weights.values())
            if w_sum > 0.0:
                for cid in weights:
                    weights[cid] /= w_sum

            if not self.noise_tolerant:
                surviving_after = [u for u in active_units if mismatches[u.canonical.candidate_id] == 0]
            else:
                max_m_after = max(matches[u.canonical.candidate_id] for u in active_units)
                surviving_after = [
                    u
                    for u in active_units
                    if (max_m_after - matches[u.canonical.candidate_id]) < self.min_corroboration_margin
                ]

            sem_after = len({u.signature for u in surviving_after}) if self.use_equivalence_check else len(surviving_after)
            syn_after = sum(len(u.members) for u in surviving_after)
            ent_after = self.shannon_entropy([weights[u.canonical.candidate_id] for u in surviving_after])
            realized_red = max(0.0, ent_before - ent_after)
            distinguished = (sem_after < sem_before) or (realized_red > 1e-6)

            steps.append(
                InterventionStepRecord(
                    step=step_idx,
                    scene_id=chosen_scene["scene_id"],
                    n_objects=len(scene_objs),
                    expected_information_gain_bits=expected_ig,
                    observed_label=observed_y,
                    semantic_classes_before=sem_before,
                    semantic_classes_after=sem_after,
                    syntactic_hypotheses_before=syn_before,
                    syntactic_hypotheses_after=syn_after,
                    realized_entropy_reduction_bits=realized_red,
                    distinguished_hypotheses=distinguished,
                )
            )

            if not self.noise_tolerant and len(surviving_after) <= 1:
                stopped_reason = "unique_hypothesis_resolved"
                break
            if (
                self.noise_tolerant
                and len(surviving_after) == 1
                and mismatches[surviving_after[0].canonical.candidate_id] <= self.max_noisy_mismatches
            ):
                stopped_reason = "corroborated_margin_reached"
                break

        # Finalize surviving units and check resolution criteria
        if not self.noise_tolerant:
            final_units = [u for u in active_units if mismatches[u.canonical.candidate_id] == 0]
            corroboration_margin = (
                matches[final_units[0].canonical.candidate_id] if len(final_units) == 1 else 0
            )
            resolved_unique = len(final_units) == 1
            selected_hyp = final_units[0].canonical if final_units else active_units[0].canonical
        else:
            match_scores = sorted(
                [
                    (
                        matches[u.canonical.candidate_id],
                        -mismatches[u.canonical.candidate_id],
                        weights[u.canonical.candidate_id],
                        u,
                    )
                    for u in active_units
                ],
                key=lambda item: (item[0], item[1], round(item[2], 9), -item[3].canonical.complexity),
                reverse=True,
            )
            lead_matches, _, _, lead_u = match_scores[0]
            runner_up_matches = match_scores[1][0] if len(match_scores) > 1 else 0
            corroboration_margin = lead_matches - runner_up_matches
            if (
                corroboration_margin >= self.min_corroboration_margin
                and mismatches[lead_u.canonical.candidate_id] <= self.max_noisy_mismatches
            ):
                final_units = [lead_u]
                resolved_unique = True
                selected_hyp = lead_u.canonical
                if stopped_reason == "budget_exhausted":
                    stopped_reason = "corroborated_margin_reached"
            else:
                max_m_final = max(matches[u.canonical.candidate_id] for u in active_units)
                final_units = [
                    u
                    for u in active_units
                    if (max_m_final - matches[u.canonical.candidate_id]) < max(2, self.min_corroboration_margin)
                ]
                if len(final_units) < 2 and len(active_units) >= 2:
                    final_units = [item[3] for item in match_scores[:2]]
                resolved_unique = False
                selected_hyp = lead_u.canonical

        final_semantic_classes = (
            len({u.signature for u in final_units}) if self.use_equivalence_check else len(final_units)
        )
        final_syntactic_count = sum(len(u.members) for u in final_units)
        final_entropy = (
            0.0
            if resolved_unique
            else self.shannon_entropy([weights[u.canonical.candidate_id] for u in final_units])
        )
        cum_reduction = max(0.0, initial_entropy - final_entropy)
        mean_ig = (
            sum(s.expected_information_gain_bits for s in steps) / len(steps) if steps else 0.0
        )
        n_distinguishing = sum(1 for s in steps if s.distinguished_hypotheses)

        eq_detected = (
            self.use_equivalence_check
            and resolved_unique
            and len(final_units) == 1
            and len(final_units[0].members) > 1
        )
        eq_exprs = [m.format_dsl() for m in final_units[0].members] if eq_detected else []
        surviving_exprs = [m.format_dsl() for u in final_units for m in u.members]

        return DisambiguationResult(
            selection_policy=self.selection_policy,
            use_equivalence_check=self.use_equivalence_check,
            initial_syntactic_count=initial_syntactic_count,
            initial_semantic_classes=initial_semantic_count,
            final_syntactic_count=final_syntactic_count,
            final_semantic_classes=1 if resolved_unique else max(2, final_semantic_classes),
            equivalence_detected=eq_detected,
            equivalent_expressions=eq_exprs,
            interventions_used=len(steps),
            intervention_budget=oracle.budget,
            n_distinguishing_interventions=n_distinguishing,
            n_candidate_scenes_evaluated=total_scene_evals,
            initial_entropy_bits=initial_entropy,
            final_entropy_bits=final_entropy,
            cumulative_entropy_reduction_bits=cum_reduction,
            mean_expected_ig_bits=mean_ig,
            resolved_unique_semantic_class=resolved_unique,
            stopped_reason=stopped_reason,
            selected_hypothesis=selected_hyp,
            surviving_Expressions=surviving_exprs,
            steps=steps,
            posterior_by_candidate_id={k: round(v, 6) for k, v in weights.items()},
            corroboration_margin=corroboration_margin,
        )


# --- M17 / M18 6-Stage Lifecycle Records and Versioned Skill Memory ---

@dataclass
class SubPrimitiveLifecycleRecord:
    """Tracks a candidate rule through Candidate -> Disambiguation -> Validation -> Adversarial -> Quarantine / Promotion / Rollback."""

    candidate: CandidateRuleAST
    stage: str = "candidate"  # "candidate", "disambiguated", "validated", "quarantined", "promoted", "rolled_back"
    active: bool = False
    train_accuracy: float = 0.0
    val_accuracy: float = 0.0
    independent_size_val_accuracy: float = 0.0
    gain_over_base_grammar: float = 0.0
    permutation_invariant: Optional[bool] = None
    large_size_non_degenerate: Optional[bool] = None
    n_surviving_alternatives: int = 0
    regression_drop: float = 0.0
    disambiguation_summary: Optional[Dict[str, Any]] = None
    quarantine_or_rejection_reasons: List[str] = field(default_factory=list)
    promoted_version: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "candidate": self.candidate.to_dict(),
            "stage": self.stage,
            "active": self.active,
            "train_accuracy": round(self.train_accuracy, 4),
            "val_accuracy": round(self.val_accuracy, 4),
            "independent_size_val_accuracy": round(self.independent_size_val_accuracy, 4),
            "gain_over_base_grammar": round(self.gain_over_base_grammar, 4),
            "permutation_invariant": self.permutation_invariant,
            "large_size_non_degenerate": self.large_size_non_degenerate,
            "n_surviving_alternatives": self.n_surviving_alternatives,
            "regression_drop": round(self.regression_drop, 4),
            "disambiguation_summary": self.disambiguation_summary,
            "quarantine_or_rejection_reasons": list(self.quarantine_or_rejection_reasons),
            "promoted_version": self.promoted_version,
        }


@dataclass
class ActiveSkillEntry:
    skill_id: str
    version: int
    ast: CandidateRuleAST
    unit_tests: List[Dict[str, Any]]
    status: str = "active"

    def verify_unit_tests(self) -> bool:
        if not self.unit_tests:
            return False
        for ex in self.unit_tests:
            if self.ast.predict_scene_unchecked(ex["objects"]) != int(ex["label"]):
                return False
        return True


class GuardedSkillLibrary:
    """Manages Staging, Quarantine, Active Skill Memory, Compositional Synthesis, and Rollback."""

    def __init__(self, read_only_guard: bool = False) -> None:
        self.version: int = 1
        self.read_only_guard: bool = read_only_guard
        self.active_skills: List[ActiveSkillEntry] = []
        self.staging_candidates: List[SubPrimitiveLifecycleRecord] = []
        self.quarantined_records: List[SubPrimitiveLifecycleRecord] = []
        self.promoted_records: List[SubPrimitiveLifecycleRecord] = []
        self.rolled_back_records: List[SubPrimitiveLifecycleRecord] = []
        self._snapshots: List[Tuple[int, List[ActiveSkillEntry]]] = []
        self.locked_m16_baseline_scores: Dict[str, float] = {}
        self.locked_m17_baseline_scores: Dict[str, float] = {}
        self.successful_rollbacks_count: int = 0
        self.failed_rollbacks_count: int = 0

    def _ensure_writable(self) -> None:
        if self.read_only_guard:
            raise PermissionError(
                "productive GuardedSkillLibrary is read-only during isolated no_m17_guard ablation"
            )

    def _save_snapshot(self) -> None:
        copied = [
            ActiveSkillEntry(
                skill_id=s.skill_id,
                version=s.version,
                ast=s.ast,
                unit_tests=list(s.unit_tests),
                status=s.status,
            )
            for s in self.active_skills
        ]
        self._snapshots.append((self.version, copied))

    def register_base_skill(
        self, skill_id: str, ast: CandidateRuleAST, unit_tests: List[Dict[str, Any]]
    ) -> ActiveSkillEntry:
        self._ensure_writable()
        entry = ActiveSkillEntry(
            skill_id=skill_id,
            version=self.version,
            ast=ast,
            unit_tests=list(unit_tests[:6]),
            status="active",
        )
        if not entry.verify_unit_tests():
            raise ValueError(f"base skill '{skill_id}' failed unit tests")
        self.active_skills.append(entry)
        return entry

    def stage_candidate(self, cand: CandidateRuleAST, train_acc: float) -> SubPrimitiveLifecycleRecord:
        rec = SubPrimitiveLifecycleRecord(
            candidate=cand,
            stage="candidate",
            active=False,
            train_accuracy=train_acc,
        )
        self.staging_candidates.append(rec)
        return rec

    def quarantine_candidate(self, rec: SubPrimitiveLifecycleRecord, reasons: List[str]) -> None:
        rec.stage = "quarantined"
        rec.active = False
        rec.quarantine_or_rejection_reasons.extend(reasons)
        self.quarantined_records.append(rec)

    def promote_candidate(
        self,
        rec: SubPrimitiveLifecycleRecord,
        unit_tests: List[Dict[str, Any]],
    ) -> ActiveSkillEntry:
        self._ensure_writable()
        if rec.quarantine_or_rejection_reasons:
            raise ValueError("cannot promote a candidate that has rejection or quarantine reasons")
        if rec.stage not in ("validated", "disambiguated"):
            raise ValueError(
                f"cannot promote candidate from stage '{rec.stage}'; must pass disambiguation and validation first"
            )
        self._save_snapshot()
        self.version += 1
        rec.stage = "promoted"
        rec.active = True
        rec.promoted_version = self.version
        skill_id = f"promoted_v{self.version}_{rec.candidate.candidate_id}"
        entry = ActiveSkillEntry(
            skill_id=skill_id,
            version=self.version,
            ast=rec.candidate,
            unit_tests=list(unit_tests[:6]),
            status="active",
        )
        if not entry.verify_unit_tests():
            _, prev_skills = self._snapshots.pop()
            self.active_skills = prev_skills
            self.version -= 1
            raise ValueError("promoted candidate failed unit test verification")
        self.active_skills.append(entry)
        self.promoted_records.append(rec)
        return entry

    def rollback(self) -> int:
        self._ensure_writable()
        if not self._snapshots:
            self.failed_rollbacks_count += 1
            raise ValueError("no snapshot available for rollback")
        prev_version, prev_skills = self._snapshots.pop()
        if self.promoted_records:
            last_prom = self.promoted_records.pop()
            last_prom.stage = "rolled_back"
            last_prom.active = False
            self.rolled_back_records.append(last_prom)
        self.active_skills = prev_skills
        self.version = prev_version
        self.successful_rollbacks_count += 1
        return self.version

    def synthesize_memory_compositions(self) -> List[CandidateRuleAST]:
        active = [s for s in self.active_skills if s.status == "active" and s.verify_unit_tests()]
        direct = [s.ast for s in active]
        composed: List[CandidateRuleAST] = []
        sub_skills = [s for s in active if s.ast.left_kind == "subprimitive" and s.ast.depth == 1]
        base_skills = [s for s in active if s.ast.left_kind == "m16_base" and s.ast.depth == 1]

        for s_sub in sub_skills:
            for s_base in base_skills:
                for op in BINARY_COMBINATORS:
                    composed.append(
                        CandidateRuleAST(
                            candidate_id=f"mem_comp_{op}({s_sub.skill_id},{s_base.skill_id})",
                            origin="memory_composition",
                            combinator=op,
                            left_kind=s_sub.ast.left_kind,
                            left_name=s_sub.ast.left_name,
                            left_params=dict(s_sub.ast.left_params),
                            right_kind=s_base.ast.left_kind,
                            right_name=s_base.ast.left_name,
                            right_params=dict(s_base.ast.left_params),
                            depth=2,
                            complexity=s_sub.ast.complexity + s_base.ast.complexity + 1,
                        )
                    )
        return direct + composed


class M18ActiveDisambiguationAgent:
    """Integrated M18 Agent combining Active Disambiguation with the M17 6-Stage Safety Lifecycle."""

    def __init__(
        self,
        selection_policy: str = "information_gain",
        use_equivalence_check: bool = True,
        use_m17_guard: bool = True,
        productive_library: Optional[GuardedSkillLibrary] = None,
        max_base_candidates: int = 160,
        max_dsl_candidates: int = 72,
        max_intervention_scenes: int = 48,
        seed: int = 0,
    ) -> None:
        self.selection_policy = selection_policy
        self.use_equivalence_check = use_equivalence_check
        self.use_m17_guard = use_m17_guard
        self.max_base_candidates = max_base_candidates
        self.max_dsl_candidates = max_dsl_candidates
        self.max_intervention_scenes = max_intervention_scenes
        self.seed = seed

        self.synthesizer = SubPrimitiveSynthesizer(
            max_base_candidates=max_base_candidates,
            max_dsl_candidates=max_dsl_candidates,
        )
        self.scene_generator = InterventionSceneGenerator(max_scenes=max_intervention_scenes)

        # If use_m17_guard is False (No M17 Guard ablation), never touch productive_library!
        # Instead, keep a reference to productive_library only to verify zero mutation, and use
        # an isolated ephemeral sandbox library for the ablation run.
        self.productive_library_ref = productive_library
        if productive_library is not None and self.use_m17_guard:
            self.library = productive_library
        else:
            self.library = GuardedSkillLibrary()

        self.isolated_sandbox_promotions: List[SubPrimitiveLifecycleRecord] = []

    @staticmethod
    def _accuracy(cand: CandidateRuleAST, examples: List[Dict[str, Any]]) -> float:
        if not examples:
            return 0.0
        return sum(
            1 for e in examples if cand.predict_scene_unchecked(e["objects"]) == int(e["label"])
        ) / len(examples)

    def lock_regression_suites(
        self,
        m16_tasks: List[Dict[str, Any]],
        m17_tasks: Optional[List[Dict[str, Any]]] = None,
    ) -> Tuple[Dict[str, float], Dict[str, float]]:
        base_cands = self.synthesizer.generate_m16_base_grammar(include_depth2=True)
        m16_scores: Dict[str, float] = {}
        for r_task in m16_tasks:
            best = max(base_cands, key=lambda c: (self._accuracy(c, r_task["train_examples"]), -c.complexity))
            m16_scores[r_task["task_id"]] = self._accuracy(best, r_task["test_examples"])
        self.library.locked_m16_baseline_scores = dict(m16_scores)

        m17_scores: Dict[str, float] = {}
        if m17_tasks:
            dsl_cands = self.synthesizer.synthesize_subprimitive_candidates(include_equivalent_twins=False)
            for m_task in m17_tasks:
                best = max(dsl_cands, key=lambda c: (self._accuracy(c, m_task["train_examples"]), -c.complexity))
                m17_scores[m_task["task_id"]] = self._accuracy(best, m_task["test_examples"])
        self.library.locked_m17_baseline_scores = dict(m17_scores)
        return m16_scores, m17_scores

    def compute_regression_drops(
        self,
        m16_tasks: List[Dict[str, Any]],
        m17_tasks: Optional[List[Dict[str, Any]]] = None,
        extra_cand: Optional[CandidateRuleAST] = None,
    ) -> Tuple[float, float]:
        if m16_tasks and not self.library.locked_m16_baseline_scores:
            self.lock_regression_suites(m16_tasks, m17_tasks)
        elif m17_tasks and not self.library.locked_m17_baseline_scores:
            self.lock_regression_suites(m16_tasks, m17_tasks)

        base_cands = self.synthesizer.generate_m16_base_grammar(include_depth2=True)
        mem_cands = self.library.synthesize_memory_compositions()
        pool_m16 = list(base_cands) + mem_cands + ([extra_cand] if extra_cand is not None else [])

        m16_drops: List[float] = []
        for r_task in m16_tasks:
            tid = r_task["task_id"]
            baseline_acc = self.library.locked_m16_baseline_scores.get(tid, 1.0)
            best = max(pool_m16, key=lambda c: (self._accuracy(c, r_task["train_examples"]), -c.complexity))
            curr_acc = self._accuracy(best, r_task["test_examples"])
            m16_drops.append(max(0.0, baseline_acc - curr_acc))

        m17_drops: List[float] = []
        if m17_tasks:
            dsl_cands = self.synthesizer.synthesize_subprimitive_candidates(include_equivalent_twins=False)
            pool_m17 = list(dsl_cands) + mem_cands + ([extra_cand] if extra_cand is not None else [])
            for m_task in m17_tasks:
                tid = m_task["task_id"]
                baseline_acc = self.library.locked_m17_baseline_scores.get(tid, 1.0)
                best = max(pool_m17, key=lambda c: (self._accuracy(c, m_task["train_examples"]), -c.complexity))
                curr_acc = self._accuracy(best, m_task["test_examples"])
                m17_drops.append(max(0.0, baseline_acc - curr_acc))

        return (max(m16_drops) if m16_drops else 0.0), (max(m17_drops) if m17_drops else 0.0)

    def acquire_warmup_base_skills(self, warmup_tasks: List[Dict[str, Any]]) -> int:
        base_d1 = self.synthesizer.generate_m16_base_grammar(include_depth2=False)
        count = 0
        for w_task in warmup_tasks:
            best = max(
                base_d1,
                key=lambda c: (
                    0.5 * self._accuracy(c, w_task["train_examples"])
                    + 0.5 * self._accuracy(c, w_task["val_examples"]),
                    -c.complexity,
                ),
            )
            self.library.register_base_skill(w_task["skill_id"], best, w_task["train_examples"][:6])
            count += 1
        return count

    def solve_task(
        self,
        task: Dict[str, Any],
        oracle: Optional[ExperimentalInterventionOracle] = None,
        m16_regression_tasks: Optional[List[Dict[str, Any]]] = None,
        m17_regression_tasks: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Execute M18 Active Disambiguation followed by the M17 6-Stage Validation & Promotion Gate."""
        train_ex = task["train_examples"]
        val_ex = task["val_examples"]
        ind_size_val_ex = task["independent_size_val_examples"]
        if not train_ex or not val_ex or not ind_size_val_ex:
            raise ValueError("train, val, and independent_size_val splits must not be empty")

        gate = PRE_REGISTERED_M18_GATE

        # Evaluate M16 base grammar baseline for gain comparison and fallback.
        base_cands = self.synthesizer.generate_m16_base_grammar(include_depth2=True)
        best_base = max(
            base_cands,
            key=lambda c: (
                round(self._accuracy(c, train_ex), 6),
                round(0.5 * self._accuracy(c, val_ex) + 0.5 * self._accuracy(c, ind_size_val_ex), 6),
                -c.complexity,
                c.candidate_id,
            ),
        )
        base_val_acc = 0.5 * self._accuracy(best_base, val_ex) + 0.5 * self._accuracy(best_base, ind_size_val_ex)

        # Stage 1 (Candidate & Version Space Construction on initial passive train_examples):
        dsl_pool = self.synthesizer.synthesize_subprimitive_candidates(include_equivalent_twins=True)
        if not dsl_pool:
            raise ValueError("DSL candidate pool must not be empty")

        train_scored: List[Tuple[float, int, CandidateRuleAST]] = []
        for cand in dsl_pool:
            tr_acc = self._accuracy(cand, train_ex)
            train_scored.append((tr_acc, -cand.complexity, cand))
        train_scored.sort(key=lambda x: (x[0], x[1], x[2].candidate_id), reverse=True)

        top_train_acc = train_scored[0][0]
        # Filter initial competing hypotheses: must meet min_train_accuracy and pass structural invariance
        raw_passing = [item[2] for item in train_scored if item[0] >= gate["min_train_accuracy"]]
        if self.use_m17_guard:
            competing_hypotheses = [
                c for c in raw_passing if check_permutation_invariance(c) and check_large_size_support(c)
            ]
        else:
            competing_hypotheses = list(raw_passing)

        if not competing_hypotheses:
            competing_hypotheses = [train_scored[0][2]]

        rec = self.library.stage_candidate(competing_hypotheses[0], train_acc=top_train_acc)

        # Build explicit oracle if not externally provided
        initial_keys = {scene_canonical_key(e["objects"]) for e in train_ex}
        if oracle is None:
            oracle = ExperimentalInterventionOracle(
                eval_fn=task["ground_truth_rule"].evaluate,
                budget=int(task.get("intervention_budget", 3)),
                initial_observed_keys=initial_keys,
                noise_schedule=task.get("noise_schedule"),
                noise_prob=float(task.get("noise_prob", 0.0)),
                seed=self.seed,
            )

        # Generate admissible candidate intervention scenes strictly from the DSL (no test/val access!)
        admissible_scenes = task.get("custom_candidate_scenes")
        if admissible_scenes is None:
            admissible_scenes = self.scene_generator.generate_admissible_scenes(
                observed_keys=initial_keys,
                seed=self.seed,
                include_adversarial_decoys=bool(task.get("include_adversarial_decoys", False)),
                coupled_colors=task.get("coupled_colors"),
            )

        is_noisy_task = float(task.get("noise_prob", 0.0)) > 0.0 or bool(task.get("noise_schedule"))
        disambiguator = ActiveDisambiguator(
            selection_policy=self.selection_policy,
            use_equivalence_check=self.use_equivalence_check,
            noise_tolerant=(is_noisy_task and self.use_m17_guard),
            assumed_noise_prob=gate["assumed_observation_noise"],
            max_noisy_mismatches=gate["max_noisy_mismatches"],
            min_corroboration_margin=gate["min_noisy_corroboration_margin"],
            seed=self.seed,
        )

        disambig_res = disambiguator.disambiguate(
            competing_hypotheses=competing_hypotheses,
            candidate_scenes=admissible_scenes,
            oracle=oracle,
        )
        rec.disambiguation_summary = disambig_res.to_dict()
        chosen_cand = disambig_res.selected_hypothesis or competing_hypotheses[0]
        rec.candidate = chosen_cand
        rec.stage = "disambiguated"

        # Compute validation and adversarial metrics for logging and gating
        rec.train_accuracy = self._accuracy(chosen_cand, train_ex)
        rec.val_accuracy = self._accuracy(chosen_cand, val_ex)
        rec.independent_size_val_accuracy = self._accuracy(chosen_cand, ind_size_val_ex)
        rec.gain_over_base_grammar = (
            0.5 * (rec.val_accuracy + rec.independent_size_val_accuracy) - base_val_acc
        )
        perm_ok = check_permutation_invariance(chosen_cand)
        size_ok = check_large_size_support(chosen_cand)
        rec.permutation_invariant = perm_ok
        rec.large_size_non_degenerate = size_ok
        rec.n_surviving_alternatives = disambig_res.final_semantic_classes

        m16_drop, m17_drop = self.compute_regression_drops(
            m16_regression_tasks or [],
            m17_regression_tasks or [],
            extra_cand=chosen_cand,
        )
        rec.regression_drop = max(m16_drop, m17_drop)

        # --- Isolated No-M17-Guard Ablation Path ---
        if not self.use_m17_guard:
            rec.stage = "promoted_isolated_sandbox"
            rec.active = False  # Never active in productive memory
            self.isolated_sandbox_promotions.append(rec)
            return {
                "selected_candidate": chosen_cand,
                "fallback_candidate": best_base,
                "disambiguation": disambig_res,
                "lifecycle_record": rec,
                "abstained": False,
                "promoted": True,
                "quarantined": False,
                "equivalence_detected": disambig_res.equivalence_detected,
                "uniquely_identified_single_syntax": (
                    disambig_res.resolved_unique_semantic_class and not disambig_res.equivalence_detected
                ),
                "m16_regression_drop": m16_drop,
                "m17_regression_drop": m17_drop,
                "n_hypothesis_candidates_evaluated": len(base_cands) + len(dsl_pool),
                "n_candidate_scenes_evaluated": disambig_res.n_candidate_scenes_evaluated,
                "status": "promoted_unvalidated_no_m17_guard",
            }

        # --- Guarded M17 + M18 Admission Pipeline ---
        reasons: List[str] = []
        if rec.train_accuracy < gate["min_train_accuracy"]:
            reasons.append(f"train_accuracy {rec.train_accuracy:.3f} < {gate['min_train_accuracy']:.3f}")

        # Gate 1: Active Disambiguation must resolve to a single semantic equivalence class
        if not disambig_res.resolved_unique_semantic_class or disambig_res.final_semantic_classes > 1:
            reasons.append(
                f"unresolved_competing_hypotheses ({disambig_res.final_semantic_classes} semantic classes remain; "
                f"stopped_reason={disambig_res.stopped_reason})"
            )

        # Gate 2: M17 Independent Validation Check
        if rec.val_accuracy < gate["min_val_accuracy"]:
            reasons.append(f"val_accuracy {rec.val_accuracy:.3f} < {gate['min_val_accuracy']:.3f}")
        if rec.independent_size_val_accuracy < gate["min_independent_size_val_accuracy"]:
            reasons.append(
                f"independent_size_val_accuracy {rec.independent_size_val_accuracy:.3f} < "
                f"{gate['min_independent_size_val_accuracy']:.3f}"
            )
        if rec.gain_over_base_grammar < gate["min_gain_over_base_grammar"]:
            reasons.append(
                f"gain_over_base_grammar {rec.gain_over_base_grammar:.3f} < "
                f"{gate['min_gain_over_base_grammar']:.3f}"
            )

        # Gate 3: M17 Adversarial & Structural Invariance Checks + Regression Check
        if not perm_ok:
            reasons.append("failed_permutation_invariance_audit")
        if not size_ok:
            reasons.append("failed_large_size_non_degeneracy_audit")
        if rec.regression_drop > gate["max_regression_drop"]:
            reasons.append(f"regression_drop_on_locked_tasks {rec.regression_drop:.3f} > 0.0")

        # Stage 4: Quarantine & Abstention if any gate failed
        if reasons:
            self.library.quarantine_candidate(rec, reasons)
            status_tag = (
                "abstained_unidentifiable_no_informative_intervention"
                if disambig_res.stopped_reason == "no_distinguishing_intervention_in_search_space"
                else "quarantined_abstained"
            )
            return {
                "selected_candidate": best_base,
                "fallback_candidate": best_base,
                "disambiguation": disambig_res,
                "lifecycle_record": rec,
                "abstained": True,
                "promoted": False,
                "quarantined": True,
                "equivalence_detected": disambig_res.equivalence_detected,
                "uniquely_identified_single_syntax": False,
                "m16_regression_drop": m16_drop,
                "m17_regression_drop": m17_drop,
                "n_hypothesis_candidates_evaluated": len(base_cands) + len(dsl_pool),
                "n_candidate_scenes_evaluated": disambig_res.n_candidate_scenes_evaluated,
                "status": status_tag,
            }

        # Stage 5: Validation passed -> Promote into active SkillMemory
        rec.stage = "validated"
        self.library.promote_candidate(rec, unit_tests=train_ex[:6])
        status_tag = (
            "equivalent_canonical_promoted"
            if disambig_res.equivalence_detected
            else "disambiguated_and_promoted"
        )
        return {
            "selected_candidate": chosen_cand,
            "fallback_candidate": best_base,
            "disambiguation": disambig_res,
            "lifecycle_record": rec,
            "abstained": False,
            "promoted": True,
            "quarantined": False,
            "equivalence_detected": disambig_res.equivalence_detected,
            "uniquely_identified_single_syntax": not disambig_res.equivalence_detected,
            "m16_regression_drop": m16_drop,
            "m17_regression_drop": m17_drop,
            "n_hypothesis_candidates_evaluated": len(base_cands) + len(dsl_pool),
            "n_candidate_scenes_evaluated": disambig_res.n_candidate_scenes_evaluated,
            "status": status_tag,
        }
