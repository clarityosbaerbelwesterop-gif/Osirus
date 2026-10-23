"""Synthetic, label-sequestered tasks for M19 (E12)."""
import random

TASKS = {
    "noise_0_percent": {"p_correct": 1.00, "identifiable": True},
    "noise_5_percent": {"p_correct": 0.95, "identifiable": True},
    "noise_10_percent": {"p_correct": 0.90, "identifiable": True},
    "noise_20_percent": {"p_correct": 0.80, "identifiable": True},
    "noise_30_percent": {"p_correct": 0.70, "identifiable": True},
    "noise_40_percent": {"p_correct": 0.60, "identifiable": True},
    "insufficient_evidence": {"p_correct": 0.90, "identifiable": True, "sample_cap": 10},
    "stable_high_quality": {"p_correct": 0.99, "identifiable": True},
    "unidentifiable": {"p_correct": None, "identifiable": False},
}


def make_observations(seed: int, task_name: str, max_n: int = 4000):
    """Return outcomes only; caller never receives the generating probability as evidence."""
    task = TASKS[task_name]
    if not task["identifiable"]:
        return []
    rng = random.Random((seed + 1) * 1_000_003 + sum(map(ord, task_name)))
    p = float(task["p_correct"])
    return [int(rng.random() < p) for _ in range(min(max_n, int(task.get("sample_cap", max_n))))]


def make_drift_sequence(seed: int, kind: str, n_before: int = 60, n_after: int = 100):
    """Generate target/anchor match bits; the target regime label stays evaluator-side."""
    rng = random.Random(seed * 65_537 + 17 + sum(map(ord, kind)))
    seq = []
    for i in range(n_before + n_after):
        if kind == "stationary":
            pt, pa = .98, .98
        elif kind == "concept_drift":
            pt, pa = (.98, .98) if i < n_before else (.40, .98)
        elif kind == "noise_surge":
            pt, pa = (.98, .98) if i < n_before else (.60, .60)
        elif kind == "recovery":
            pt, pa = ((.98, .98) if i < n_before else ((.40, .98) if i < n_before + 40 else (.98, .98)))
        elif kind == "gradual_drift":
            frac = max(0.0, min(1.0, (i - n_before) / max(1, n_after - 1)))
            pt, pa = .98 - .58 * frac, .98
        else:
            raise ValueError(f"unknown drift kind: {kind}")
        seq.append((int(rng.random() < pt), int(rng.random() < pa)))
    return seq
