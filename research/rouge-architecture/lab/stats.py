"""Seed-level statistics for research reports (standard library only).

Three seeds are the minimum; every table reports mean, sample standard
deviation and a 95% confidence interval (Student t), never the best seed.
"""

from __future__ import annotations

import math

# Two-sided 95% Student t quantiles by degrees of freedom.
T95 = {1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228}


def mean(xs: list[float]) -> float:
    return sum(xs) / len(xs)


def sd(xs: list[float]) -> float:
    if len(xs) < 2:
        return 0.0
    m = mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def ci95(xs: list[float]) -> tuple[float, float]:
    m = mean(xs)
    if len(xs) < 2:
        return (m, m)
    half = T95.get(len(xs) - 1, 1.96) * sd(xs) / math.sqrt(len(xs))
    return (m - half, m + half)


def summary(xs: list[float]) -> dict:
    lo, hi = ci95(xs)
    return {"mean": mean(xs), "sd": sd(xs), "ci95": [lo, hi], "n": len(xs), "values": xs}


def spearman(xs: list[float], ys: list[float]) -> float:
    def ranks(v):  # average ranks, so ties carry no correlation
        order = sorted(range(len(v)), key=v.__getitem__)
        r = [0.0] * len(v)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]:
                j += 1
            for k in range(i, j + 1):
                r[order[k]] = (i + j) / 2
            i = j + 1
        return r

    if len(xs) < 3:
        return 0.0
    rx, ry = ranks(xs), ranks(ys)
    mx, my = mean(rx), mean(ry)
    cov = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    var = math.sqrt(sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry))
    return cov / var if var else 0.0
