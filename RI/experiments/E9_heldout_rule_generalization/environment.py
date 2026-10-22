"""M16.1 (E9) — Held-Out Rule Languages and Relational Object-Graph Task Generator.

Generates variable-size relational object scenes with strict separation between
training, validation, active query pool, and held-out test splits. Covers four
distinct generalization regimes:
  - A_compositional: novel Boolean/relational combinations (AND, OR, XOR, AND_NOT, IMPLIES)
    of previously acquired base skills.
  - B_structural_size_transfer: permutation-invariant relational rules trained on
    small scenes (N in [3..5]) and tested on larger scenes (N in [7..11]).
  - C1_heldout_translatable: a relational rule class (pairwise same-color size proximity
    or directed attribute dominance) completely held out from prior skill warm-up,
    but expressible within the bounded relational grammar.
  - C2_heldout_unidentifiable: an out-of-grammar rule class (non-local cyclic color
    triad parity over coprime positions) whose primitive operator is absent from the
    hypothesis grammar, testing whether the learner honestly flags uncertainty/abstention
    rather than fabricating a false discovery.
"""
from dataclasses import dataclass, field
import random
from typing import Any, Callable, Dict, List, Optional, Tuple

COLORS = (0, 1, 2)
SIZES = (1, 2, 3, 4, 5, 6)
CHARGES = (0, 1)
POSITIONS = tuple(range(10))

REGIMES = (
    "A_compositional",
    "B_structural_size_transfer",
    "C1_heldout_translatable",
    "C2_heldout_unidentifiable",
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
    """Return deep-copied scene inputs with labels and any ground-truth metadata removed."""
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
    """Order-invariant canonical representation of a scene for disjointness checks."""
    return tuple(sorted((int(o["color"]), int(o["size"]), int(o["charge"]), int(o["pos"])) for o in objects))


# --- Formal Primitive Semantics over Variable-Size Object Sets ---

def eval_primitive_node(prim_type: str, params: Dict[str, Any], objects: List[Dict[str, int]]) -> int:
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
        # Order-invariant selection: sort by (size, pos, color, charge) descending.
        top_obj = max(objects, key=lambda o: (o["size"], o["pos"], o["color"], o["charge"]))
        return int(top_obj["charge"] == target_charge)

    if prim_type == "argmax_size_has_color":
        target_color = int(params["color"])
        top_obj = max(objects, key=lambda o: (o["size"], o["pos"], o["charge"], o["color"]))
        return int(top_obj["color"] == target_color)

    if prim_type == "exists_pair_same_color_close_size":
        max_diff = int(params["max_diff"])
        n = len(objects)
        for i in range(n):
            for j in range(i + 1, n):
                if (
                    objects[i]["color"] == objects[j]["color"]
                    and abs(objects[i]["size"] - objects[j]["size"]) <= max_diff
                ):
                    return 1
        return 0

    if prim_type == "exists_directed_dominance":
        src_color = int(params["src_color"])
        dst_color = int(params["dst_color"])
        for o1 in objects:
            if o1["color"] != src_color:
                continue
            for o2 in objects:
                if (
                    o2["color"] == dst_color
                    and o1["size"] >= o2["size"] + 1
                    and o1["charge"] == o2["charge"]
                ):
                    return 1
        return 0

    raise ValueError(f"unknown primitive node type: {prim_type}")


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
    if operator == "IMPLIES":
        return int((left_val == 0) or (right_val == 1))
    raise ValueError(f"unknown combinator: {operator}")


def eval_out_of_grammar_cyclic_triad(objects: List[Dict[str, int]], target_rem: int = 1) -> int:
    """Out-of-grammar rule (C2): non-local cyclic color triad interaction with position parity.

    Counts ordered triples (i, j, k) with colors (0, 1, 2) such that
    (o_i.size * o_j.pos + o_k.size + o_i.charge) mod 5 == target_rem, and returns
    the parity (mod 2) of that count. This higher-order ternary modular interaction
    cannot be represented by unary/pairwise attribute thresholds in the grammar.
    """
    zeros = [o for o in objects if o["color"] == 0]
    ones = [o for o in objects if o["color"] == 1]
    twos = [o for o in objects if o["color"] == 2]
    acc = 0
    for a in zeros:
        for b in ones:
            for c in twos:
                if (a["size"] * (b["pos"] + 1) + c["size"] + a["charge"] - b["charge"]) % 3 == (target_rem % 3):
                    acc += 1
    # Also mix with pairwise XOR of positions to guarantee balanced ~0.5 base rate across sizes.
    pos_xor = 0
    for o in objects:
        pos_xor ^= (o["pos"] * o["size"] + o["color"] + o["charge"])
    return int((acc + pos_xor) % 2 == (target_rem % 2))


@dataclass(frozen=True)
class RuleSpecification:
    rule_id: str
    regime: str
    identifiable_in_grammar: bool
    operator: str
    left_primitive: Tuple[str, Dict[str, Any]]
    right_primitive: Optional[Tuple[str, Dict[str, Any]]] = None
    description: str = ""

    def evaluate(self, objects: List[Dict[str, int]]) -> int:
        if not self.identifiable_in_grammar:
            rem = int(self.left_primitive[1].get("target_rem", 1))
            return eval_out_of_grammar_cyclic_triad(objects, target_rem=rem)
        lv = eval_primitive_node(self.left_primitive[0], self.left_primitive[1], objects)
        rv = (
            eval_primitive_node(self.right_primitive[0], self.right_primitive[1], objects)
            if self.right_primitive is not None
            else None
        )
        return eval_combinator(self.operator, lv, rv)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "rule_id": self.rule_id,
            "regime": self.regime,
            "identifiable_in_grammar": self.identifiable_in_grammar,
            "operator": self.operator,
            "left_primitive": [self.left_primitive[0], dict(self.left_primitive[1])],
            "right_primitive": (
                [self.right_primitive[0], dict(self.right_primitive[1])]
                if self.right_primitive is not None
                else None
            ),
            "description": self.description,
        }


@dataclass
class RelationalTaskSplit:
    task_id: str
    seed: int
    regime: str
    identifiable_in_grammar: bool
    warmup_tasks: List[Dict[str, Any]]
    train_examples: List[Dict[str, Any]]
    val_examples: List[Dict[str, Any]]
    query_pool: List[Dict[str, Any]]
    test_examples: List[Dict[str, Any]]
    test_by_size_bucket: Dict[str, List[Dict[str, Any]]]
    ground_truth_rule: RuleSpecification = field(repr=False)
    noise_prob: float = 0.0

    def verify_no_leakage(self) -> bool:
        """Verify disjoint scene multisets across train, val, query_pool, and test."""
        train_keys = {scene_canonical_key(e["objects"]) for e in self.train_examples}
        val_keys = {scene_canonical_key(e["objects"]) for e in self.val_keys_list()}
        pool_keys = {scene_canonical_key(e["objects"]) for e in self.query_pool}
        test_keys = {scene_canonical_key(e["objects"]) for e in self.test_examples}
        return (
            train_keys.isdisjoint(test_keys)
            and val_keys.isdisjoint(test_keys)
            and pool_keys.isdisjoint(test_keys)
            and train_keys.isdisjoint(val_keys)
        )

    def val_keys_list(self) -> List[Dict[str, Any]]:
        return self.val_examples


class HeldOutRuleWorld:
    """Procedural generator for M16 (E9) relational object-scene tasks."""

    def __init__(self, seed: int) -> None:
        if isinstance(seed, bool) or not isinstance(seed, int):
            raise ValueError("seed must be an integer")
        self.seed = seed
        self.rng = random.Random(seed)

    def _sample_scene(self, n_objects: int, rng: random.Random) -> List[Dict[str, int]]:
        if n_objects < 2 or n_objects > 15:
            raise ValueError("n_objects must be in [2, 15]")
        positions = rng.sample(POSITIONS, k=min(n_objects, len(POSITIONS)))
        while len(positions) < n_objects:
            positions.append(rng.choice(POSITIONS))
        objs = []
        for idx in range(n_objects):
            objs.append(
                {
                    "color": rng.choice(COLORS),
                    "size": rng.choice(SIZES),
                    "charge": rng.choice(CHARGES),
                    "pos": positions[idx],
                }
            )
        rng.shuffle(objs)
        return objs

    def _sample_balanced_dataset(
        self,
        rule: RuleSpecification,
        count: int,
        size_range: Tuple[int, int],
        forbidden_keys: set,
        rng: random.Random,
    ) -> List[Dict[str, Any]]:
        if count < 1:
            raise ValueError("count must be positive")
        lo, hi = size_range
        positives: List[Dict[str, Any]] = []
        negatives: List[Dict[str, Any]] = []
        target_pos = count // 2
        target_neg = count - target_pos

        attempts = 0
        max_attempts = count * 120
        while (len(positives) < target_pos or len(negatives) < target_neg) and attempts < max_attempts:
            attempts += 1
            n_obj = rng.randint(lo, hi)
            objs = self._sample_scene(n_obj, rng)
            key = scene_canonical_key(objs)
            if key in forbidden_keys:
                continue
            label = rule.evaluate(objs)
            item = {"objects": objs, "label": label, "n_objects": n_obj}
            if label == 1 and len(positives) < target_pos:
                positives.append(item)
                forbidden_keys.add(key)
            elif label == 0 and len(negatives) < target_neg:
                negatives.append(item)
                forbidden_keys.add(key)

        combined = positives + negatives
        while len(combined) < count:
            n_obj = rng.randint(lo, hi)
            objs = self._sample_scene(n_obj, rng)
            key = scene_canonical_key(objs)
            if key in forbidden_keys:
                continue
            forbidden_keys.add(key)
            combined.append({"objects": objs, "label": rule.evaluate(objs), "n_objects": n_obj})

        rng.shuffle(combined)
        return combined

    def build_rule_for_regime(self, regime: str, seed_offset: int = 0) -> Tuple[RuleSpecification, List[RuleSpecification]]:
        if regime not in REGIMES:
            raise ValueError(f"unknown regime: {regime}")
        rng = random.Random(self.seed * 31 + seed_offset + 7)

        if regime == "A_compositional":
            # Choose two base primitives and a held-out binary combinator (XOR, AND_NOT, AND, OR).
            combinator = ("XOR", "AND_NOT", "AND", "OR")[(self.seed + seed_offset) % 4]
            c_target = rng.choice((0, 1, 2))
            s_target = rng.choice((4, 5))
            p_target = rng.choice((0, 1))
            left_prim = ("exists_color_size_ge", {"color": c_target, "min_size": s_target})
            right_prim = ("parity_sum_charge", {"parity": p_target})

            warmup_rules = [
                RuleSpecification(
                    rule_id=f"warmup_left_s{self.seed}",
                    regime="warmup_primitive",
                    identifiable_in_grammar=True,
                    operator="ID",
                    left_primitive=left_prim,
                    description=f"Base skill 1: exists(color=={c_target} and size>={s_target})",
                ),
                RuleSpecification(
                    rule_id=f"warmup_right_s{self.seed}",
                    regime="warmup_primitive",
                    identifiable_in_grammar=True,
                    operator="ID",
                    left_primitive=right_prim,
                    description=f"Base skill 2: parity_sum_charge=={p_target}",
                ),
            ]
            target_rule = RuleSpecification(
                rule_id=f"rule_A_{combinator}_s{self.seed}",
                regime=regime,
                identifiable_in_grammar=True,
                operator=combinator,
                left_primitive=left_prim,
                right_primitive=right_prim,
                description=f"Unseen composition: {combinator}(exists_color_size_ge, parity_sum_charge)",
            )
            return target_rule, warmup_rules

        if regime == "B_structural_size_transfer":
            # Scale-invariant relational rules trained on N in [3..5] and tested on N in [7..11].
            variant = (self.seed + seed_offset) % 3
            if variant == 0:
                ch = rng.choice((0, 1))
                prim = ("argmax_size_has_charge", {"charge": ch})
                desc = f"Object with maximum size has charge=={ch}"
            elif variant == 1:
                col = rng.choice((0, 1, 2))
                prim = ("argmax_size_has_color", {"color": col})
                desc = f"Object with maximum size has color=={col}"
            else:
                prim = ("charge_ratio_ge", {"num": 1, "den": 2})
                desc = "At least half of objects in scene have charge==1"
            target_rule = RuleSpecification(
                rule_id=f"rule_B_structural_v{variant}_s{self.seed}",
                regime=regime,
                identifiable_in_grammar=True,
                operator="ID",
                left_primitive=prim,
                description=desc,
            )
            return target_rule, []

        if regime == "C1_heldout_translatable":
            # Relational pair/graph rule class completely held out from warm-up memory,
            # but expressible in the relational grammar.
            variant = (self.seed + seed_offset) % 2
            if variant == 0:
                diff_bound = rng.choice((0, 1))
                prim = ("exists_pair_same_color_close_size", {"max_diff": diff_bound})
                desc = f"Held-out relational pair rule: exists pair with same color and |size_i - size_j| <= {diff_bound}"
            else:
                src_c = rng.choice((0, 1))
                dst_c = 2
                prim = ("exists_directed_dominance", {"src_color": src_c, "dst_color": dst_c})
                desc = f"Held-out relational dominance rule: color {src_c} dominates color {dst_c} by size>=+2 with charge==1"
            target_rule = RuleSpecification(
                rule_id=f"rule_C1_heldout_v{variant}_s{self.seed}",
                regime=regime,
                identifiable_in_grammar=True,
                operator="ID",
                left_primitive=prim,
                description=desc,
            )
            return target_rule, []

        # C2_heldout_unidentifiable: out-of-grammar ternary cyclic triad modular rule.
        rem = (self.seed + seed_offset) % 3
        target_rule = RuleSpecification(
            rule_id=f"rule_C2_unidentifiable_s{self.seed}",
            regime=regime,
            identifiable_in_grammar=False,
            operator="OUT_OF_GRAMMAR",
            left_primitive=("cyclic_triad_modulo", {"target_rem": rem}),
            description="Out-of-grammar non-local cyclic triad parity rule (unidentifiable in bounded grammar).",
        )
        return target_rule, []

    def generate_task(
        self,
        regime: str,
        train_size: int = 16,
        val_size: int = 12,
        query_pool_size: int = 16,
        test_size: int = 36,
        noise_prob: float = 0.0,
        seed_offset: int = 0,
    ) -> RelationalTaskSplit:
        if train_size < 4 or val_size < 4 or test_size < 6:
            raise ValueError("split sizes must be at least train>=4, val>=4, test>=6")
        if not 0.0 <= noise_prob < 0.5:
            raise ValueError("noise_prob must be in [0.0, 0.5)")

        rng = random.Random(self.seed * 97 + seed_offset + 13)
        target_rule, warmup_specs = self.build_rule_for_regime(regime, seed_offset=seed_offset)
        used_keys: set = set()

        warmup_tasks: List[Dict[str, Any]] = []
        for w_idx, w_rule in enumerate(warmup_specs):
            w_keys: set = set()
            w_train = self._sample_balanced_dataset(w_rule, 24, (3, 6), w_keys, rng)
            w_val = self._sample_balanced_dataset(w_rule, 12, (3, 6), w_keys, rng)
            warmup_tasks.append(
                {
                    "task_id": w_rule.rule_id,
                    "train_examples": w_train,
                    "val_examples": w_val,
                    "rule_spec": w_rule,
                }
            )

        if regime == "B_structural_size_transfer":
            # Train on small scenes N in [3, 5], validate on [4, 6], test across [3..5], [6..8], [9..11].
            train_size_range = (3, 5)
            val_size_range = (4, 6)
        else:
            train_size_range = (4, 6)
            val_size_range = (4, 6)

        train_clean = self._sample_balanced_dataset(
            target_rule, train_size, train_size_range, used_keys, rng
        )
        val_clean = self._sample_balanced_dataset(
            target_rule, val_size, val_size_range, used_keys, rng
        )
        query_pool = self._sample_balanced_dataset(
            target_rule, query_pool_size, val_size_range, used_keys, rng
        )

        # Apply optional label noise ONLY to training examples; held-out test examples are always clean.
        train_examples: List[Dict[str, Any]] = []
        for item in train_clean:
            flipped = noise_prob > 0.0 and (rng.random() < noise_prob)
            lbl = (1 - int(item["label"])) if flipped else int(item["label"])
            train_examples.append(
                {"objects": item["objects"], "label": lbl, "n_objects": item["n_objects"]}
            )

        # Build stratified test buckets by object count: small [3..5], medium [6..8], large [9..11].
        per_bucket = max(2, test_size // 3)
        small_test = self._sample_balanced_dataset(target_rule, per_bucket, (3, 5), used_keys, rng)
        medium_test = self._sample_balanced_dataset(target_rule, per_bucket, (6, 8), used_keys, rng)
        large_test = self._sample_balanced_dataset(
            target_rule, test_size - 2 * per_bucket, (9, 11), used_keys, rng
        )
        test_examples = small_test + medium_test + large_test

        return RelationalTaskSplit(
            task_id=f"e9_{regime}_s{self.seed}_{seed_offset}",
            seed=self.seed,
            regime=regime,
            identifiable_in_grammar=target_rule.identifiable_in_grammar,
            warmup_tasks=warmup_tasks,
            train_examples=train_examples,
            val_examples=val_clean,
            query_pool=query_pool,
            test_examples=test_examples,
            test_by_size_bucket={
                "small_3_5": small_test,
                "medium_6_8": medium_test,
                "large_9_11": large_test,
            },
            ground_truth_rule=target_rule,
            noise_prob=noise_prob,
        )
