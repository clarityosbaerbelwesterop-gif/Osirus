"""Generated training and evaluation data with verified answers (seeded).

Math: multi-digit addition/subtraction/multiplication, linear equations,
remainders, fractions reduced, unit conversions; the answer is computed
by Python, never by a model.

Algorithmic: sorting, reversal, counting, list max/min, stack-machine
traces, variable-binding programs, key-value lookup at distance (a long-
dependency probe inside the training distribution).

Each item is (prompt, answer). Training documents concatenate
"prompt answer" lines; evaluation uses held-out seeds and scores exact match
of the greedy continuation.
"""

from __future__ import annotations

import random
from fractions import Fraction

LETTERS = "abcdefghijklmnopqrstuvwxyz"


def math_item(r: random.Random) -> tuple[str, str]:
    kind = r.randrange(7)
    if kind == 0:
        a, b = r.randrange(10, 10**r.randint(2, 6)), r.randrange(10, 10**r.randint(2, 6))
        return f"Q: {a} + {b} =", str(a + b)
    if kind == 1:
        a, b = r.randrange(10, 10**r.randint(2, 6)), r.randrange(10, 10**r.randint(2, 6))
        return f"Q: {a} - {b} =", str(a - b)
    if kind == 2:
        a, b = r.randrange(2, 10**r.randint(1, 3)), r.randrange(2, 10**r.randint(1, 3))
        return f"Q: {a} * {b} =", str(a * b)
    if kind == 3:
        x, a = r.randrange(-50, 50), r.randrange(2, 12)
        b = r.randrange(-100, 100)
        return f"Q: Solve {a}x + {b} = {a * x + b}. x =", str(x)
    if kind == 4:
        a, m = r.randrange(10, 10**5), r.randrange(2, 97)
        return f"Q: {a} mod {m} =", str(a % m)
    if kind == 5:
        p, q = r.randrange(1, 60), r.randrange(2, 60)
        f = Fraction(p, q)
        return f"Q: Reduce {p}/{q} =", f"{f.numerator}/{f.denominator}"
    km = r.randrange(1, 500)
    return f"Q: {km} km in meters =", str(km * 1000)


def algo_item(r: random.Random) -> tuple[str, str]:
    kind = r.randrange(7)
    xs = [r.randrange(0, 100) for _ in range(r.randint(3, 9))]
    if kind == 0:
        return f"sort {' '.join(map(str, xs))} ->", " ".join(map(str, sorted(xs)))
    if kind == 1:
        return f"reverse {' '.join(map(str, xs))} ->", " ".join(map(str, xs[::-1]))
    if kind == 2:
        t = r.choice(xs)
        return f"count {t} in {' '.join(map(str, xs))} ->", str(xs.count(t))
    if kind == 3:
        return f"max {' '.join(map(str, xs))} ->", str(max(xs))
    if kind == 4:  # stack machine
        stack, ops = [], []
        for _ in range(r.randint(3, 10)):
            if stack and r.random() < 0.4:
                ops.append("pop")
                stack.pop()
            else:
                v = r.randrange(10)
                ops.append(f"push {v}")
                stack.append(v)
        return f"stack {'; '.join(ops)} ; top ->", str(stack[-1]) if stack else "empty"
    if kind == 5:  # variable binding
        env, lines = {}, []
        for _ in range(r.randint(2, 6)):
            v = r.choice(LETTERS[:5])
            if env and r.random() < 0.5:
                src = r.choice(sorted(env))
                env[v] = env[src]
                lines.append(f"{v}={src}")
            else:
                env[v] = r.randrange(100)
                lines.append(f"{v}={env[v]}")
        q = r.choice(sorted(env))
        return f"prog {'; '.join(lines)} ; print {q} ->", str(env[q])
    # key-value lookup at distance: the key appears once, far before the question
    keys = r.sample([a + b for a in LETTERS for b in LETTERS], r.randint(8, 40))
    table = {k: r.randrange(1000) for k in keys}
    q = r.choice(keys)
    return f"kv {' '.join(f'{k}:{v}' for k, v in table.items())} ; get {q} ->", str(table[q])


def document(r: random.Random, kind: str, n_items: int = 32) -> str:
    make = math_item if kind == "math_synth" else algo_item
    return "\n".join(" ".join(make(r)) for _ in range(n_items))


def eval_items(kind: str, n: int, seed: int = 10_000) -> list[tuple[str, str]]:
    """Held-out items (seed range disjoint from training: training seeds are < 10_000)."""
    r = random.Random(f"{kind}:eval:{seed}")
    make = math_item if kind == "math_synth" else algo_item
    return [make(r) for _ in range(n)]
