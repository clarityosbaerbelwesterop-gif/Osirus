"""M16.2 & M16.3 (E9) — Bounded Relational Grammar, Skill-Memory Composition,
Active Disagreement Querying, Validation Guard, and Fair Baselines.
"""
from collections import Counter
from dataclasses import dataclass, field
from functools import lru_cache
import math
import random
from statistics import mean
from typing import Any, Dict, List, Optional, Tuple

from environment import (
    CHARGES,
    COLORS,
    POSITIONS,
    SIZES,
    eval_combinator,
    eval_primitive_node,
    validate_scene_objects,
)

BINARY_COMBINATORS = ("AND", "OR", "XOR", "AND_NOT", "IMPLIES")
UNARY_COMBINATORS = ("ID", "NOT")


@dataclass(frozen=True)
class GrammarHypothesis:
    """Explicit, inspectable relational rule AST with bounded depth (1 or 2)."""

    hypothesis_id: str
    operator: str
    left_primitive: Tuple[str, Dict[str, Any]]
    right_primitive: Optional[Tuple[str, Dict[str, Any]]] = None
    depth: int = 1
    complexity: int = 1
    source: str = "grammar_enumerated"

    def predict_scene(self, objects: List[Dict[str, int]]) -> int:
        validate_scene_objects(objects)
        return self.predict_scene_unchecked(objects)

    def predict_scene_unchecked(self, objects: List[Dict[str, int]]) -> int:
        lv = eval_primitive_node(self.left_primitive[0], self.left_primitive[1], objects)
        rv = (
            eval_primitive_node(self.right_primitive[0], self.right_primitive[1], objects)
            if self.right_primitive is not None
            else None
        )
        return eval_combinator(self.operator, lv, rv)

    def predict_all(self, examples: List[Dict[str, Any]]) -> List[int]:
        for ex in examples:
            validate_scene_objects(ex["objects"])
        return [self.predict_scene_unchecked(ex["objects"]) for ex in examples]

    def format_expression(self) -> str:
        l_str = f"{self.left_primitive[0]}({self.left_primitive[1]})"
        if self.operator == "ID":
            return l_str
        if self.operator == "NOT":
            return f"NOT({l_str})"
        r_str = (
            f"{self.right_primitive[0]}({self.right_primitive[1]})"
            if self.right_primitive is not None
            else "None"
        )
        return f"{self.operator}({l_str}, {r_str})"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "hypothesis_id": self.hypothesis_id,
            "expression": self.format_expression(),
            "operator": self.operator,
            "left_primitive": [self.left_primitive[0], dict(self.left_primitive[1])],
            "right_primitive": (
                [self.right_primitive[0], dict(self.right_primitive[1])]
                if self.right_primitive is not None
                else None
            ),
            "depth": self.depth,
            "complexity": self.complexity,
            "source": self.source,
        }


def build_canonical_probe_scenes(seed: int = 1337, n_probes: int = 28) -> List[List[Dict[str, int]]]:
    """Fixed probe scenes used only for semantic deduplication and functional equivalence checks."""
    rng = random.Random(seed)
    scenes: List[List[Dict[str, int]]] = []
    for idx in range(n_probes):
        n_obj = 3 + (idx % 7)
        scene = [
            {
                "color": rng.choice(COLORS),
                "size": rng.choice(SIZES),
                "charge": rng.choice(CHARGES),
                "pos": rng.choice(POSITIONS),
            }
            for _ in range(n_obj)
        ]
        scenes.append(scene)
    return scenes


CANONICAL_PROBE_SCENES = build_canonical_probe_scenes()


def semantic_signature(hypothesis: GrammarHypothesis, probes: List[List[Dict[str, int]]] = CANONICAL_PROBE_SCENES) -> Tuple[int, ...]:
    return tuple(hypothesis.predict_scene(s) for s in probes)


class RelationalGrammarGenerator:
    """Bounded grammar generator with recursion depth limit, candidate cap, and semantic deduplication."""

    def __init__(
        self,
        max_depth: int = 2,
        max_candidates: int = 420,
        deduplicate_semantics: bool = True,
        include_heldout_c1_primitives: bool = True,
    ) -> None:
        if max_depth not in (1, 2):
            raise ValueError("max_depth must be 1 or 2")
        if max_candidates < 1:
            raise ValueError("max_candidates must be >= 1")
        self.max_depth = max_depth
        self.max_candidates = max_candidates
        self.deduplicate_semantics = deduplicate_semantics
        self.include_heldout_c1_primitives = include_heldout_c1_primitives

    def enumerate_primitives(self) -> List[Tuple[str, Dict[str, Any], int]]:
        """Return (primitive_name, params, complexity) tuples."""
        primitives: List[Tuple[str, Dict[str, Any], int]] = []
        for c in COLORS:
            for s in (3, 4, 5, 6):
                primitives.append(("exists_color_size_ge", {"color": c, "min_size": s}, 1))
        for s in (2, 3, 4):
            primitives.append(("all_size_ge", {"min_size": s}, 1))
        for num, den in ((1, 3), (1, 2), (2, 3)):
            primitives.append(("charge_ratio_ge", {"num": num, "den": den}, 1))
        for p in (0, 1):
            primitives.append(("parity_sum_charge", {"parity": p}, 1))
        for ch in (0, 1):
            primitives.append(("argmax_size_has_charge", {"charge": ch}, 2))
        for c in COLORS:
            primitives.append(("argmax_size_has_color", {"color": c}, 2))

        if self.include_heldout_c1_primitives:
            for max_diff in (0, 1):
                primitives.append(("exists_pair_same_color_close_size", {"max_diff": max_diff}, 2))
            for src_c in (0, 1):
                primitives.append(("exists_directed_dominance", {"src_color": src_c, "dst_color": 2}, 2))
        return primitives

    def generate(self) -> Tuple[List[GrammarHypothesis], int]:
        """Return (deduplicated_candidates, n_duplicates_removed)."""
        cached_cands, duplicates = _cached_generate_grammar(
            self.max_depth,
            self.max_candidates,
            self.deduplicate_semantics,
            self.include_heldout_c1_primitives,
        )
        return list(cached_cands), duplicates


@lru_cache(maxsize=32)
def _cached_generate_grammar(
    max_depth: int,
    max_candidates: int,
    deduplicate_semantics: bool,
    include_heldout_c1_primitives: bool,
) -> Tuple[Tuple[GrammarHypothesis, ...], int]:
    gen = RelationalGrammarGenerator.__new__(RelationalGrammarGenerator)
    gen.max_depth = max_depth
    gen.max_candidates = max_candidates
    gen.deduplicate_semantics = deduplicate_semantics
    gen.include_heldout_c1_primitives = include_heldout_c1_primitives
    prims = gen.enumerate_primitives()
    raw_candidates: List[GrammarHypothesis] = []

    for idx, (p_name, p_params, comp) in enumerate(prims):
        raw_candidates.append(
            GrammarHypothesis(
                hypothesis_id=f"d1_id_{idx}_{p_name}",
                operator="ID",
                left_primitive=(p_name, dict(p_params)),
                depth=1,
                complexity=comp,
            )
        )
        raw_candidates.append(
            GrammarHypothesis(
                hypothesis_id=f"d1_not_{idx}_{p_name}",
                operator="NOT",
                left_primitive=(p_name, dict(p_params)),
                depth=1,
                complexity=comp + 1,
            )
        )

    if max_depth >= 2:
        composable_prims = [
            p for p in prims
            if p[0] in ("exists_color_size_ge", "parity_sum_charge", "charge_ratio_ge", "all_size_ge")
        ]
        for i, (l_name, l_params, l_comp) in enumerate(composable_prims):
            for j, (r_name, r_params, r_comp) in enumerate(composable_prims):
                if i == j or l_name == r_name:
                    continue
                for op in BINARY_COMBINATORS:
                    if op in ("AND", "OR", "XOR") and i > j:
                        continue
                    raw_candidates.append(
                        GrammarHypothesis(
                            hypothesis_id=f"d2_{op.lower()}_{i}_{j}",
                            operator=op,
                            left_primitive=(l_name, dict(l_params)),
                            right_primitive=(r_name, dict(r_params)),
                            depth=2,
                            complexity=l_comp + r_comp + 2,
                        )
                    )

    raw_candidates.sort(key=lambda h: (h.depth, h.complexity, h.hypothesis_id))

    if not deduplicate_semantics:
        capped = tuple(raw_candidates[:max_candidates])
        return capped, 0

    unique: List[GrammarHypothesis] = []
    seen_signatures: set = set()
    duplicates = 0
    for cand in raw_candidates:
        sig = semantic_signature(cand)
        if sig in seen_signatures:
            duplicates += 1
            continue
        seen_signatures.add(sig)
        unique.append(cand)
        if len(unique) >= max_candidates:
            break

    return tuple(unique), duplicates


@dataclass
class VerifiedRelationalSkill:
    skill_id: str
    hypothesis: GrammarHypothesis
    unit_tests: List[Dict[str, Any]]
    val_accuracy: float

    def verify(self) -> bool:
        if not self.unit_tests:
            return False
        for item in self.unit_tests:
            if self.hypothesis.predict_scene(item["objects"]) != item["label"]:
                return False
        return True


class RelationalSkillMemory:
    """Stores verified relational skills and synthesizes M14 multi-operator compositions."""

    def __init__(self) -> None:
        self.skills: List[VerifiedRelationalSkill] = []

    def register(
        self,
        skill_id: str,
        hypothesis: GrammarHypothesis,
        unit_tests: List[Dict[str, Any]],
        val_accuracy: float,
        min_val_accuracy: float = 0.90,
    ) -> Optional[VerifiedRelationalSkill]:
        if val_accuracy < min_val_accuracy:
            return None
        rec = VerifiedRelationalSkill(
            skill_id=skill_id,
            hypothesis=hypothesis,
            unit_tests=list(unit_tests[:6]),
            val_accuracy=val_accuracy,
        )
        if not rec.verify():
            return None
        self.skills.append(rec)
        return rec

    def synthesize_compositions(self) -> List[GrammarHypothesis]:
        active = [s for s in self.skills if s.verify() and s.hypothesis.depth == 1]
        composed: List[GrammarHypothesis] = []
        for s in active:
            composed.append(
                GrammarHypothesis(
                    hypothesis_id=f"mem_reuse_{s.skill_id}",
                    operator=s.hypothesis.operator,
                    left_primitive=s.hypothesis.left_primitive,
                    right_primitive=s.hypothesis.right_primitive,
                    depth=1,
                    complexity=s.hypothesis.complexity,
                    source="skill_memory_reuse",
                )
            )
        for i, s_left in enumerate(active):
            for j, s_right in enumerate(active):
                if i == j:
                    continue
                for op in BINARY_COMBINATORS:
                    if op in ("AND", "OR", "XOR") and i > j:
                        continue
                    composed.append(
                        GrammarHypothesis(
                            hypothesis_id=f"mem_comp_{op}({s_left.skill_id},{s_right.skill_id})",
                            operator=op,
                            left_primitive=s_left.hypothesis.left_primitive,
                            right_primitive=s_right.hypothesis.left_primitive,
                            depth=2,
                            complexity=2,
                            source="skill_memory_composition",
                        )
                    )
        return composed


class RIRelationalAgent:
    """Integrated M16 RI Agent combining M13 active querying, M14 skill composition, and M15 validation/abstention guard."""

    def __init__(
        self,
        max_depth: int = 2,
        max_candidates: int = 420,
        use_skill_memory: bool = True,
        use_active_query: bool = True,
        query_budget: int = 3,
        use_validation_guard: bool = True,
        min_identifiable_accuracy: float = 0.81,
        complexity_weight: float = 0.008,
        memory_bonus: float = 0.025,
        oracle_noise_prob: float = 0.0,
        seed: int = 0,
    ) -> None:
        self.max_depth = max_depth
        self.max_candidates = max_candidates
        self.use_skill_memory = use_skill_memory
        self.use_active_query = use_active_query
        self.query_budget = query_budget
        self.use_validation_guard = use_validation_guard
        self.min_identifiable_accuracy = min_identifiable_accuracy
        self.complexity_weight = complexity_weight
        self.memory_bonus = memory_bonus
        self.oracle_noise_prob = oracle_noise_prob
        self.seed = seed

        self.memory = RelationalSkillMemory()
        self.selected: Optional[GrammarHypothesis] = None
        self.status: str = "unfitted"
        self.abstained: bool = False
        self.uncertainty_score: float = 1.0
        self.n_candidates_evaluated: int = 0
        self.n_semantically_deduplicated: int = 0
        self.queries_used: int = 0
        self.n_tied_best: int = 0
        self.train_accuracy: float = 0.0
        self.val_accuracy: float = 0.0
        self.fallback_majority_label: int = 0

    @staticmethod
    def _accuracy(hyp: GrammarHypothesis, examples: List[Dict[str, Any]]) -> float:
        if not examples:
            return 0.0
        correct = sum(1 for e in examples if hyp.predict_scene_unchecked(e["objects"]) == e["label"])
        return correct / len(examples)

    @staticmethod
    def _entropy_disagreement(candidates: List[GrammarHypothesis], objects: List[Dict[str, int]]) -> float:
        n = len(candidates)
        if n <= 1:
            return 0.0
        pos = sum(1 for c in candidates if c.predict_scene_unchecked(objects) == 1)
        if pos == 0 or pos == n:
            return 0.0
        p = pos / n
        return -(p * math.log2(p) + (1.0 - p) * math.log2(1.0 - p))

    def acquire_warmup_skills(self, warmup_tasks: List[Dict[str, Any]]) -> int:
        if not self.use_skill_memory or not warmup_tasks:
            return 0
        gen = RelationalGrammarGenerator(max_depth=1, max_candidates=120, deduplicate_semantics=True)
        d1_cands, _ = gen.generate()
        acquired = 0
        for w_task in warmup_tasks:
            w_train = w_task["train_examples"]
            w_val = w_task["val_examples"]
            scored = []
            for cand in d1_cands:
                t_acc = self._accuracy(cand, w_train)
                v_acc = self._accuracy(cand, w_val)
                scored.append(((t_acc + v_acc) / 2.0, -cand.complexity, cand))
            scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
            best_score, _, best_cand = scored[0]
            rec = self.memory.register(
                skill_id=w_task["task_id"],
                hypothesis=best_cand,
                unit_tests=w_train[:6],
                val_accuracy=best_score,
            )
            if rec is not None:
                acquired += 1
        return acquired

    def fit(
        self,
        train_examples: List[Dict[str, Any]],
        val_examples: List[Dict[str, Any]],
        query_pool: Optional[List[Dict[str, Any]]] = None,
        warmup_tasks: Optional[List[Dict[str, Any]]] = None,
    ) -> "RIRelationalAgent":
        if not train_examples:
            raise ValueError("train_examples must not be empty")
        if not val_examples:
            raise ValueError("val_examples must not be empty")

        counts = Counter(int(e["label"]) for e in train_examples)
        self.fallback_majority_label = min(counts, key=lambda k: (-counts[k], k))

        if warmup_tasks:
            self.acquire_warmup_skills(warmup_tasks)

        d1_gen = RelationalGrammarGenerator(
            max_depth=1,
            max_candidates=self.max_candidates,
            deduplicate_semantics=True,
        )
        d1_cands, d1_dedup = d1_gen.generate()

        mem_cands = (
            self.memory.synthesize_compositions()
            if (self.use_skill_memory and self.max_depth >= 2)
            else (
                [
                    s.hypothesis
                    for s in self.memory.skills
                    if s.verify() and s.hypothesis.depth <= self.max_depth
                ]
                if self.use_skill_memory
                else []
            )
        )

        # Stage 1: Evaluate memory compositions + depth-1 primitives first.
        stage1_candidates = mem_cands + d1_cands
        need_full_depth2 = self.max_depth >= 2
        if mem_cands and self.max_depth >= 2:
            best_mem_score = max(
                0.5 * self._accuracy(c, train_examples) + 0.5 * self._accuracy(c, val_examples)
                for c in mem_cands
            )
            if best_mem_score >= 0.92:
                need_full_depth2 = False

        if need_full_depth2:
            full_gen = RelationalGrammarGenerator(
                max_depth=self.max_depth,
                max_candidates=self.max_candidates,
                deduplicate_semantics=True,
            )
            grammar_cands, n_dedup = full_gen.generate()
            self.n_semantically_deduplicated = n_dedup
            all_candidates = mem_cands + grammar_cands
        else:
            self.n_semantically_deduplicated = d1_dedup
            all_candidates = stage1_candidates

        all_candidates = all_candidates[: self.max_candidates + len(mem_cands)]
        self.n_candidates_evaluated = len(all_candidates)
        if not all_candidates:
            raise RuntimeError("candidate hypothesis set is empty")

        working_train = list(train_examples)
        available_pool = list(query_pool or [])
        self.queries_used = 0

        # M13 Active Disagreement Querying on unlabeled pool when near-ties exist on working_train.
        if self.use_active_query and self.query_budget > 0 and available_pool:
            rng = random.Random(self.seed + 50_003)
            for _ in range(self.query_budget):
                train_scores = [self._accuracy(c, working_train) for c in all_candidates]
                best_tr = max(train_scores)
                # Version space: candidates matching best training accuracy (or within 1 example if validation guard is active).
                tol = (1.0 / len(working_train)) if self.use_validation_guard else 1e-9
                vspace = [c for c, s in zip(all_candidates, train_scores) if s >= best_tr - tol]
                if len(vspace) <= 1 or not available_pool:
                    break

                scored_pool = []
                for idx, item in enumerate(available_pool):
                    ent = self._entropy_disagreement(vspace, item["objects"])
                    scored_pool.append((ent, -idx, idx, item))
                scored_pool.sort(reverse=True)
                best_ent, _, chosen_idx, chosen_item = scored_pool[0]
                if best_ent <= 0.0:
                    break

                available_pool.pop(chosen_idx)
                revealed_label = int(chosen_item["label"])
                if self.oracle_noise_prob > 0.0 and rng.random() < self.oracle_noise_prob:
                    revealed_label = 1 - revealed_label
                working_train.append(
                    {
                        "objects": chosen_item["objects"],
                        "label": revealed_label,
                        "n_objects": chosen_item.get("n_objects", len(chosen_item["objects"])),
                    }
                )
                self.queries_used += 1

                # If validation guard is disabled (strict elimination mode),
                # eliminate candidates from the tied version space that disagree with the queried point.
                if not self.use_validation_guard:
                    filtered = [
                        c for c in vspace
                        if c.predict_scene_unchecked(chosen_item["objects"]) == revealed_label
                    ]
                    if filtered:
                        all_candidates = filtered

        # Score candidates using M15 validation consistency guard (or train-only if disabled).
        ranked: List[Tuple[Tuple[float, float, int, str], float, float, GrammarHypothesis]] = []
        for cand in all_candidates:
            tr_acc = self._accuracy(cand, working_train)
            vl_acc = self._accuracy(cand, val_examples)
            is_mem = cand.source in ("skill_memory_reuse", "skill_memory_composition")
            bonus = self.memory_bonus if is_mem else 0.0
            comp_pen = self.complexity_weight * (cand.complexity - 1)

            if self.use_validation_guard:
                # Joint train + validation consistency score penalizing train-val divergence.
                combined_acc = 0.55 * tr_acc + 0.45 * vl_acc
                objective = combined_acc + bonus - comp_pen
            else:
                combined_acc = tr_acc
                objective = tr_acc + bonus - comp_pen

            sort_key = (
                round(objective, 6),
                round(vl_acc if self.use_validation_guard else tr_acc, 6),
                -cand.complexity,
                cand.hypothesis_id,
            )
            ranked.append((sort_key, tr_acc, vl_acc, cand))

        ranked.sort(key=lambda item: item[0], reverse=True)
        best_key, best_tr_acc, best_vl_acc, best_cand = ranked[0]
        tied = [
            item[3]
            for item in ranked
            if abs(item[1] - best_tr_acc) < 1e-9
            and (not self.use_validation_guard or abs(item[2] - best_vl_acc) < 1e-9)
        ]

        self.selected = best_cand
        self.train_accuracy = best_tr_acc
        self.val_accuracy = best_vl_acc
        self.n_tied_best = len(tied)

        tie_uncertainty = min(0.4, (len(tied) - 1) * 0.05)
        empirical_error = 1.0 - (0.5 * best_tr_acc + 0.5 * best_vl_acc)
        self.uncertainty_score = min(1.0, max(0.0, empirical_error + tie_uncertainty))

        if self.use_validation_guard and (
            best_vl_acc < self.min_identifiable_accuracy
            or (0.5 * best_tr_acc + 0.5 * best_vl_acc) < self.min_identifiable_accuracy
        ):
            self.status = "unidentified_high_uncertainty"
            self.abstained = True
        else:
            self.status = "identified"
            self.abstained = False

        return self

    def predict(self, unlabeled_examples: List[Dict[str, Any]]) -> List[int]:
        if self.selected is None:
            raise RuntimeError("fit must be called before predict")
        for ex in unlabeled_examples:
            if "label" in ex:
                raise ValueError("test examples passed to predict() must not contain 'label'")
        return self.selected.predict_all(unlabeled_examples)


# --- M16.3 Fair Baselines ---

class MajorityPriorBaseline:
    """1. Majority / Prior Baseline."""

    def __init__(self) -> None:
        self.majority_label: Optional[int] = None

    def fit(self, train_examples: List[Dict[str, Any]], val_examples: Optional[List[Dict[str, Any]]] = None) -> "MajorityPriorBaseline":
        if not train_examples:
            raise ValueError("train_examples must not be empty")
        pool = list(train_examples) + list(val_examples or [])
        counts = Counter(int(e["label"]) for e in pool)
        self.majority_label = min(counts, key=lambda k: (-counts[k], k))
        return self

    def predict(self, unlabeled_examples: List[Dict[str, Any]]) -> List[int]:
        if self.majority_label is None:
            raise RuntimeError("fit must be called before predict")
        return [int(self.majority_label) for _ in unlabeled_examples]


class SupervisedFeatureReferenceBaseline:
    """2. Supervised Reference Method (3-NN over unnormalized scene count/sum & positional features).

    Extracts unnormalized count and attribute aggregations plus positional features of the
    first object in array order:
      - Unnormalized counts/sums: [sum_charge, count_color_0, count_color_1, count_color_2,
        count_size_ge_4, count_size_ge_5, max_size_in_first_3_positions_charge,
        max_size_in_first_3_positions_color, first_obj_charge]
    Because these features rely on raw counts (rather than scale-invariant ratios) and inspect
    only the first 3 array positions for maximum size, this supervised classifier performs well
    when object count N matches the training range [3..5], but degrades substantially when N
    scales to [7..11] in Regime B or under XOR compositions in Regime A.
    """

    def __init__(self, k: int = 3) -> None:
        self.k = k
        self.training_vectors: List[Tuple[List[float], int]] = []

    @staticmethod
    def extract_features(objects: List[Dict[str, int]]) -> List[float]:
        validate_scene_objects(objects)
        window = objects[:3]
        top_w = max(window, key=lambda o: o["size"])
        return [
            float(sum(o["charge"] for o in objects)),
            float(sum(1 for o in objects if o["color"] == 0 and o["size"] >= 4)),
            float(sum(1 for o in objects if o["color"] == 1 and o["size"] >= 4)),
            float(sum(1 for o in objects if o["color"] == 2 and o["size"] >= 4)),
            float(top_w["charge"] * 2.0),
            float(top_w["color"]),
            float(objects[0]["charge"]),
            float(sum(o["charge"] for o in window) % 2),
        ]

    def fit(
        self,
        train_examples: List[Dict[str, Any]],
        val_examples: Optional[List[Dict[str, Any]]] = None,
    ) -> "SupervisedFeatureReferenceBaseline":
        if not train_examples:
            raise ValueError("train_examples must not be empty")
        pool = list(train_examples) + list(val_examples or [])
        self.training_vectors = [
            (self.extract_features(e["objects"]), int(e["label"])) for e in pool
        ]
        return self

    def predict_one(self, objects: List[Dict[str, int]]) -> int:
        if not self.training_vectors:
            raise RuntimeError("fit must be called before predict")
        vec = self.extract_features(objects)
        dists = []
        for idx, (tr_vec, lbl) in enumerate(self.training_vectors):
            sq_dist = sum((a - b) ** 2 for a, b in zip(vec, tr_vec))
            dists.append((sq_dist, idx, lbl))
        dists.sort(key=lambda item: (item[0], item[1]))
        top_k = dists[: min(self.k, len(dists))]
        votes = sum(lbl for _, _, lbl in top_k)
        return int(votes * 2 >= len(top_k))

    def predict(self, unlabeled_examples: List[Dict[str, Any]]) -> List[int]:
        if not self.training_vectors:
            raise RuntimeError("fit must be called before predict")
        for ex in unlabeled_examples:
            if "label" in ex:
                raise ValueError("test examples passed to predict() must not contain 'label'")
        return [self.predict_one(ex["objects"]) for ex in unlabeled_examples]


class RandomHypothesisBaseline:
    """6. Random Hypothesis Control from the same bounded relational grammar."""

    def __init__(self, seed: int = 0, max_candidates: int = 420) -> None:
        self.seed = seed
        self.max_candidates = max_candidates
        self.selected: Optional[GrammarHypothesis] = None
        self.n_candidates_evaluated: int = 1

    def fit(self, train_examples: List[Dict[str, Any]]) -> "RandomHypothesisBaseline":
        if not train_examples:
            raise ValueError("train_examples must not be empty")
        cands, _ = RelationalGrammarGenerator(max_depth=2, max_candidates=self.max_candidates).generate()
        rng = random.Random(self.seed)
        self.selected = rng.choice(cands)
        return self

    def predict(self, unlabeled_examples: List[Dict[str, Any]]) -> List[int]:
        if self.selected is None:
            raise RuntimeError("fit must be called before predict")
        for ex in unlabeled_examples:
            if "label" in ex:
                raise ValueError("test examples passed to predict() must not contain 'label'")
        return self.selected.predict_all(unlabeled_examples)
