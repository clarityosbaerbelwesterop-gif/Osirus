"""Step 1 — Task Input representation, validation, and procedural task generation."""
from dataclasses import dataclass, field
import random
import re
from typing import Any, Dict, List, Optional, Tuple

ALLOWED_ACTIONS = (
    "predict_sum_threshold",
    "predict_diff_threshold",
    "predict_parity",
    "predict_mod_sum",
    "predict_coord_box",
    "predict_composed",
)

SECRET_RE = re.compile(
    r"(api[_-]?key|secret[_-]?key|access[_-]?token|private[_-]?key|password\s*[:=]|ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,})",
    re.IGNORECASE,
)


def ensure_no_secrets(text: str) -> None:
    if SECRET_RE.search(text):
        raise ValueError("input or artifact contains disallowed secret-like pattern")


def validate_example(example: Dict[str, Any], bounds: Tuple[int, int] = (0, 7), require_label: bool = True) -> None:
    if not isinstance(example, dict) or "x" not in example or "y" not in example:
        raise ValueError("example must be a dict containing 'x' and 'y'")
    x, y = example["x"], example["y"]
    if isinstance(x, bool) or isinstance(y, bool) or not isinstance(x, int) or not isinstance(y, int):
        raise ValueError("coordinates 'x' and 'y' must be integers")
    lo, hi = bounds
    if not (lo <= x <= hi and lo <= y <= hi):
        raise ValueError(f"coordinates ({x}, {y}) outside bounds [{lo}, {hi}]")
    if require_label:
        if "label" not in example or isinstance(example["label"], bool) or example["label"] not in (0, 1):
            raise ValueError("example 'label' must be integer 0 or 1")


@dataclass(frozen=True)
class TaskConstraints:
    allowed_actions: Tuple[str, ...] = ALLOWED_ACTIONS
    max_steps: int = 256
    timeout_ms: float = 2000.0
    input_bounds: Tuple[int, int] = (0, 7)

    def validate(self) -> "TaskConstraints":
        if not self.allowed_actions:
            raise ValueError("allowed_actions must not be empty")
        for action in self.allowed_actions:
            if action not in ALLOWED_ACTIONS:
                raise ValueError(f"disallowed action in constraints: {action}")
        if isinstance(self.max_steps, bool) or not isinstance(self.max_steps, int) or self.max_steps < 1:
            raise ValueError("max_steps must be a positive integer")
        if isinstance(self.timeout_ms, bool) or not isinstance(self.timeout_ms, (int, float)) or self.timeout_ms <= 0:
            raise ValueError("timeout_ms must be positive")
        lo, hi = self.input_bounds
        if isinstance(lo, bool) or isinstance(hi, bool) or not isinstance(lo, int) or not isinstance(hi, int) or lo > hi:
            raise ValueError("invalid input_bounds")
        return self


@dataclass(frozen=True)
class SuccessCriteria:
    min_train_accuracy: float = 0.90
    min_held_out_accuracy: float = 0.85
    require_disjoint_split: bool = True
    max_runtime_ms: float = 2000.0

    def validate(self) -> "SuccessCriteria":
        for name, val in (
            ("min_train_accuracy", self.min_train_accuracy),
            ("min_held_out_accuracy", self.min_held_out_accuracy),
        ):
            if isinstance(val, bool) or not isinstance(val, (int, float)) or not 0.0 <= float(val) <= 1.0:
                raise ValueError(f"{name} must be in [0.0, 1.0]")
        if isinstance(self.max_runtime_ms, bool) or not isinstance(self.max_runtime_ms, (int, float)) or self.max_runtime_ms <= 0:
            raise ValueError("max_runtime_ms must be positive")
        return self


@dataclass
class TaskSpec:
    task_id: str
    family: str
    description: str
    train_examples: List[Dict[str, int]]
    test_examples: List[Dict[str, int]]
    constraints: TaskConstraints = field(default_factory=TaskConstraints)
    success_criteria: SuccessCriteria = field(default_factory=SuccessCriteria)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def validate(self) -> "TaskSpec":
        if not isinstance(self.task_id, str) or not self.task_id.strip():
            raise ValueError("task_id must be a non-empty string")
        if not isinstance(self.family, str) or not self.family.strip():
            raise ValueError("family must be a non-empty string")
        if not isinstance(self.description, str) or not self.description.strip():
            raise ValueError("description must be a non-empty string")
        ensure_no_secrets(f"{self.task_id} {self.family} {self.description} {self.metadata}")
        self.constraints.validate()
        self.success_criteria.validate()
        if not self.train_examples:
            raise ValueError("train_examples must not be empty")
        if not self.test_examples:
            raise ValueError("test_examples must not be empty")
        for ex in self.train_examples:
            validate_example(ex, self.constraints.input_bounds, require_label=True)
        for ex in self.test_examples:
            validate_example(ex, self.constraints.input_bounds, require_label=True)
        if self.success_criteria.require_disjoint_split:
            train_pts = {(e["x"], e["y"]) for e in self.train_examples}
            test_pts = {(e["x"], e["y"]) for e in self.test_examples}
            if not train_pts.isdisjoint(test_pts):
                raise ValueError("train_examples and test_examples must be disjoint")
        return self


def generate_grid_task(
    seed: int,
    family: Optional[str] = None,
    train_size: int = 18,
    test_size: int = 24,
    task_id: Optional[str] = None,
    parameter_override: Optional[Dict[str, Any]] = None,
) -> TaskSpec:
    """Deterministically generate a grid task with disjoint development and held-out splits."""
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise ValueError("seed must be an integer")
    if train_size < 1 or test_size < 1 or train_size + test_size > 64:
        raise ValueError("train_size and test_size must be positive and sum to at most 64")

    rng = random.Random(seed)
    families = ("sum_threshold", "parity", "diff_threshold", "mod_sum", "coord_box", "composed_and")
    chosen_family = rng.choice(families) if family is None else family
    if chosen_family not in families:
        raise ValueError(f"unknown task family: {chosen_family}")

    params: Dict[str, Any] = dict(parameter_override or {})
    if chosen_family == "sum_threshold":
        t = params.get("threshold", rng.randint(5, 10))
        params["threshold"] = t
        rule_fn = lambda x, y: int(x + y >= t)
        desc = f"Classify 8x8 grid points by sum threshold (hidden t={t})."
    elif chosen_family == "parity":
        p = params.get("parity", rng.choice((0, 1)))
        params["parity"] = p
        rule_fn = lambda x, y: int((x + y) % 2 == p)
        desc = f"Classify 8x8 grid points by sum parity (hidden parity={p})."
    elif chosen_family == "diff_threshold":
        d = params.get("threshold", rng.randint(-2, 3))
        params["threshold"] = d
        rule_fn = lambda x, y: int(x - y >= d)
        desc = f"Classify 8x8 grid points by difference threshold (hidden d={d})."
    elif chosen_family == "mod_sum":
        modulus = params.get("modulus", 3)
        remainder = params.get("remainder", rng.randint(0, modulus - 1))
        params["modulus"] = modulus
        params["remainder"] = remainder
        rule_fn = lambda x, y: int((x + y) % modulus == remainder)
        desc = f"Classify 8x8 grid points by modular sum (hidden mod={modulus}, rem={remainder})."
    elif chosen_family == "coord_box":
        tx = params.get("min_x", rng.randint(2, 4))
        ty = params.get("min_y", rng.randint(2, 4))
        params["min_x"] = tx
        params["min_y"] = ty
        rule_fn = lambda x, y: int(x >= tx and y >= ty)
        desc = f"Classify 8x8 grid points by coordinate box (hidden min_x={tx}, min_y={ty})."
    else:  # composed_and: sum_threshold AND parity
        t = params.get("threshold", rng.randint(5, 8))
        p = params.get("parity", rng.choice((0, 1)))
        params["threshold"] = t
        params["parity"] = p
        rule_fn = lambda x, y: int((x + y >= t) and ((x + y) % 2 == p))
        desc = f"Classify 8x8 grid points by composed rule: sum_threshold(t={t}) AND parity(p={p})."

    points = [(x, y) for x in range(8) for y in range(8)]
    rng.shuffle(points)
    examples = [{"x": x, "y": y, "label": rule_fn(x, y)} for x, y in points]
    train = examples[:train_size]
    test = examples[train_size:train_size + test_size]

    return TaskSpec(
        task_id=task_id or f"task_{chosen_family}_s{seed}",
        family=chosen_family,
        description=desc,
        train_examples=train,
        test_examples=test,
        metadata={"seed": seed, "ground_truth_params": params},
    ).validate()
