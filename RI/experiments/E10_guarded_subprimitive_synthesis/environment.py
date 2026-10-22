"""M17 (E10) — Guarded Sub-Primitive Synthesis Environment and Task Families.

Defines variable-size relational object scenes and three task families:
  - Family A (A_primitive_synthesis): Target rule relies on a relational sub-primitive
    that is missing from the initial M16 base grammar (e.g., ordered color-pair exact
    size step, spatial proximity opposite-charge dipole, or 3-color monotone size triad).
  - Family B (B_composition_with_synthesized): Target rule composes the newly synthesized
    sub-primitive from Family A with an existing M16 base skill (e.g., parity_sum_charge
    or exists_color_size_ge) using binary Boolean combinators (AND, OR, XOR, AND_NOT).
  - Family C (C_spurious_and_noisy_traps): Adversarial and counterexample tasks where:
      (1) a spurious positional/count shortcut matches the small training split (N in [3..4])
          100% by construction, but fails under object permutation or size scaling (N in [7..10]);
      (2) two distinct sub-primitives are intentionally confounded on the training/validation
          splits so the task is ambiguous without adversarial boundary checks; or
      (3) labels are corrupted by severe noise so no candidate generalizes.
    A guarded learner must reject/quarantine false or ambiguous candidates and avoid
    contaminating active SkillMemory.
"""
from dataclasses import dataclass, field
import random
from typing import Any, Dict, List, Optional, Tuple

COLORS = (0, 1, 2)
SIZES = (1, 2, 3, 4, 5, 6)
CHARGES = (0, 1)
POSITIONS = tuple(range(12))

TASK_FAMILIES = (
    "A_primitive_synthesis",
    "B_composition_with_synthesized",
    "C_spurious_and_noisy_traps",
)


def validate_scene_objects(objects: List[Dict[str, int]]) -> None:
    if not isinstance(objects, list) or len(objects) < 2:
        raise ValueError("scene 'objects' must be a list of at least 2 object dicts")
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
    """Order-invariant canonical representation of a scene for split disjointness checks."""
    return tuple(sorted((int(o["color"]), int(o["size"]), int(o["charge"]), int(o["pos"])) for o in objects))


# --- M16 Base Primitives (Available in Initial Grammar Before M17 Synthesis) ---

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


# --- M17 Synthesizable Sub-Primitive DSL Semantics ---

def eval_subprimitive_dsl(dsl_type: str, params: Dict[str, Any], objects: List[Dict[str, int]]) -> int:
    """Evaluate a candidate relational sub-primitive from the M17 formal DSL.

    Includes both genuine structural/relational sub-primitives (permutation- and scale-invariant)
    and spurious positional/count shortcut templates that may fit small training sets by
    coincidence but fail adversarial invariance or size-transfer checks.
    """
    if dsl_type == "pair_color_size_delta":
        # Exists ordered pair (o1, o2) with color c1, c2 and o2.size - o1.size == delta
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

    if dsl_type == "pair_proximal_dipole":
        # Exists pair (o1, o2) of same color with |pos1 - pos2| <= max_gap and opposite charge
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

    if dsl_type == "triad_monotone_size_distinct_color":
        # Exists triad (o0, o1, o2) with colors (0, 1, 2), lead object o0 having charge == target_charge,
        # and strictly increasing size o0.size < o1.size < o2.size.
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
        # Non-vacuous universal: at least one object has color == c, and all objects of color c have charge == target_charge
        c = int(params["color"])
        target_charge = int(params["charge"])
        matching = [o for o in objects if o["color"] == c]
        if not matching:
            return 0
        return int(all(o["charge"] == target_charge for o in matching))

    # Spurious / Non-Invariant Templates in the raw DSL candidate space (must be caught by adversarial checks):
    if dsl_type == "spurious_slot0_charge":
        # Depends on array index 0 (violates permutation invariance!)
        target_charge = int(params["charge"])
        return int(objects[0]["charge"] == target_charge)

    if dsl_type == "spurious_exact_count_and_color":
        # Depends on small scene object count <= max_count (violates size-scaling invariance!)
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
class M17TaskRule:
    rule_id: str
    family: str
    subprimitive: SubPrimitiveSpec
    combinator: str = "ID"
    base_partner: Optional[Tuple[str, Dict[str, Any]]] = None
    is_valid_target: bool = True
    trap_type: Optional[str] = None
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
            "is_valid_target": self.is_valid_target,
            "trap_type": self.trap_type,
            "description": self.description,
        }


@dataclass
class M17TaskBundle:
    """Complete task bundle for a single seed across Families A, B, and C, plus locked M16 regression tasks."""

    seed: int
    locked_m16_regression_tasks: List[Dict[str, Any]]
    base_warmup_tasks: List[Dict[str, Any]]
    family_a_task: Dict[str, Any]
    family_b_task: Dict[str, Any]
    family_c_task: Dict[str, Any]


class SubPrimitiveSynthesisWorld:
    """Deterministic generator for M17 (E10) tasks."""

    def __init__(self, seed: int) -> None:
        if isinstance(seed, bool) or not isinstance(seed, int):
            raise ValueError("seed must be an integer")
        self.seed = seed

    @staticmethod
    def _sample_scene(n_objects: int, rng: random.Random) -> List[Dict[str, int]]:
        if n_objects < 2 or n_objects > 15:
            raise ValueError("n_objects must be in [2, 15]")
        positions = rng.sample(POSITIONS, k=min(n_objects, len(POSITIONS)))
        while len(positions) < n_objects:
            positions.append(rng.choice(POSITIONS))
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
        eval_fn,
        count: int,
        size_range: Tuple[int, int],
        used_keys: set,
        rng: random.Random,
    ) -> List[Dict[str, Any]]:
        positives: List[Dict[str, Any]] = []
        negatives: List[Dict[str, Any]] = []
        target_pos = count // 2
        target_neg = count - target_pos
        lo, hi = size_range

        attempts = 0
        max_attempts = count * 160
        while (len(positives) < target_pos or len(negatives) < target_neg) and attempts < max_attempts:
            attempts += 1
            n_obj = rng.randint(lo, hi)
            objs = self._sample_scene(n_obj, rng)
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
            objs = self._sample_scene(n_obj, rng)
            key = scene_canonical_key(objs)
            if key in used_keys:
                continue
            used_keys.add(key)
            combined.append({"objects": objs, "label": int(eval_fn(objs)), "n_objects": n_obj})

        rng.shuffle(combined)
        return combined

    def target_subprimitive_for_seed(self) -> SubPrimitiveSpec:
        rng = random.Random(self.seed * 53 + 19)
        variant = self.seed % 3
        if variant == 0:
            c1 = rng.choice((0, 1))
            c2 = 2
            delta = rng.choice((2, 3))
            return SubPrimitiveSpec("pair_color_size_delta", {"c1": c1, "c2": c2, "delta": delta})
        if variant == 1:
            col = rng.choice((0, 1, 2))
            gap = rng.choice((1, 2))
            return SubPrimitiveSpec("pair_proximal_dipole", {"color": col, "max_gap": gap})
        ch = rng.choice((0, 1))
        return SubPrimitiveSpec("triad_monotone_size_distinct_color", {"charge": ch})

    def generate_bundle(
        self,
        train_size: int = 18,
        val_size: int = 14,
        independent_size_val: int = 14,
        test_size: int = 36,
    ) -> M17TaskBundle:
        if train_size < 6 or val_size < 6 or independent_size_val < 6 or test_size < 12:
            raise ValueError("split sizes too small")

        rng = random.Random(self.seed * 101 + 7)
        used_keys: set = set()

        # 1. Locked M16 Regression Suite (3 core M16 tasks that must not regress after any promotion).
        reg_specs = [
            ("exists_color_size_ge", {"color": 0, "min_size": 5}),
            ("parity_sum_charge", {"parity": 0}),
            ("argmax_size_has_charge", {"charge": 1}),
        ]
        locked_regression_tasks: List[Dict[str, Any]] = []
        for r_idx, (p_name, p_params) in enumerate(reg_specs):
            fn = lambda objs, pn=p_name, pp=p_params: eval_m16_base_primitive(pn, pp, objs)
            r_train = self._sample_balanced_scenes(fn, 16, (4, 6), used_keys, rng)
            r_test = self._sample_balanced_scenes(fn, 20, (5, 8), used_keys, rng)
            locked_regression_tasks.append(
                {
                    "task_id": f"m16_reg_{r_idx}_s{self.seed}",
                    "primitive": (p_name, p_params),
                    "train_examples": r_train,
                    "test_examples": r_test,
                }
            )

        # 2. Base skill warm-up tasks for Family B composition.
        partner_color = rng.choice((0, 1, 2))
        partner_parity = rng.choice((0, 1))
        base_partners = [
            ("parity_sum_charge", {"parity": partner_parity}),
            ("exists_color_size_ge", {"color": partner_color, "min_size": 5}),
        ]
        base_warmup_tasks: List[Dict[str, Any]] = []
        for b_idx, (bp_name, bp_params) in enumerate(base_partners):
            fn = lambda objs, pn=bp_name, pp=bp_params: eval_m16_base_primitive(pn, pp, objs)
            w_train = self._sample_balanced_scenes(fn, 20, (4, 6), used_keys, rng)
            w_val = self._sample_balanced_scenes(fn, 12, (4, 6), used_keys, rng)
            base_warmup_tasks.append(
                {
                    "skill_id": f"base_skill_{b_idx}_s{self.seed}",
                    "primitive": (bp_name, bp_params),
                    "train_examples": w_train,
                    "val_examples": w_val,
                }
            )

        # 3. Family A: Synthesis of unknown primitive relation.
        subprim = self.target_subprimitive_for_seed()
        rule_a = M17TaskRule(
            rule_id=f"e10_A_s{self.seed}",
            family="A_primitive_synthesis",
            subprimitive=subprim,
            combinator="ID",
            is_valid_target=True,
            description=f"Synthesize missing relational sub-primitive {subprim.canonical_id()}",
        )
        a_train = self._sample_balanced_scenes(rule_a.evaluate, train_size, (4, 6), used_keys, rng)
        a_val = self._sample_balanced_scenes(rule_a.evaluate, val_size, (4, 6), used_keys, rng)
        # Independent validation split at larger object counts N in [7..10]
        a_ind_size_val = self._sample_balanced_scenes(
            rule_a.evaluate, independent_size_val, (7, 10), used_keys, rng
        )
        a_test_small = self._sample_balanced_scenes(rule_a.evaluate, test_size // 2, (4, 6), used_keys, rng)
        a_test_large = self._sample_balanced_scenes(
            rule_a.evaluate, test_size - (test_size // 2), (8, 11), used_keys, rng
        )
        family_a_task = {
            "task_id": rule_a.rule_id,
            "family": "A_primitive_synthesis",
            "should_promote": True,
            "train_examples": a_train,
            "val_examples": a_val,
            "independent_size_val_examples": a_ind_size_val,
            "test_examples": a_test_small + a_test_large,
            "test_large_size_examples": a_test_large,
            "ground_truth_rule": rule_a,
        }

        # 4. Family B: Composition of newly synthesized sub-primitive with existing base skill.
        chosen_partner = base_partners[self.seed % len(base_partners)]
        chosen_comb = ("AND", "XOR", "OR", "AND_NOT")[self.seed % 4]
        rule_b = M17TaskRule(
            rule_id=f"e10_B_s{self.seed}",
            family="B_composition_with_synthesized",
            subprimitive=subprim,
            combinator=chosen_comb,
            base_partner=chosen_partner,
            is_valid_target=True,
            description=f"Compose synthesized {subprim.canonical_id()} with {chosen_partner[0]} via {chosen_comb}",
        )
        b_train = self._sample_balanced_scenes(rule_b.evaluate, train_size, (4, 6), used_keys, rng)
        b_val = self._sample_balanced_scenes(rule_b.evaluate, val_size, (4, 6), used_keys, rng)
        b_ind_size_val = self._sample_balanced_scenes(
            rule_b.evaluate, independent_size_val, (7, 10), used_keys, rng
        )
        b_test_small = self._sample_balanced_scenes(rule_b.evaluate, test_size // 2, (4, 6), used_keys, rng)
        b_test_large = self._sample_balanced_scenes(
            rule_b.evaluate, test_size - (test_size // 2), (8, 11), used_keys, rng
        )
        family_b_task = {
            "task_id": rule_b.rule_id,
            "family": "B_composition_with_synthesized",
            "should_promote": False,
            "train_examples": b_train,
            "val_examples": b_val,
            "independent_size_val_examples": b_ind_size_val,
            "test_examples": b_test_small + b_test_large,
            "test_large_size_examples": b_test_large,
            "ground_truth_rule": rule_b,
        }

        # 5. Family C: Counterexamples and misleading patterns (must be rejected/quarantined!).
        trap_mode = self.seed % 3
        trap_subprim = SubPrimitiveSpec("forall_color_charged", {"color": 1, "charge": 1})
        rule_c = M17TaskRule(
            rule_id=f"e10_C_trap{trap_mode}_s{self.seed}",
            family="C_spurious_and_noisy_traps",
            subprimitive=trap_subprim,
            combinator="ID",
            is_valid_target=False,
            trap_type=(
                "spurious_positional_shortcut"
                if trap_mode == 0
                else ("confounded_ambiguous_twin" if trap_mode == 1 else "corrupted_training_overfit")
            ),
            description="Adversarial trap task where false/ambiguous candidate fits training split.",
        )

        c_test_small = self._sample_balanced_scenes(rule_c.evaluate, test_size // 2, (4, 6), used_keys, rng)
        c_test_large = self._sample_balanced_scenes(
            rule_c.evaluate, test_size - (test_size // 2), (8, 11), used_keys, rng
        )

        if trap_mode == 0:
            # Trap 0: Spurious positional shortcut (`spurious_slot0_charge(charge=1)`).
            # Construct train and val scenes where objs[0] has charge=lbl and objs[1] has charge=1-lbl
            # with identical (color=0, size=3, pos=0/1). As an unordered multiset, positive and negative
            # scenes are distributed identically, so no permutation-invariant rule can exceed ~50%,
            # whereas spurious_slot0_charge(charge=1) achieves 100% on both train and val!
            def make_positional_trap_split(n_scenes: int, sz_range: Tuple[int, int]) -> List[Dict[str, Any]]:
                out = []
                for idx in range(n_scenes):
                    lbl = idx % 2
                    n_obj = rng.randint(sz_range[0], sz_range[1])
                    objs = self._sample_scene(n_obj, rng)
                    objs[0] = {"color": 0, "size": 3, "charge": lbl, "pos": 1}
                    objs[1] = {"color": 0, "size": 3, "charge": 1 - lbl, "pos": 1}
                    for k, o in enumerate(objs[2:]):
                        o["color"] = 1 if (k % 2 == 0) else 2
                        o["charge"] = k % 2
                        o["size"] = 5
                    out.append({"objects": objs, "label": lbl, "n_objects": n_obj})
                return out

            c_train = make_positional_trap_split(train_size, (4, 5))
            c_val = make_positional_trap_split(val_size, (4, 5))
            c_ind_size_val = make_positional_trap_split(independent_size_val, (7, 10))

        elif trap_mode == 1:
            # Trap 1: Confounded ambiguous twin rules. Every scene in train, val, and ind_size_val
            # is constructed so that `forall_color_charged(color=1, charge=1)` and
            # `forall_color_charged(color=2, charge=1)` both equal `lbl` (100% accuracy), while
            # two color=0 objects have charge=(1-lbl) so global charge sum/ratio/parity and max-size
            # objects are invariant to `lbl` (~50% base grammar accuracy).
            def make_confounded_split(n_scenes: int, sz_range: Tuple[int, int]) -> List[Dict[str, Any]]:
                out = []
                for idx in range(n_scenes):
                    lbl = idx % 2
                    n_obj = max(5, rng.randint(sz_range[0], sz_range[1]))
                    objs = self._sample_scene(n_obj, rng)
                    objs[0] = {"color": 1, "size": 3, "charge": lbl, "pos": 1}
                    objs[1] = {"color": 2, "size": 3, "charge": lbl, "pos": 2}
                    objs[2] = {"color": 0, "size": 3, "charge": 1 - lbl, "pos": 3}
                    objs[3] = {"color": 0, "size": 3, "charge": 1 - lbl, "pos": 4}
                    objs[4] = {"color": 0, "size": 6, "charge": (idx // 2) % 2, "pos": 11}
                    for k, o in enumerate(objs[5:]):
                        o["color"] = 0
                        o["size"] = 4
                        o["charge"] = k % 2
                    rng.shuffle(objs)
                    out.append({"objects": objs, "label": lbl, "n_objects": n_obj})
                return out

            c_train = make_confounded_split(train_size, (5, 6))
            c_val = make_confounded_split(val_size, (5, 6))
            c_ind_size_val = make_confounded_split(independent_size_val, (7, 10))

        else:
            # Trap 2: Training-only overfit / misleading correlation (`forall_color_charged(color=0, charge=1)`
            # fits 100% of train_examples and passes structural invariance, but fails on the independent
            # validation split where labels follow noisy rule_c). Only Stage 2 (Validation Guard) can catch this!
            misleading_train_spec = SubPrimitiveSpec("forall_color_charged", {"color": 0, "charge": 1})
            c_train = self._sample_balanced_scenes(misleading_train_spec.evaluate, train_size, (4, 6), used_keys, rng)
            raw_c_val = self._sample_balanced_scenes(rule_c.evaluate, val_size, (4, 6), used_keys, rng)
            # Flip 40% of validation labels so neither misleading_train_spec nor any other candidate passes validation.
            c_val = [
                {
                    "objects": item["objects"],
                    "label": (1 - int(item["label"])) if (idx % 5 in (0, 1)) else int(item["label"]),
                    "n_objects": item["n_objects"],
                }
                for idx, item in enumerate(raw_c_val)
            ]
            c_ind_size_val = self._sample_balanced_scenes(
                rule_c.evaluate, independent_size_val, (7, 10), used_keys, rng
            )

        family_c_task = {
            "task_id": rule_c.rule_id,
            "family": "C_spurious_and_noisy_traps",
            "trap_type": rule_c.trap_type,
            "should_promote": False,
            "train_examples": c_train,
            "val_examples": c_val,
            "independent_size_val_examples": c_ind_size_val,
            "test_examples": c_test_small + c_test_large,
            "test_large_size_examples": c_test_large,
            "ground_truth_rule": rule_c,
        }

        return M17TaskBundle(
            seed=self.seed,
            locked_m16_regression_tasks=locked_regression_tasks,
            base_warmup_tasks=base_warmup_tasks,
            family_a_task=family_a_task,
            family_b_task=family_b_task,
            family_c_task=family_c_task,
        )
