"""Streaming-memory benchmark (R1.12 streaming state, R1.13 forgetting).

A stream is a long sequence of assignments "k = v ;" over letter keys and
digit values, ended by "? k". The answer is k's LATEST value. The model
reads the stream once, left to right: a recurrent model carries its state,
with no replay; a Transformer sees either the whole stream (KV cache
grows with length) or only a sliding window of W tokens (bounded memory).

| task      | what it tests                       | level                                   | ID     | OOD     |
| --------- | ----------------------------------- | --------------------------------------- | ------ | ------- |
| retain    | retention over distance             | statements after the key's last write   | 2-20   | 40-80   |
| overwrite | interference: keep only the latest  | earlier writes of the same key          | 1-3    | 5-8     |
| saturate  | capacity: many live facts           | distinct keys, each written once        | 4-12   | 18-26   |

Balanced against shortcuts: the queried key is uniform among the keys;
distractor statements use the other keys; for `overwrite` the old values
of the queried key are distinct from the latest one, so "any value of k"
is wrong on purpose; `retain` keeps 6 live keys at every level, so length
does not identify the key. benchmarks/audit.py audits this module too.
"""

from __future__ import annotations

import random
import string

from benchmarks.suite3 import DIGITS, LETTERS, PAD, TOKEN, VOCAB  # noqa: F401  (shared vocabulary)

LEVELS = {
    "retain": {"id": (2, 20), "ood": (40, 80)},
    "overwrite": {"id": (1, 3), "ood": (5, 8)},
    "saturate": {"id": (4, 12), "ood": (18, 26)},
}
TASKS = tuple(LEVELS)


def _stmt(k, v):
    return [k, "=", str(v), ";"]


def retain(r, gap):
    keys = r.sample(LETTERS, 6)
    q, others = keys[0], keys[1:]
    t = ["<bos>"]
    for k in others:  # every key is live from the start
        t += _stmt(k, r.randint(0, 9))
    for _ in range(r.randint(0, 3)):
        t += _stmt(q, r.randint(0, 9))
    value = r.randint(0, 9)
    t += _stmt(q, value)
    for _ in range(gap):
        t += _stmt(r.choice(others), r.randint(0, 9))
    return t + ["?", q], str(value)


def overwrite(r, n_old):
    keys = r.sample(LETTERS, 6)
    q, others = keys[0], keys[1:]
    values = r.sample(range(10), n_old + 1)  # old values differ from the latest
    t = ["<bos>"]
    for v in values:
        for _ in range(r.randint(1, 3)):
            t += _stmt(r.choice(others), r.randint(0, 9))
        t += _stmt(q, v)
    for _ in range(r.randint(1, 3)):
        t += _stmt(r.choice(others), r.randint(0, 9))
    return t + ["?", q], str(values[-1])


def saturate(r, n):
    keys = r.sample(LETTERS, n)
    vals = [r.randint(0, 9) for _ in keys]
    t = ["<bos>"]
    for k, v in zip(keys, vals):
        t += _stmt(k, v)
    i = r.randrange(n)
    return t + ["?", keys[i]], str(vals[i])


GEN = {"retain": retain, "overwrite": overwrite, "saturate": saturate}


def example(r: random.Random, task: str, split: str) -> tuple[list[int], int, str, int]:
    lo, hi = LEVELS[task]["ood" if split == "ood" else "id"]
    level = r.randint(lo, hi)
    tokens, answer = GEN[task](r, level)
    return [TOKEN[w] for w in tokens], TOKEN[answer], task, level


def batch(r: random.Random, size: int, split: str = "id", tasks: tuple[str, ...] = TASKS, max_level=None):
    return [example(r, tasks[i % len(tasks)], split) for i in range(size)]


def fixed_set(namespace: str, per_task: int, split: str, tasks: tuple[str, ...] = TASKS) -> list:
    r = random.Random(f"streams:{namespace}:{split}")
    return [example(r, t, "ood" if split == "ood" else "id") for t in tasks for _ in range(per_task)]


def solve(tokens: list[int], task: str) -> int:
    w = [VOCAB[t] for t in tokens]
    q = w.index("?")
    val = {}
    for i in range(1, q, 4):
        val[w[i]] = w[i + 2]
    return TOKEN[val[w[q + 1]]]


def guess_level(task: str, tokens: list[int]) -> float:
    """Uniform over the distinct values in the stream."""
    w = [VOCAB[t] for t in tokens]
    return 1 / len({x for x in w[1 : w.index("?")] if x in DIGITS})
