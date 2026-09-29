"""Program-execution benchmark for R1.33/R1.34 (latent programs, differentiable execution).

Each example is a small program whose execution has n steps, with the
state after every step known (the "hints"):

| task  | program                                         | step                | ID  | OOD   |
| ----- | ----------------------------------------------- | ------------------- | --- | ----- |
| trace | x = a ; y = b ; # n ( body ) ? v                | one loop iteration  | 1-4 | 6-9   |
| chain | x0 op c op c ... ?  (mod 10)                    | one operation       | 2-8 | 12-16 |

The answer is the value after all n steps; hints(tokens, task) returns the
queried value after each step 1..n. Models may read `level` = n as the
number of steps to execute ("oracle depth": the program length is given;
learning to halt is R1.02's question, not this one).
"""

from __future__ import annotations

import random

from benchmarks.suite3 import DIGITS, PAD, TOKEN, VOCAB, _op  # noqa: F401

LEVELS = {"trace": {"id": (1, 4), "ood": (6, 9)}, "chain": {"id": (2, 8), "ood": (12, 16)}}
TASKS = tuple(LEVELS)


def trace(r, n):
    x, y = r.randint(0, 9), r.randint(0, 9)
    body = [(r.choice("xy"), r.choice("+-*"), r.randint(1, 9)) for _ in range(r.randint(1, 2))]
    q = r.choice(sorted({tgt for tgt, _, _ in body}))
    t = ["<bos>", "x", "=", str(x), ";", "y", "=", str(y), ";", "#", str(n), "("]
    for tgt, op, c in body:
        t += [tgt, op, str(c), ";"]
    env = {"x": x, "y": y}
    for _ in range(n):
        for tgt, op, c in body:
            env[tgt] = _op(env[tgt], op, c)
    return t + [")", "?", q], str(env[q])


def chain(r, n):
    x = r.randint(0, 9)
    t = ["<bos>", str(x)]
    for _ in range(n):
        op, c = r.choice("+-*"), r.randint(1, 9)
        x = _op(x, op, c)
        t += [op, str(c)]
    return t + ["?"], str(x)


GEN = {"trace": trace, "chain": chain}


def example(r: random.Random, task: str, split: str):
    lo, hi = LEVELS[task]["ood" if split == "ood" else "id"]
    level = r.randint(lo, hi)
    tokens, answer = GEN[task](r, level)
    return [TOKEN[w] for w in tokens], TOKEN[answer], task, level


def batch(r, size, split="id", tasks=TASKS, max_level=None):
    return [example(r, tasks[i % len(tasks)], split) for i in range(size)]


def fixed_set(namespace, per_task, split, tasks=TASKS):
    r = random.Random(f"programs:{namespace}:{split}")
    return [example(r, t, "ood" if split == "ood" else "id") for t in tasks for _ in range(per_task)]


def hints(tokens: list[int], task: str) -> list[int]:
    """The queried value after each execution step (token ids), from the tokens alone."""
    w = [VOCAB[t] for t in tokens]
    q = w.index("?")
    out = []
    if task == "trace":
        env = {"x": int(w[3]), "y": int(w[7])}
        body = [(w[i], w[i + 1], int(w[i + 2])) for i in range(12, w.index(")"), 4)]
        for _ in range(int(w[10])):
            for tgt, op, c in body:
                env[tgt] = _op(env[tgt], op, c)
            out.append(TOKEN[str(env[w[q + 1]])])
        return out
    x = int(w[1])
    for op, c in zip(w[2:q:2], w[3:q:2]):
        x = _op(x, op, int(c))
        out.append(TOKEN[str(x)])
    return out


def solve(tokens, task):
    return hints(tokens, task)[-1]


def guess_level(task, tokens):
    return 0.1
