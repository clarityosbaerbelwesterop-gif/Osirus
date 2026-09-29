"""Active test selection benchmark (R1.36).

The input is a table of 4 candidates (letters) with 4 binary attributes:
    <bos> a 1 0 1 1 ; b 0 0 1 0 ; c ... ; d ... ; ?
The answer is the hidden target (one of the 4 letters). The model cannot
see the target's attributes: it may QUERY attribute indices, and each
query returns the target's value for that attribute (the "oracle", passed
to the model as a separate tensor and readable only through the queries it
chooses). With a budget of k queries, the question is whether the model
learns to ask informative questions.

Every table has at least one pair of attributes that separates all 4
candidates, so 2 well-chosen queries always suffice; 2 badly chosen ones
often do not. Levels: ID tables are drawn with 4 attributes; OOD tables
use a different random seed family and require the separating pair to
involve attribute 3 or 4 more often (the model cannot memorise a fixed
query order).
"""

from __future__ import annotations

import itertools
import random

from benchmarks.suite3 import LETTERS, PAD, TOKEN, VOCAB  # noqa: F401

N, A = 4, 4
LEVELS = {"clues": {"id": (1, 1), "ood": (2, 2)}}
TASKS = ("clues",)


def _separating_pairs(rows):
    return [(i, j) for i, j in itertools.combinations(range(A), 2) if len({(r[i], r[j]) for r in rows}) == N]


def example(r: random.Random, task: str, split: str):
    while True:
        rows = [[r.randint(0, 1) for _ in range(A)] for _ in range(N)]
        if len({tuple(x) for x in rows}) < N:
            continue
        pairs = _separating_pairs(rows)
        if not pairs:
            continue
        if split == "ood" and all(2 not in p and 3 not in p for p in pairs):
            continue  # OOD: the separating pair uses attribute 3 or 4
        if split != "ood" and all(p != (0, 1) for p in pairs) and r.random() < 0.5:
            continue  # ID skews towards attributes 1 and 2 separating
        break
    names = r.sample(LETTERS, N)
    target = r.randrange(N)
    tokens = ["<bos>"]
    for n, row in zip(names, rows):
        tokens += [n] + [str(v) for v in row] + [";"]
    tokens += ["?"]
    return [TOKEN[w] for w in tokens], TOKEN[names[target]], task, 1 if split != "ood" else 2


def batch(r, size, split="id", tasks=TASKS, max_level=None):
    return [example(r, "clues", split) for _ in range(size)]


def fixed_set(namespace, per_task, split, tasks=TASKS):
    r = random.Random(f"clues:{namespace}:{split}")
    return [example(r, "clues", split) for _ in range(per_task)]


def table(tokens):
    w = [VOCAB[t] for t in tokens]
    return [(w[i], [int(x) for x in w[i + 1:i + 1 + A]]) for i in range(1, 1 + N * (A + 2), A + 2)]


def oracle(tokens, answer):
    """The target's attribute vector: what an answered query reveals."""
    return next(row for name, row in table(tokens) if TOKEN[name] == answer)


def solve(tokens, task):
    raise NotImplementedError("the answer needs queries: see prototypes/active.py")


def guess_level(task, tokens):
    return 1 / N
