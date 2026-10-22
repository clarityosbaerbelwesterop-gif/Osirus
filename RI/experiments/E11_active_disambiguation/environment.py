"""M18 (E11) — Active Disambiguation & Experimental Intervention Environment.

Defines the typed relational scene DSL, explicit ExperimentalInterventionOracle,
bounded candidate scene synthesizer, and five task families for M18 (E11):
  - Family A (A_identifiable_competing_rules): Multiple semantically distinct hypotheses
    match 100% of the initial passive training examples. Admissible experimental
    interventions exist in the DSL that decouple the confounded attributes and allow
    exact identification of the ground-truth rule.
  - Family B (B_noisy_observations): Experimental intervention observations are subject
    to controlled noise:
      * B1_recoverable_noise (even seeds): An early noisy observation flip contradicts
        the true hypothesis, testing whether the learner avoids premature elimination
        or single-observation adoption and instead gathers corroborating interventions.
      * B2_unresolvable_contradictory_noise (odd seeds): Severe/contradictory observation
        noise prevents reliable corroboration (and corrupts validation), requiring the
        learner to abstain and quarantine rather than promote an uncertain rule.
  - Family C (C_semantically_equivalent): Two syntactically distinct hypotheses in the
    grammar are semantically identical across the entire defined scene domain. The
    learner must detect equivalence without wasting intervention budget or claiming a
    spurious separation between equivalent forms.
  - Family D (D_unidentifiable_ambiguity): Competing hypotheses agree on all initial
    examples and on every scene within the admissible intervention search space
    (N in [2..6], pos in [0..7]), while differing only outside the intervention domain
    (N in [9..11] or pos in [9..11]). The learner must recognize that no admissible
    intervention has positive information value, stop without exhausting its budget,
    abstain, and refuse promotion.
  - Family E (E_adversarial_heuristic_trap): Competing hypotheses tie on passive examples,
    and the candidate intervention pool contains complex high-diversity decoy scenes
    where all competing hypotheses make identical predictions (IG = 0.0) alongside
    compact 3-object scenes that split the version space in half (IG = 1.0 bit).
"""
from dataclasses import dataclass, field
import random
from typing import Any, Callable, Dict, List, Optional, Tuple

COLORS = (0, 1, 2)
SIZES = (1, 2, 3, 4, 5, 6)
CHARGES = (0, 1)
POSITIONS = tuple(range(12))

ADMISSIBLE_INTERVENTION_SIZE_RANGE = (2, 6)
ADMISSIBLE_INTERVENTION_POSITIONS = tuple(range(8))

TASK_FAMILIES = (
    "A_identifiable_competing_rules",
    "B_noisy_observations",
    "C_semantically_equivalent",
    "D_unidentifiable_ambiguity",
    "E_adversarial_heuristic_trap",
)


def validate_scene_objects(
    objects: List[Dict[str, int]],
    min_objects: int = 2,
    max_objects: int = 15,
) -> None:
    """Validate that a scene conforms to the typed relational object DSL."""
    if not isinstance(objects, list) or len(objects) < min_objects or len(objects) > max_objects:
        raise ValueError(
            f"scene 'objects' must be a list of [{min_objects}, {max_objects}] object dicts"
        )
    for obj in objects:
        if not isinstance(obj, dict):
            raise ValueError("each object in scene must be a dict")
        for key in ("color", "size", "charge", "pos"):
            if key not in obj or isinstance(obj[key], bool) or not isinstance(obj[key], int):
                raise ValueError(f"object attribute '{key}' must be an integer")
        if obj["color"] not in COLORS:
            raise ValueError(f"object color {obj['color']} outside {COLORS}")
        if obj["size"] not in SIZES:
            raise ValueError(f"object size {obj['size']} outside {SIZES}")
        if obj["charge"] not in CHARGES:
            raise ValueError(f"object charge {obj['charge']} outside {CHARGES}")
        if obj["pos"] not in POSITIONS:
            raise ValueError(f"object pos {obj['pos']} outside {POSITIONS}")


def validate_admissible_intervention_scene(
    objects: List[Dict[str, int]],
    size_range: Tuple[int, int] = ADMISSIBLE_INTERVENTION_SIZE_RANGE,
    allowed_positions: Tuple[int, ...] = ADMISSIBLE_INTERVENTION_POSITIONS,
) -> None:
    """Validate that a candidate experimental intervention respects intervention bounds."""
    validate_scene_objects(objects, min_objects=size_range[0], max_objects=size_range[1])
    for obj in objects:
        if obj["pos"] not in allowed_positions:
            raise ValueError(
                f"intervention object pos {obj['pos']} outside allowed intervention positions {allowed_positions}"
            )


def strip_labels(examples: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Deep-copy scene inputs and strip all labels and metadata to prevent test leakage."""
    stripped: List[Dict[str, Any]] = []
    for ex in examples:
        validate_scene_objects(ex["objects"])
        stripped.append(
            {
                "objects": [
                    {
                        "color": int(o["color"]),
                        "size": int(o["size"]),
                        "charge": int(o["charge"]),
                        "pos": int(o["pos"]),
                    }
                    for o in ex["objects"]
                ]
            }
        )
    return stripped


def scene_canonical_key(objects: List[Dict[str, int]]) -> Tuple[Tuple[int, int, int, int], ...]:
    """Order-invariant canonical representation of a scene for deduplication and disjointness."""
    return tuple(
        sorted((int(o["color"]), int(o["size"]), int(o["charge"]), int(o["pos"])) for o in objects)
    )


# --- M16 Base Primitives ---

def eval_m16_base_primitive(prim_type: str, params: Dict[str, Any], objects: List[Dict[str, int]]) -> int:
    if prim_type == "exists_color_size_ge":
        c = int(params["color"])
        s = int(params["min_size"])
        return int(any(o["color"] == c and o["size"] >= s for o in objects))

    if prim_type == "all_size_ge":
        s = int(params["min_size"])
        return int(all(o["size"] >= s for o in objects))

    if prim_type == "charge_ratio_ge":
        num = int(params["num"])
        den = int(params["den"])
        charged = sum(1 for o in objects if o["charge"] == 1)
        return int(charged * den >= len(objects) * num)

    if prim_type == "parity_sum_charge":
        p = int(params["parity"])
        return int((sum(o["charge"] for o in objects) % 2) == p)

    if prim_type == "argmax_size_has_charge":
        target_charge = int(params["charge"])
        top_obj = max(objects, key=lambda o: (o["size"], o["pos"], o["color"], o["charge"]))
        return int(top_obj["charge"] == target_charge)

    if prim_type == "argmax_size_has_color":
        target_color = int(params["color"])
        top_obj = max(objects, key=lambda o: (o["size"], o["pos"], o["charge"], o["color"]))
        return int(top_obj["color"] == target_color)

    raise ValueError(f"unknown M16 base primitive: {prim_type}")


# --- M17 / M18 Relational Sub-Primitive DSL Semantics ---

def eval_subprimitive_dsl(dsl_type: str, params: Dict[str, Any], objects: List[Dict[str, int]]) -> int:
    """Evaluate a relational sub-primitive from the typed M17/M18 DSL."""
    if dsl_type == "pair_color_size_delta":
        c1 = int(params["c1"])
        c2 = int(params["c2"])
        delta = int(params["delta"])
        for i, o1 in enumerate(objects):
            if o1["color"] != c1:
                continue
            for j, o2 in enumerate(objects):
                if i != j and o2["color"] == c2 and (o2["size"] - o1["size"]) == delta:
                    return 1
        return 0

    if dsl_type == "converse_pair_size_deficit":
        # Syntactically distinct converse formulation of pair_color_size_delta(c1, c2, delta):
        # exists ordered pair (o_hi, o_lo) with colors (c2, c1) such that o_hi.size - o_lo.size == delta.
        c2 = int(params["c2"])
        c1 = int(params["c1"])
        delta = int(params["delta"])
        for i, o_hi in enumerate(objects):
            if o_hi["color"] != c2:
                continue
            for j, o_lo in enumerate(objects):
                if i != j and o_lo["color"] == c1 and (o_hi["size"] - o_lo["size"]) == delta:
                    return 1
        return 0

    if dsl_type == "pair_proximal_dipole":
        color = int(params["color"])
        max_gap = int(params["max_gap"])
        n = len(objects)
        for i in range(n):
            if objects[i]["color"] != color:
                continue
            for j in range(i + 1, n):
                if (
                    objects[j]["color"] == color
                    and objects[i]["charge"] != objects[j]["charge"]
                    and abs(objects[i]["pos"] - objects[j]["pos"]) <= max_gap
                ):
                    return 1
        return 0

    if dsl_type == "symmetric_charge_split_within_gap":
        # Syntactically distinct, semantically equivalent formulation of pair_proximal_dipole:
        # exists an uncharged object u (charge=0) and a charged object v (charge=1) of color c with |u.pos - v.pos| <= max_gap.
        color = int(params["color"])
        max_gap = int(params["max_gap"])
        neg_objs = [o for o in objects if o["color"] == color and o["charge"] == 0]
        pos_objs = [o for o in objects if o["color"] == color and o["charge"] == 1]
        for u in neg_objs:
            for v in pos_objs:
                if abs(u["pos"] - v["pos"]) <= max_gap:
                    return 1
        return 0

    if dsl_type == "triad_monotone_size_distinct_color":
        target_charge = int(params["charge"])
        c0_sizes = [o["size"] for o in objects if o["color"] == 0 and o["charge"] == target_charge]
        c1_sizes = [o["size"] for o in objects if o["color"] == 1]
        c2_sizes = [o["size"] for o in objects if o["color"] == 2]
        for s0 in c0_sizes:
            for s1 in c1_sizes:
                if s0 < s1:
                    for s2 in c2_sizes:
                        if s1 < s2:
                            return 1
        return 0

    if dsl_type == "forall_color_charged":
        c = int(params["color"])
        target_charge = int(params["charge"])
        matching = [o for o in objects if o["color"] == c]
        if not matching:
            return 0
        return int(all(o["charge"] == target_charge for o in matching))

    if dsl_type == "no_color_opposite_charge":
        # Syntactically distinct, semantically equivalent twin of forall_color_charged(color, charge):
        # color c is present and no object of color c has charge (1 - target_charge).
        c = int(params["color"])
        target_charge = int(params["charge"])
        opp_charge = 1 - target_charge
        has_c = False
        for o in objects:
            if o["color"] == c:
                has_c = True
                if o["charge"] == opp_charge:
                    return 0
        return int(has_c)

    if dsl_type == "pair_same_color_charged":
        # At least two objects have color == c and charge == 1
        c = int(params["color"])
        count = sum(1 for o in objects if o["color"] == c and o["charge"] == 1)
        return int(count >= 2)

    if dsl_type == "pair_same_size_charged":
        # At least two objects have size == s and charge == 1
        s = int(params["size"])
        count = sum(1 for o in objects if o["size"] == s and o["charge"] == 1)
        return int(count >= 2)

    if dsl_type == "forall_color_charged_or_ultralarge":
        # Agrees with forall_color_charged on all scenes with N <= 6 (admissible intervention domain),
        # but differs on large scenes N >= min_large_n (where it flips/activates).
        c = int(params["color"])
        target_charge = int(params["charge"])
        min_large_n = int(params.get("min_large_n", 9))
        if len(objects) >= min_large_n:
            return int(any(o["color"] == c for o in objects))
        matching = [o for o in objects if o["color"] == c]
        if not matching:
            return 0
        return int(all(o["charge"] == target_charge for o in matching))

    if dsl_type == "forall_color_charged_unless_far_pos":
        # Agrees with forall_color_charged on all scenes with pos in [0..7] (admissible intervention domain),
        # but differs when an object sits at far position >= min_far_pos (pos in [9..11]).
        c = int(params["color"])
        target_charge = int(params["charge"])
        min_far_pos = int(params.get("min_far_pos", 9))
        if any(o["pos"] >= min_far_pos and o["charge"] == 1 for o in objects):
            return 0
        matching = [o for o in objects if o["color"] == c]
        if not matching:
            return 0
        return int(all(o["charge"] == target_charge for o in matching))

    if dsl_type == "spurious_slot0_charge":
        target_charge = int(params["charge"])
        return int(objects[0]["charge"] == target_charge)

    if dsl_type == "spurious_exact_count_and_color":
        max_count = int(params["max_count"])
        c = int(params["color"])
        return int(len(objects) <= max_count and any(o["color"] == c and o["charge"] == 1 for o in objects))

    raise ValueError(f"unknown sub-primitive DSL type: {dsl_type}")


def eval_combinator(operator: str, left_val: int, right_val: Optional[int] = None) -> int:
    if operator == "ID":
        return int(left_val == 1)
    if operator == "NOT":
        return int(left_val == 0)
    if right_val is None:
        raise ValueError(f"binary combinator '{operator}' requires right_val")
    if operator == "AND":
        return int(left_val == 1 and right_val == 1)
    if operator == "OR":
        return int(left_val == 1 or right_val == 1)
    if operator == "XOR":
        return int(left_val != right_val)
    if operator == "AND_NOT":
        return int(left_val == 1 and right_val == 0)
    raise ValueError(f"unknown combinator: {operator}")


@dataclass(frozen=True)
class SubPrimitiveSpec:
    dsl_type: str
    params: Dict[str, Any]

    def evaluate(self, objects: List[Dict[str, int]]) -> int:
        return eval_subprimitive_dsl(self.dsl_type, self.params, objects)

    def canonical_id(self) -> str:
        param_str = "_".join(f"{k}{v}" for k, v in sorted(self.params.items()))
        return f"subprim_{self.dsl_type}_{param_str}"

    def to_dict(self) -> Dict[str, Any]:
        return {"dsl_type": self.dsl_type, "params": dict(self.params)}


@dataclass(frozen=True)
class M18TaskRule:
    rule_id: str
    family: str
    subprimitive: SubPrimitiveSpec
    combinator: str = "ID"
    base_partner: Optional[Tuple[str, Dict[str, Any]]] = None
    identifiable: bool = True
    should_promote: bool = True
    equivalent_twin: Optional[SubPrimitiveSpec] = None
    unidentifiable_competitor: Optional[SubPrimitiveSpec] = None
    noise_mode: str = "noiseless"
    description: str = ""

    def evaluate(self, objects: List[Dict[str, int]]) -> int:
        sub_val = self.subprimitive.evaluate(objects)
        if self.combinator in ("ID", "NOT"):
            return eval_combinator(self.combinator, sub_val)
        if self.base_partner is None:
            raise ValueError("binary combinator requires base_partner")
        base_val = eval_m16_base_primitive(self.base_partner[0], self.base_partner[1], objects)
        return eval_combinator(self.combinator, sub_val, base_val)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "rule_id": self.rule_id,
            "family": self.family,
            "subprimitive": self.subprimitive.to_dict(),
            "combinator": self.combinator,
            "base_partner": (
                [self.base_partner[0], dict(self.base_partner[1])]
                if self.base_partner is not None
                else None
            ),
            "identifiable": self.identifiable,
            "should_promote": self.should_promote,
            "equivalent_twin": self.equivalent_twin.to_dict() if self.equivalent_twin else None,
            "unidentifiable_competitor": (
                self.unidentifiable_competitor.to_dict() if self.unidentifiable_competitor else None
            ),
            "noise_mode": self.noise_mode,
            "description": self.description,
        }


class ExperimentalInterventionOracle:
    """Controlled environment interface for observing outcomes of admissible experimental scenes.

    Strictly separates intervention selection by the learner from environment evaluation:
      - Enforces DSL scene validity and admissible intervention bounds (N in [2..6], pos in [0..7]).
      - Rejects scenes that duplicate already-observed training or prior intervention scenes.
      - Enforces a hard intervention budget.
      - Never exposes test examples, validation examples, or the underlying ground-truth rule AST.
    """

    def __init__(
        self,
        eval_fn: Callable[[List[Dict[str, int]]], int],
        budget: int,
        initial_observed_keys: set,
        noise_schedule: Optional[Tuple[bool, ...]] = None,
        noise_prob: float = 0.0,
        seed: int = 0,
        size_range: Tuple[int, int] = ADMISSIBLE_INTERVENTION_SIZE_RANGE,
        allowed_positions: Tuple[int, ...] = ADMISSIBLE_INTERVENTION_POSITIONS,
    ) -> None:
        if isinstance(budget, bool) or not isinstance(budget, int) or budget < 0:
            raise ValueError("budget must be a non-negative integer")
        if not 0.0 <= noise_prob <= 0.5:
            raise ValueError("noise_prob must be in [0.0, 0.5]")
        self._eval_fn = eval_fn
        self.budget = budget
        self.queries_used = 0
        self.observed_keys: set = set(initial_observed_keys)
        self._noise_schedule = noise_schedule
        self.noise_prob = noise_prob
        self._rng = random.Random(seed * 997 + 31)
        self.size_range = size_range
        self.allowed_positions = allowed_positions
        self.history: List[Dict[str, Any]] = []

    @property
    def remaining_budget(self) -> int:
        return max(0, self.budget - self.queries_used)

    def observe(self, scene_objects: List[Dict[str, int]]) -> int:
        """Evaluate an admissible, novel intervention scene and return the observed binary outcome."""
        if self.queries_used >= self.budget:
            raise RuntimeError(f"intervention budget exhausted ({self.budget}/{self.budget} used)")

        validate_admissible_intervention_scene(
            scene_objects,
            size_range=self.size_range,
            allowed_positions=self.allowed_positions,
        )
        key = scene_canonical_key(scene_objects)
        if key in self.observed_keys:
            raise ValueError("intervention scene must be distinct from already observed scenes")

        step_idx = self.queries_used
        self.queries_used += 1
        self.observed_keys.add(key)

        clean_label = int(self._eval_fn(scene_objects))
        if self._noise_schedule is not None and step_idx < len(self._noise_schedule):
            flipped = bool(self._noise_schedule[step_idx])
        elif self.noise_prob > 0.0:
            flipped = self._rng.random() < self.noise_prob
        else:
            flipped = False

        observed_label = (1 - clean_label) if flipped else clean_label
        self.history.append(
            {
                "step": step_idx + 1,
                "n_objects": len(scene_objects),
                "observed_label": observed_label,
                "noise_flipped": flipped,
            }
        )
        return observed_label


class InterventionSceneGenerator:
    """Synthesizes a bounded, deterministic pool of admissible experimental intervention scenes.

    Operates strictly over the scene DSL (N in [2..6], pos in [0..7]) without accessing any
    validation or test splits. Generates targeted attribute-decoupling templates (e.g.,
    same-color/different-size, different-color/same-size, single-color charge decouplings,
    proximal vs distal dipoles, monotone vs non-monotone triads) plus diverse scenes.
    """

    def __init__(
        self,
        max_scenes: int = 48,
        size_range: Tuple[int, int] = ADMISSIBLE_INTERVENTION_SIZE_RANGE,
        allowed_positions: Tuple[int, ...] = ADMISSIBLE_INTERVENTION_POSITIONS,
    ) -> None:
        if max_scenes < 1:
            raise ValueError("max_scenes must be >= 1")
        self.max_scenes = max_scenes
        self.size_range = size_range
        self.allowed_positions = allowed_positions

    def generate_admissible_scenes(
        self,
        observed_keys: set,
        seed: int = 0,
        include_adversarial_decoys: bool = False,
        coupled_colors: Optional[Tuple[int, int]] = None,
    ) -> List[Dict[str, Any]]:
        """Return a bounded list of novel, valid intervention scenes {'scene_id': ..., 'objects': [...]}."""
        candidates: List[Dict[str, Any]] = []
        seen_keys: set = set(observed_keys)

        def add_scene(tag: str, objs: List[Dict[str, int]]) -> None:
            if len(candidates) >= self.max_scenes:
                return
            validate_admissible_intervention_scene(
                objs,
                size_range=self.size_range,
                allowed_positions=self.allowed_positions,
            )
            if coupled_colors is not None:
                c_a, c_b = coupled_colors
                # Enforce experimental apparatus coupling: color c_a and color c_b always share identical charge state,
                # and appear in singletons of size != 3 so all 4 confounded hypotheses or twin pair stay coupled.
                ca_charges = {o["charge"] for o in objs if o["color"] == c_a}
                cb_charges = {o["charge"] for o in objs if o["color"] == c_b}
                if ca_charges != cb_charges or len(ca_charges) > 1:
                    return
            key = scene_canonical_key(objs)
            if key in seen_keys:
                return
            seen_keys.add(key)
            candidates.append(
                {
                    "scene_id": f"intervene_{len(candidates):02d}_{tag}",
                    "objects": [dict(o) for o in objs],
                }
            )

        if coupled_colors is not None:
            c_a, c_b = coupled_colors
            for idx in range(self.max_scenes):
                ch = idx % 2
                p0 = idx % 8
                p1 = (idx + 2) % 8
                p2 = (idx + 5) % 8
                s_val = 2 if (idx % 3 == 0) else (4 if (idx % 3 == 1) else 5)
                add_scene(
                    f"coupled_c{c_a}_c{c_b}_{idx}",
                    [
                        {"color": c_a, "size": s_val, "charge": ch, "pos": p0},
                        {"color": c_b, "size": s_val, "charge": ch, "pos": p1},
                        {"color": 3 - c_a - c_b, "size": 1, "charge": 0, "pos": p2},
                    ],
                )
            return candidates

        # Prepend high-surface-diversity decoy scenes where all 4 confounded hypotheses predict 0
        # (so surface heuristics and unguided index-order selection are tested).
        n_decoys = 6 if include_adversarial_decoys else 4
        for d_idx in range(n_decoys):
            # 6-object scenes with all 3 colors, 6 distinct sizes (1..6), positions in 0..7,
            # engineered so every color has both charge=1 and charge=0 (forall_color_charged=0),
            # no two charged objects share a color or size (pair_same_color/size_charged=0),
            # no c1->c2 pair has delta in {2,3}, and no dipole within gap<=2.
            decoy_objs = [
                {"color": 0, "size": 1, "charge": 1, "pos": d_idx % 8},
                {"color": 0, "size": 6, "charge": 0, "pos": (d_idx + 5) % 8},
                {"color": 1, "size": 2, "charge": 1, "pos": (d_idx + 1) % 8},
                {"color": 1, "size": 5, "charge": 0, "pos": (d_idx + 2) % 8},
                {"color": 2, "size": 4, "charge": 1, "pos": (d_idx + 3) % 8},
                {"color": 2, "size": 3, "charge": 0, "pos": (d_idx + 4) % 8},
            ]
            add_scene(f"decoy_rich_{d_idx}", decoy_objs)

        # 1. Balanced 2-vs-2 splitters (split {H1, H3} vs {H2, H4} with 1.0 bit of information gain)
        for pos_offset in (0, 1, 2, 3):
            p0 = pos_offset
            p1 = (pos_offset + 2) % 8
            p2 = (pos_offset + 5) % 8
            # H1=1, H3=1, H2=0, H4=0
            add_scene(
                f"split2v2_col1pair_v{pos_offset}",
                [
                    {"color": 1, "size": 2, "charge": 1, "pos": p0},
                    {"color": 1, "size": 5, "charge": 1, "pos": p1},
                    {"color": 2, "size": 4, "charge": 0, "pos": p2},
                ],
            )
            # H1=1, H2=1, H3=0, H4=0
            add_scene(
                f"split2v2_col1_and_col2_v{pos_offset}",
                [
                    {"color": 1, "size": 2, "charge": 1, "pos": p0},
                    {"color": 2, "size": 5, "charge": 1, "pos": p1},
                    {"color": 0, "size": 4, "charge": 0, "pos": p2},
                ],
            )
            # H1=1, H4=1, H2=0, H3=0
            add_scene(
                f"split2v2_col1_and_size3_v{pos_offset}",
                [
                    {"color": 1, "size": 3, "charge": 1, "pos": p0},
                    {"color": 0, "size": 3, "charge": 1, "pos": p1},
                    {"color": 2, "size": 4, "charge": 0, "pos": p2},
                ],
            )

        # 2. Single-hypothesis isolators (1-vs-3 on all 4, and 1-vs-1 on any surviving pair!)
        for pos_offset in (0, 1, 2, 3):
            p0 = pos_offset
            p1 = (pos_offset + 3) % 8
            p2 = (pos_offset + 6) % 8
            # Only H1 = 1 (forall_color_charged(1,1) = 1, others = 0)
            add_scene(
                f"isolate_H1_forall_c1_v{pos_offset}",
                [
                    {"color": 1, "size": 2, "charge": 1, "pos": p0},
                    {"color": 2, "size": 4, "charge": 0, "pos": p1},
                    {"color": 0, "size": 5, "charge": 0, "pos": p2},
                ],
            )
            # Only H2 = 1 (forall_color_charged(2,1) = 1, others = 0)
            add_scene(
                f"isolate_H2_forall_c2_v{pos_offset}",
                [
                    {"color": 2, "size": 2, "charge": 1, "pos": p0},
                    {"color": 1, "size": 4, "charge": 0, "pos": p1},
                    {"color": 0, "size": 5, "charge": 0, "pos": p2},
                ],
            )
            # Only H3 = 1 (pair_same_color_charged(1) = 1, forall_color_charged(1,1) = 0, others = 0)
            add_scene(
                f"isolate_H3_pair_c1_v{pos_offset}",
                [
                    {"color": 1, "size": 2, "charge": 1, "pos": p0},
                    {"color": 1, "size": 5, "charge": 1, "pos": p1},
                    {"color": 1, "size": 4, "charge": 0, "pos": p2},
                ],
            )
            # Only H4 = 1 (pair_same_size_charged(3) = 1, others = 0)
            add_scene(
                f"isolate_H4_pair_s3_v{pos_offset}",
                [
                    {"color": 0, "size": 3, "charge": 1, "pos": p0},
                    {"color": 0, "size": 3, "charge": 1, "pos": p1},
                    {"color": 1, "size": 4, "charge": 0, "pos": p2},
                ],
            )

        # 3. Pairwise color-size delta interventions: isolate (c1, c2, delta) without dipoles or universal charge
        for c1 in (0, 1):
            for delta in (2, 3):
                objs_delta = [
                    {"color": c1, "size": 2, "charge": 0, "pos": 0},
                    {"color": 2, "size": 2 + delta, "charge": 0, "pos": 5},
                    {"color": 1, "size": 1, "charge": 0, "pos": 7},
                ]
                add_scene(f"delta_c{c1}_c2_d{delta}", objs_delta)

        # 4. Proximal dipole interventions: same color, opposite charge, gap 1 or 2, no size delta
        for c in COLORS:
            for gap in (1, 2):
                objs_dipole = [
                    {"color": c, "size": 3, "charge": 1, "pos": 1},
                    {"color": c, "size": 3, "charge": 0, "pos": 1 + gap},
                    {"color": (c + 1) % 3, "size": 3, "charge": 0, "pos": 6},
                ]
                add_scene(f"dipole_c{c}_g{gap}", objs_dipole)

        # 5. Monotone triad interventions: colors (0, 1, 2) with sizes (1, 3, 5)
        for ch in (0, 1):
            objs_triad = [
                {"color": 0, "size": 1, "charge": ch, "pos": 0},
                {"color": 1, "size": 3, "charge": 0, "pos": 3},
                {"color": 2, "size": 5, "charge": 0, "pos": 6},
            ]
            add_scene(f"triad_ch{ch}", objs_triad)

        # 6. Fill remaining slots with deterministic diverse scenes (N in [4..6])
        rng = random.Random(seed * 131 + 17)
        attempts = 0
        while len(candidates) < self.max_scenes and attempts < self.max_scenes * 20:
            attempts += 1
            n_obj = rng.randint(max(4, self.size_range[0]), self.size_range[1])
            positions = rng.sample(self.allowed_positions, k=min(n_obj, len(self.allowed_positions)))
            objs = [
                {
                    "color": rng.choice(COLORS),
                    "size": rng.choice(SIZES),
                    "charge": rng.choice(CHARGES),
                    "pos": positions[i],
                }
                for i in range(n_obj)
            ]
            add_scene(f"random_probe_{attempts}", objs)

        return candidates


@dataclass
class M18TaskBundle:
    """Complete task bundle for a single seed across Families A, B, C, D, E plus locked M16 and M17 regressions."""

    seed: int
    locked_m16_regression_tasks: List[Dict[str, Any]]
    locked_m17_regression_tasks: List[Dict[str, Any]]
    base_warmup_tasks: List[Dict[str, Any]]
    tasks_by_family: Dict[str, Dict[str, Any]]


class ActiveDisambiguationWorld:
    """Deterministic generator for M18 (E11) tasks and regression suites."""

    def __init__(self, seed: int) -> None:
        if isinstance(seed, bool) or not isinstance(seed, int):
            raise ValueError("seed must be an integer")
        self.seed = seed

    @staticmethod
    def _sample_scene(
        n_objects: int,
        rng: random.Random,
        allowed_positions: Tuple[int, ...] = POSITIONS,
    ) -> List[Dict[str, int]]:
        if n_objects < 2 or n_objects > 15:
            raise ValueError("n_objects must be in [2, 15]")
        positions = rng.sample(allowed_positions, k=min(n_objects, len(allowed_positions)))
        while len(positions) < n_objects:
            positions.append(rng.choice(allowed_positions))
        objs = [
            {
                "color": rng.choice(COLORS),
                "size": rng.choice(SIZES),
                "charge": rng.choice(CHARGES),
                "pos": positions[i],
            }
            for i in range(n_objects)
        ]
        rng.shuffle(objs)
        return objs

    def _sample_balanced_scenes(
        self,
        eval_fn: Callable[[List[Dict[str, int]]], int],
        count: int,
        size_range: Tuple[int, int],
        used_keys: set,
        rng: random.Random,
        allowed_positions: Tuple[int, ...] = POSITIONS,
    ) -> List[Dict[str, Any]]:
        positives: List[Dict[str, Any]] = []
        negatives: List[Dict[str, Any]] = []
        target_pos = count // 2
        target_neg = count - target_pos
        lo, hi = size_range

        attempts = 0
        max_attempts = count * 180
        while (len(positives) < target_pos or len(negatives) < target_neg) and attempts < max_attempts:
            attempts += 1
            n_obj = rng.randint(lo, hi)
            objs = self._sample_scene(n_obj, rng, allowed_positions=allowed_positions)
            key = scene_canonical_key(objs)
            if key in used_keys:
                continue
            lbl = int(eval_fn(objs))
            if lbl == 1 and len(positives) < target_pos:
                positives.append({"objects": objs, "label": 1, "n_objects": n_obj})
                used_keys.add(key)
            elif lbl == 0 and len(negatives) < target_neg:
                negatives.append({"objects": objs, "label": 0, "n_objects": n_obj})
                used_keys.add(key)

        combined = positives + negatives
        while len(combined) < count:
            n_obj = rng.randint(lo, hi)
            objs = self._sample_scene(n_obj, rng, allowed_positions=allowed_positions)
            key = scene_canonical_key(objs)
            if key in used_keys:
                continue
            used_keys.add(key)
            combined.append({"objects": objs, "label": int(eval_fn(objs)), "n_objects": n_obj})

        rng.shuffle(combined)
        return combined

    def _make_four_way_confounded_train_split(
        self,
        n_scenes: int,
        used_keys: set,
        rng: random.Random,
    ) -> List[Dict[str, Any]]:
        """Construct training scenes where 4 distinct relational hypotheses are 100% confounded:
          1. forall_color_charged(color=1, charge=1)
          2. forall_color_charged(color=2, charge=1)
          3. pair_same_color_charged(color=1)
          4. pair_same_size_charged(size=3)
        While M16 base primitives (charge_ratio_ge, parity_sum_charge, argmax_size_has_charge/color,
        exists_color_size_ge, all_size_ge) are held orthogonal (~50% accuracy) so synthesis/disambiguation
        is required.
        """
        out: List[Dict[str, Any]] = []
        for idx in range(n_scenes):
            lbl = idx % 2
            # Positive scene (lbl=1):
            # - Two color=1 objects (sizes 3 and 4) have charge=1 -> forall_color_charged(1,1)=1 AND pair_same_color_charged(1)=1
            # - One color=2 object (size=3) has charge=1 -> forall_color_charged(2,1)=1 AND pair_same_size_charged(3)=1 (with the color=1 size=3 object!)
            # - Three color=0 objects have charge=0
            # Negative scene (lbl=0):
            # - Two color=1 objects (sizes 3 and 4) have charge=0 -> forall_color_charged(1,1)=0 AND pair_same_color_charged(1)=0
            # - One color=2 object (size=3) has charge=0 -> forall_color_charged(2,1)=0 AND pair_same_size_charged(3)=0
            # - Three color=0 objects have charge=1 (so total charged count is ALWAYS 3 out of 6 -> parity=1, ratio=3/6=1/2!)
            p_perm = rng.sample(ADMISSIBLE_INTERVENTION_POSITIONS, k=6)
            objs = [
                {"color": 1, "size": 3, "charge": lbl, "pos": p_perm[0]},
                {"color": 1, "size": 4, "charge": lbl, "pos": p_perm[1]},
                {"color": 2, "size": 3, "charge": lbl, "pos": p_perm[2]},
                {"color": 0, "size": 2, "charge": 1 - lbl, "pos": p_perm[3]},
                {"color": 0, "size": 4, "charge": 1 - lbl, "pos": p_perm[4]},
                {"color": 0, "size": 6, "charge": (idx // 2) % 2, "pos": p_perm[5]},
            ]
            rng.shuffle(objs)
            key = scene_canonical_key(objs)
            used_keys.add(key)
            out.append({"objects": objs, "label": lbl, "n_objects": len(objs)})
        return out

    def generate_bundle(
        self,
        train_size: int = 16,
        val_size: int = 14,
        independent_size_val: int = 14,
        test_size: int = 36,
        intervention_budget: int = 3,
    ) -> M18TaskBundle:
        if train_size < 6 or val_size < 6 or independent_size_val < 6 or test_size < 12:
            raise ValueError("split sizes too small")

        rng = random.Random(self.seed * 107 + 13)
        used_keys: set = set()

        # 1. Locked M16 Regression Suite (3 core M16 tasks).
        m16_reg_specs = [
            ("exists_color_size_ge", {"color": 0, "min_size": 5}),
            ("parity_sum_charge", {"parity": 0}),
            ("argmax_size_has_charge", {"charge": 1}),
        ]
        locked_m16_tasks: List[Dict[str, Any]] = []
        for r_idx, (p_name, p_params) in enumerate(m16_reg_specs):
            fn = lambda objs, pn=p_name, pp=p_params: eval_m16_base_primitive(pn, pp, objs)
            r_train = self._sample_balanced_scenes(fn, 16, (4, 6), used_keys, rng)
            r_test = self._sample_balanced_scenes(fn, 20, (5, 8), used_keys, rng)
            locked_m16_tasks.append(
                {
                    "task_id": f"m16_reg_{r_idx}_s{self.seed}",
                    "primitive": (p_name, p_params),
                    "train_examples": r_train,
                    "test_examples": r_test,
                }
            )

        # 2. Locked M17 Regression Suite (2 core M17 sub-primitive tasks).
        m17_reg_specs = [
            SubPrimitiveSpec("pair_color_size_delta", {"c1": 0, "c2": 2, "delta": 2}),
            SubPrimitiveSpec("pair_proximal_dipole", {"color": 0, "max_gap": 1}),
        ]
        locked_m17_tasks: List[Dict[str, Any]] = []
        for m_idx, spec in enumerate(m17_reg_specs):
            r_train = self._sample_balanced_scenes(spec.evaluate, 16, (4, 6), used_keys, rng)
            r_test = self._sample_balanced_scenes(spec.evaluate, 20, (5, 9), used_keys, rng)
            locked_m17_tasks.append(
                {
                    "task_id": f"m17_reg_{m_idx}_s{self.seed}",
                    "subprimitive": spec.to_dict(),
                    "train_examples": r_train,
                    "test_examples": r_test,
                }
            )

        # 3. Warm-up base skills.
        base_warmup_tasks: List[Dict[str, Any]] = []
        for b_idx, (bp_name, bp_params) in enumerate(
            [("parity_sum_charge", {"parity": 0}), ("exists_color_size_ge", {"color": 1, "min_size": 5})]
        ):
            fn = lambda objs, pn=bp_name, pp=bp_params: eval_m16_base_primitive(pn, pp, objs)
            w_train = self._sample_balanced_scenes(fn, 16, (4, 6), used_keys, rng)
            w_val = self._sample_balanced_scenes(fn, 12, (4, 6), used_keys, rng)
            base_warmup_tasks.append(
                {
                    "skill_id": f"base_skill_{b_idx}_s{self.seed}",
                    "primitive": (bp_name, bp_params),
                    "train_examples": w_train,
                    "val_examples": w_val,
                }
            )

        competing_four = [
            SubPrimitiveSpec("forall_color_charged", {"color": 1, "charge": 1}),
            SubPrimitiveSpec("forall_color_charged", {"color": 2, "charge": 1}),
            SubPrimitiveSpec("pair_same_color_charged", {"color": 1}),
            SubPrimitiveSpec("pair_same_size_charged", {"size": 3}),
        ]

        tasks_by_family: Dict[str, Dict[str, Any]] = {}

        # --- Family A: Identifiable Competing Rules ---
        true_spec_a = competing_four[self.seed % len(competing_four)]
        rule_a = M18TaskRule(
            rule_id=f"e11_A_s{self.seed}",
            family="A_identifiable_competing_rules",
            subprimitive=true_spec_a,
            identifiable=True,
            should_promote=True,
            description=(
                f"Disambiguate {true_spec_a.canonical_id()} from 4 confounded hypotheses via active intervention"
            ),
        )
        a_train = self._make_four_way_confounded_train_split(train_size, used_keys, rng)
        a_val = self._sample_balanced_scenes(rule_a.evaluate, val_size, (4, 6), used_keys, rng)
        a_ind_val = self._sample_balanced_scenes(rule_a.evaluate, independent_size_val, (7, 10), used_keys, rng)
        a_test_small = self._sample_balanced_scenes(rule_a.evaluate, test_size // 2, (4, 6), used_keys, rng)
        a_test_large = self._sample_balanced_scenes(
            rule_a.evaluate, test_size - (test_size // 2), (8, 11), used_keys, rng
        )
        tasks_by_family["A_identifiable_competing_rules"] = {
            "task_id": rule_a.rule_id,
            "family": "A_identifiable_competing_rules",
            "identifiable": True,
            "should_promote": True,
            "intervention_budget": intervention_budget,
            "noise_schedule": None,
            "noise_prob": 0.0,
            "include_adversarial_decoys": False,
            "train_examples": a_train,
            "val_examples": a_val,
            "independent_size_val_examples": a_ind_val,
            "test_examples": a_test_small + a_test_large,
            "test_large_size_examples": a_test_large,
            "ground_truth_rule": rule_a,
        }

        # --- Family B: Noisy Observations ---
        # Even seeds (B1_recoverable_noise): First intervention is corrupted (flipped), next 4 are clean.
        # Budget is 5 so an uncertainty-aware learner that requires a corroboration margin >= 2 can
        # overcome the single contradictory observation and still identify + validate the true rule.
        # Odd seeds (B2_unresolvable_contradictory_noise): Alternating contradictory flips (True, False, True)
        # with budget=2 and noisy validation split so no hypothesis achieves a safe corroboration margin;
        # the learner must abstain and quarantine rather than promote on a single contradictory observation.
        recoverable_noise = (self.seed % 2) == 0
        true_spec_b = competing_four[(self.seed + 1) % 2]  # forall_color_charged(1,1) or (2,1)
        rule_b = M18TaskRule(
            rule_id=f"e11_B_{'recoverable' if recoverable_noise else 'contradictory'}_s{self.seed}",
            family="B_noisy_observations",
            subprimitive=true_spec_b,
            identifiable=recoverable_noise,
            should_promote=recoverable_noise,
            noise_mode="B1_recoverable_single_flip" if recoverable_noise else "B2_unresolvable_contradictory_noise",
            description=(
                "Recoverable single noisy flip requiring multi-step corroboration"
                if recoverable_noise
                else "Contradictory noisy observations where learner must abstain and block promotion"
            ),
        )
        b_train = self._make_four_way_confounded_train_split(train_size, used_keys, rng)
        b_val_clean = self._sample_balanced_scenes(rule_b.evaluate, val_size, (4, 6), used_keys, rng)
        if recoverable_noise:
            b_val = b_val_clean
            b_noise_schedule = (True, False, False, False, False, False)
            b_budget = 6
        else:
            # Corrupt 45% of validation labels and alternate intervention flips so evidence is contradictory.
            b_val = [
                {
                    "objects": item["objects"],
                    "label": (1 - int(item["label"])) if (idx % 2 == 0) else int(item["label"]),
                    "n_objects": item["n_objects"],
                }
                for idx, item in enumerate(b_val_clean)
            ]
            b_noise_schedule = (True, False, True, True, False)
            b_budget = 2

        b_ind_val = self._sample_balanced_scenes(rule_b.evaluate, independent_size_val, (7, 10), used_keys, rng)
        b_test_small = self._sample_balanced_scenes(rule_b.evaluate, test_size // 2, (4, 6), used_keys, rng)
        b_test_large = self._sample_balanced_scenes(
            rule_b.evaluate, test_size - (test_size // 2), (8, 11), used_keys, rng
        )
        tasks_by_family["B_noisy_observations"] = {
            "task_id": rule_b.rule_id,
            "family": "B_noisy_observations",
            "identifiable": recoverable_noise,
            "should_promote": recoverable_noise,
            "noise_mode": rule_b.noise_mode,
            "intervention_budget": b_budget,
            "noise_schedule": b_noise_schedule,
            "noise_prob": 0.20 if recoverable_noise else 0.50,
            "include_adversarial_decoys": False,
            "train_examples": b_train,
            "val_examples": b_val,
            "independent_size_val_examples": b_ind_val,
            "test_examples": b_test_small + b_test_large,
            "test_large_size_examples": b_test_large,
            "ground_truth_rule": rule_b,
        }

        # --- Family C: Semantically Equivalent Hypotheses ---
        # Construct c_train so that on every seed, 2 semantic classes (3 syntactic hypotheses) match c_train at 100%:
        #   - Class 1 (2 equivalent syntactic forms): canon_spec and twin_spec
        #   - Class 2 (1 confounded competitor): pair_same_size_charged(size=3)
        # An equivalence-aware active learner uses 1 distinguishing intervention to eliminate Class 2,
        # and then immediately recognizes that the remaining 2 syntactic forms (canon_spec & twin_spec) are
        # semantically equivalent across the full domain (stopping after 1 intervention instead of exhausting budget).
        eq_variant = self.seed % 3
        if eq_variant == 0:
            canon_spec = SubPrimitiveSpec("forall_color_charged", {"color": 1, "charge": 1})
            twin_spec = SubPrimitiveSpec("no_color_opposite_charge", {"color": 1, "charge": 1})
        elif eq_variant == 1:
            canon_spec = SubPrimitiveSpec("pair_color_size_delta", {"c1": 0, "c2": 2, "delta": 2})
            twin_spec = SubPrimitiveSpec("converse_pair_size_deficit", {"c2": 2, "c1": 0, "delta": 2})
        else:
            canon_spec = SubPrimitiveSpec("pair_proximal_dipole", {"color": 0, "max_gap": 1})
            twin_spec = SubPrimitiveSpec("symmetric_charge_split_within_gap", {"color": 0, "max_gap": 1})

        rule_c = M18TaskRule(
            rule_id=f"e11_C_equiv_v{eq_variant}_s{self.seed}",
            family="C_semantically_equivalent",
            subprimitive=canon_spec,
            identifiable=True,
            should_promote=True,
            equivalent_twin=twin_spec,
            description=(
                f"Syntactically distinct but semantically equivalent pair: "
                f"{canon_spec.canonical_id()} == {twin_spec.canonical_id()}"
            ),
        )
        c_train: List[Dict[str, Any]] = []
        for idx in range(train_size):
            lbl = idx % 2
            p_perm = rng.sample(ADMISSIBLE_INTERVENTION_POSITIONS, k=6)
            if eq_variant == 0:
                objs = [
                    {"color": 1, "size": 3, "charge": lbl, "pos": p_perm[0]},
                    {"color": 0, "size": 3, "charge": lbl, "pos": p_perm[1]},
                    {"color": 2, "size": 4, "charge": 1 - lbl, "pos": p_perm[2]},
                    {"color": 0, "size": 5, "charge": 1 - lbl, "pos": p_perm[3]},
                    {"color": 0, "size": 6, "charge": (idx // 2) % 2, "pos": p_perm[4]},
                ]
            elif eq_variant == 1:
                objs = [
                    {"color": 0, "size": 3, "charge": lbl, "pos": p_perm[0]},
                    {"color": 1, "size": 3, "charge": lbl, "pos": p_perm[1]},
                    {"color": 2, "size": 5 if lbl == 1 else 2, "charge": 1 - lbl, "pos": p_perm[2]},
                    {"color": 1, "size": 4, "charge": 1 - lbl, "pos": p_perm[3]},
                    {"color": 1, "size": 6, "charge": (idx // 2) % 2, "pos": p_perm[4]},
                ]
            else:
                objs = [
                    {"color": 0, "size": 3, "charge": lbl, "pos": 1},
                    {"color": 0, "size": 4, "charge": 1 - lbl, "pos": 2 if lbl == 1 else 3},
                    {"color": 1, "size": 3, "charge": lbl, "pos": 5},
                    {"color": 2, "size": 5, "charge": 1 - lbl, "pos": 6},
                    {"color": 1, "size": 6, "charge": (idx // 2) % 2, "pos": 7},
                ]
            rng.shuffle(objs)
            used_keys.add(scene_canonical_key(objs))
            c_train.append({"objects": objs, "label": lbl, "n_objects": len(objs)})

        c_val = self._sample_balanced_scenes(rule_c.evaluate, val_size, (4, 6), used_keys, rng)
        c_ind_val = self._sample_balanced_scenes(rule_c.evaluate, independent_size_val, (7, 10), used_keys, rng)
        c_test_small = self._sample_balanced_scenes(rule_c.evaluate, test_size // 2, (4, 6), used_keys, rng)
        c_test_large = self._sample_balanced_scenes(
            rule_c.evaluate, test_size - (test_size // 2), (8, 11), used_keys, rng
        )
        tasks_by_family["C_semantically_equivalent"] = {
            "task_id": rule_c.rule_id,
            "family": "C_semantically_equivalent",
            "identifiable": True,
            "should_promote": True,
            "intervention_budget": intervention_budget,
            "noise_schedule": None,
            "noise_prob": 0.0,
            "include_adversarial_decoys": False,
            "coupled_colors": None,
            "train_examples": c_train,
            "val_examples": c_val,
            "independent_size_val_examples": c_ind_val,
            "test_examples": c_test_small + c_test_large,
            "test_large_size_examples": c_test_large,
            "ground_truth_rule": rule_c,
        }

        # --- Family D: Unidentifiable Hypotheses (No Distinguishing Intervention in Search Space) ---
        # Two semantically distinct hypotheses (forall_color_charged(1, 1) and forall_color_charged(2, 1))
        # match 100% of train, val, and ind_size_val splits, and the admissible intervention space is
        # constrained by coupled_colors=(1, 2) so no admissible intervention in the search space can
        # decouple color 1 from color 2 (max IG(x) == 0.0).
        true_d_col = 1 if (self.seed % 2 == 0) else 2
        alt_d_col = 2 if true_d_col == 1 else 1
        spec_d_true = SubPrimitiveSpec("forall_color_charged", {"color": true_d_col, "charge": 1})
        spec_d_alt = SubPrimitiveSpec("forall_color_charged", {"color": alt_d_col, "charge": 1})

        rule_d = M18TaskRule(
            rule_id=f"e11_D_unidentifiable_s{self.seed}",
            family="D_unidentifiable_ambiguity",
            subprimitive=spec_d_true,
            identifiable=False,
            should_promote=False,
            unidentifiable_competitor=spec_d_alt,
            description=(
                f"Unidentifiable within constrained intervention space: "
                f"{spec_d_true.canonical_id()} vs {spec_d_alt.canonical_id()} coupled on all admissible interventions"
            ),
        )

        def make_coupled_col12_split(n_scenes: int, sz_range: Tuple[int, int]) -> List[Dict[str, Any]]:
            out = []
            for idx in range(n_scenes):
                lbl = idx % 2
                n_obj = max(5, rng.randint(sz_range[0], sz_range[1]))
                p_perm = rng.sample(POSITIONS, k=n_obj)
                objs = [
                    {"color": 1, "size": 3, "charge": lbl, "pos": p_perm[0] % 8},
                    {"color": 2, "size": 2, "charge": lbl, "pos": p_perm[1] % 8},
                    {"color": 0, "size": 6, "charge": 1 - lbl, "pos": p_perm[2] % 8},
                    {"color": 0, "size": 5, "charge": 1 - lbl, "pos": p_perm[3] % 8},
                    {"color": 0, "size": 4, "charge": (idx // 2) % 2, "pos": p_perm[4] % 8},
                ]
                for k in range(5, n_obj):
                    objs.append({"color": 0, "size": 4, "charge": k % 2, "pos": p_perm[k]})
                rng.shuffle(objs)
                used_keys.add(scene_canonical_key(objs))
                out.append({"objects": objs, "label": lbl, "n_objects": len(objs)})
            return out

        d_train = make_coupled_col12_split(train_size, (5, 6))
        d_val = make_coupled_col12_split(val_size, (5, 6))
        d_ind_val = make_coupled_col12_split(independent_size_val, (7, 10))
        d_test_small = self._sample_balanced_scenes(rule_d.evaluate, test_size // 2, (4, 6), used_keys, rng)
        d_test_large = self._sample_balanced_scenes(
            rule_d.evaluate, test_size - (test_size // 2), (8, 11), used_keys, rng
        )
        tasks_by_family["D_unidentifiable_ambiguity"] = {
            "task_id": rule_d.rule_id,
            "family": "D_unidentifiable_ambiguity",
            "identifiable": False,
            "should_promote": False,
            "intervention_budget": intervention_budget,
            "noise_schedule": None,
            "noise_prob": 0.0,
            "include_adversarial_decoys": False,
            "coupled_colors": (1, 2),
            "train_examples": d_train,
            "val_examples": d_val,
            "independent_size_val_examples": d_ind_val,
            "test_examples": d_test_small + d_test_large,
            "test_large_size_examples": d_test_large,
            "ground_truth_rule": rule_d,
        }

        # --- Family E: Adversarial Heuristic Trap ---
        true_spec_e = competing_four[(self.seed + 2) % len(competing_four)]
        rule_e = M18TaskRule(
            rule_id=f"e11_E_adversarial_s{self.seed}",
            family="E_adversarial_heuristic_trap",
            subprimitive=true_spec_e,
            identifiable=True,
            should_promote=True,
            description=(
                f"Adversarial decoy scenes with high surface complexity (IG=0) vs compact informative scenes (IG=1)"
            ),
        )
        e_train = self._make_four_way_confounded_train_split(train_size, used_keys, rng)
        e_val = self._sample_balanced_scenes(rule_e.evaluate, val_size, (4, 6), used_keys, rng)
        e_ind_val = self._sample_balanced_scenes(rule_e.evaluate, independent_size_val, (7, 10), used_keys, rng)
        e_test_small = self._sample_balanced_scenes(rule_e.evaluate, test_size // 2, (4, 6), used_keys, rng)
        e_test_large = self._sample_balanced_scenes(
            rule_e.evaluate, test_size - (test_size // 2), (8, 11), used_keys, rng
        )
        tasks_by_family["E_adversarial_heuristic_trap"] = {
            "task_id": rule_e.rule_id,
            "family": "E_adversarial_heuristic_trap",
            "identifiable": True,
            "should_promote": True,
            "intervention_budget": intervention_budget,
            "noise_schedule": None,
            "noise_prob": 0.0,
            "include_adversarial_decoys": True,
            "train_examples": e_train,
            "val_examples": e_val,
            "independent_size_val_examples": e_ind_val,
            "test_examples": e_test_small + e_test_large,
            "test_large_size_examples": e_test_large,
            "ground_truth_rule": rule_e,
        }

        return M18TaskBundle(
            seed=self.seed,
            locked_m16_regression_tasks=locked_m16_tasks,
            locked_m17_regression_tasks=locked_m17_tasks,
            base_warmup_tasks=base_warmup_tasks,
            tasks_by_family=tasks_by_family,
        )
