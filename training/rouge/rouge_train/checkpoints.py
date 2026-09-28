"""Rouge checkpoints: names, manifests, lineage and promotion (M58).

The unit of progress for Rouge is a checkpoint. Every checkpoint -- adapter,
merged or full -- carries a manifest that makes it reproducible and
auditable: what it came from, which run and code produced it, on which data
version and hyperparameters, the sha256 of every file, and its evaluations.
Weights live in object storage; the manifest (a few KB) is what the
repository keeps.

A candidate is promoted only when it is measured against its parent on the
same evaluation suites and versions, on held-out splits: it must improve at
least one target suite and regress on none beyond its tolerance.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from .hashing import hash_tree

SCHEMA = "rouge.checkpoint/1"

# rouge-1-sft-001, rouge-1-reasoning-002, rouge-1-context-003, rouge-1-rc1,
# rouge-1. The stage says what training produced it; the number is global
# and increasing within the lineage. `exp` checkpoints are recipe
# experiments; `edge` checkpoints are quantised (GGUF) derivatives of a
# lineage checkpoint for local inference -- never another base model.
STAGES = ("base", "exp", "sft", "reasoning", "pref", "rl", "context", "mm", "code", "science", "edge")
NAME = re.compile(rf"^rouge-1(?:-(?:{'|'.join(STAGES)})-\d{{3}}|-rc\d+)?$")
KINDS = ("adapter", "merged", "full", "gguf")
STATUSES = ("candidate", "promoted", "rejected", "archived")
HOLDOUT_SPLITS = ("holdout", "adversarial")


class ManifestError(ValueError):
    pass


def check_name(name: str) -> str:
    if not NAME.match(name):
        raise ManifestError(
            f"{name!r} is not a Rouge checkpoint name (e.g. rouge-1-sft-001)"
        )
    return name


def create(
    *,
    name: str,
    parent: str,
    kind: str,
    weights_dir: Path,
    run: dict,
    data: dict,
    hyperparameters: dict,
    seed: int,
    storage_uri: str,
) -> dict:
    """A candidate checkpoint's manifest, with every file hashed."""
    check_name(name)
    if kind not in KINDS:
        raise ManifestError(f"kind must be one of {KINDS}")
    if not (parent.startswith("base:") or NAME.match(parent)):
        raise ManifestError("parent must be the pinned base or a Rouge checkpoint")
    for key in ("id", "code_commit", "environment_lock_sha256", "hardware"):
        if not run.get(key):
            raise ManifestError(f"run.{key} is required for reproducibility")
    for key in ("registry_version", "mixture", "tokens"):
        if not data.get(key):
            raise ManifestError(f"data.{key} is required for provenance")
    files = hash_tree(weights_dir)
    if not files:
        raise ManifestError(f"no files under {weights_dir}")
    return {
        "schema": SCHEMA,
        "name": name,
        "parent": parent,
        "kind": kind,
        "status": "candidate",
        "run": run,
        "data": data,
        "hyperparameters": hyperparameters,
        "seed": seed,
        "storage": {"uri": storage_uri},
        "files": files,
        "evaluations": [],
    }


def add_evaluation(manifest: dict, *, suite: str, version: str, split: str, metrics: dict, run: str) -> dict:
    manifest["evaluations"].append(
        {"suite": suite, "version": version, "split": split, "metrics": metrics, "run": run}
    )
    return manifest


def verify(manifest: dict, weights_dir: Path) -> list[str]:
    """Files whose size or hash differs from the manifest (empty = intact)."""
    actual = {f["path"]: f for f in hash_tree(weights_dir)}
    problems = []
    for entry in manifest["files"]:
        found = actual.get(entry["path"])
        if not found:
            problems.append(f"missing {entry['path']}")
        elif found["sha256"] != entry["sha256"] or found["size"] != entry["size"]:
            problems.append(f"changed {entry['path']}")
    return problems


def lineage(name: str, store: dict[str, dict]) -> list[str]:
    """Names from the checkpoint back to the pinned base, newest first."""
    chain = [name]
    seen = {name}
    while not chain[-1].startswith("base:"):
        parent = store[chain[-1]]["parent"]
        if parent in seen:
            raise ManifestError(f"lineage cycle at {parent}")
        seen.add(parent)
        chain.append(parent)
    return chain


def _score(manifest: dict, suite: str, version: str) -> float | None:
    for evaluation in manifest["evaluations"]:
        if (
            evaluation["suite"] == suite
            and evaluation["version"] == version
            and evaluation["split"] in HOLDOUT_SPLITS
        ):
            return float(evaluation["metrics"]["score"])
    return None


def promotion_decision(
    candidate: dict,
    parent: dict,
    *,
    targets: dict[str, str],
    guards: dict[str, tuple[str, float]],
    min_gain: float = 0.0,
) -> tuple[bool, list[str]]:
    """Whether a candidate may replace its parent.

    targets: suite -> version; at least one must improve by more than
             min_gain on a held-out split.
    guards:  suite -> (version, tolerance); none may drop by more than its
             tolerance.
    Both checkpoints must have been measured on exactly these suites and
    versions; a missing measurement blocks promotion.
    """
    reasons: list[str] = []
    if candidate["parent"] != parent["name"]:
        reasons.append("candidate is not a child of this parent")
    improved = False
    for suite, version in targets.items():
        new, old = _score(candidate, suite, version), _score(parent, suite, version)
        if new is None or old is None:
            reasons.append(f"{suite}@{version}: not measured on a held-out split for both")
        elif new - old > min_gain:
            improved = True
    if not improved:
        reasons.append("no target suite improved")
    for suite, (version, tolerance) in guards.items():
        new, old = _score(candidate, suite, version), _score(parent, suite, version)
        if new is None or old is None:
            reasons.append(f"{suite}@{version}: guard not measured for both")
        elif old - new > tolerance:
            reasons.append(f"{suite}@{version}: regressed {old - new:.4f} > {tolerance}")
    return (not reasons, reasons)


def save(manifest: dict, directory: Path) -> Path:
    path = directory / f"{manifest['name']}.json"
    path.write_text(json.dumps(manifest, indent=1) + "\n")
    return path
