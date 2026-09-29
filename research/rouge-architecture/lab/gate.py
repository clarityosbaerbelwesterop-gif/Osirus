"""Pre-registered gates as data (no eval): checks compare metrics of models
from a summary table, and ordered decision rules map checks to a result.

    "gate": {
      "checks": {
        "C1": {"left": "rouge-mem:ood.recall", "op": ">=", "right": "transformer:ood.recall", "plus": -0.02},
        "C2": {"left": "rouge-mem:flops", "op": "<=", "right": "transformer:flops", "times": 2},
        "C3": {"left": "rouge-mem:ood.recall", "op": ">", "value": 0.5, "every_seed": true}
      },
      "decision": [
        {"result": "PASS", "all": ["C1", "C2"]},
        {"result": "PARTIAL", "any": ["C1", "C3"]},
        {"result": "PARTIAL", "at_least": {"n": 2, "of": ["C1", "C2", "C3"]}},
        {"result": "FAIL"}
      ]
    }

A metric reference is "model:metric". A metric is a summary {"mean", "values"}
or a plain number. `every_seed` compares seed by seed (paired by position)."""

from __future__ import annotations

import operator

OPS = {">=": operator.ge, "<=": operator.le, ">": operator.gt, "<": operator.lt}


def _metric(table: dict, ref: str):
    model, metric = ref.split(":", 1)
    return table[model]["metrics"][metric]


def _values(m, every_seed: bool):
    if isinstance(m, dict):
        return m["values"] if every_seed else [m["mean"]]
    return [m]


def check(table: dict, spec: dict) -> bool:
    if "left_any" in spec:  # true if the comparison holds for any of the listed metrics
        return any(check(table, {**{k: v for k, v in spec.items() if k != "left_any"}, "left": ref}) for ref in spec["left_any"])
    every = spec.get("every_seed", False)
    left = _values(_metric(table, spec["left"]), every)
    if "right" in spec:
        right = _values(_metric(table, spec["right"]), every)
    else:
        right = [spec["value"]] * len(left)
    if len(right) == 1 and len(left) > 1:
        right = right * len(left)
    right = [r * spec.get("times", 1) + spec.get("plus", 0) for r in right]
    return all(OPS[spec["op"]](a, b) for a, b in zip(left, right))


def decide(table: dict, gate: dict) -> dict:
    results, missing = {}, []
    for name, spec in gate["checks"].items():
        try:
            results[name] = check(table, spec)
        except KeyError as error:
            missing.append(f"{name}: {error}")
    if missing:
        return {"complete": False, "missing": missing, "checks": results}
    for rule in gate["decision"]:
        if "all" in rule and not all(results[c] for c in rule["all"]):
            continue
        if "any" in rule and not any(results[c] for c in rule["any"]):
            continue
        if "at_least" in rule and sum(results[c] for c in rule["at_least"]["of"]) < rule["at_least"]["n"]:
            continue
        return {"complete": True, "checks": results, "result": rule["result"]}
    return {"complete": True, "checks": results, "result": "UNDEFINED"}
