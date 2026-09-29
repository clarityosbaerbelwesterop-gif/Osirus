"""R1 micro-benchmark: algorithmic tasks generated and verified by code.

Every example is (token ids, answer id, task, difficulty). The answer is one
token, so both architectures are scored by exact match on the same output
space. Three tasks, each with an in-distribution (ID) range used for
training and a harder out-of-distribution (OOD) range used only for
evaluation:

- state  (multi-step state): a start digit and n operations "+c", "-c",
         "*c" applied mod 10; answer: the final state.
         ID n = 2..12, OOD n = 16..32.
- hops   (variable computation depth): shuffled bindings "x = y ;" where
         each variable holds a digit or another variable; answer: the digit
         reached from the queried variable after h hops.
         ID h = 1..4 (3..8 variables), OOD h = 6..8 (10..12 variables).
- recall (long dependency): n key-value pairs "k v", then a key; answer:
         its value. ID n = 2..10, OOD n = 14..20.

`state` and `hops` need sequential computation whose depth grows with the
difficulty; `recall` needs capacity to store many facts. The mix is chosen
so that each architecture has a task it should find natural.
"""

from __future__ import annotations

import random
import string

SPECIALS = ["<pad>", "<bos>", "?", "=", ";", "+", "-", "*"]
DIGITS = [str(d) for d in range(10)]
LETTERS = list(string.ascii_lowercase)
VOCAB = SPECIALS + DIGITS + LETTERS
TOKEN = {t: i for i, t in enumerate(VOCAB)}
PAD = TOKEN["<pad>"]

RANGES = {
    "state": {"id": (2, 12), "ood": (16, 32)},
    "hops": {"id": (1, 4), "ood": (6, 8)},
    "recall": {"id": (2, 10), "ood": (14, 20)},
}
TASKS = tuple(RANGES)


def encode(tokens: list[str]) -> list[int]:
    return [TOKEN[t] for t in tokens]


def state_task(r: random.Random, n: int) -> tuple[list[str], str]:
    x = r.randint(0, 9)
    tokens = ["<bos>", str(x)]
    for _ in range(n):
        op, c = r.choice("+-*"), r.randint(1, 9)
        x = (x + c) % 10 if op == "+" else (x - c) % 10 if op == "-" else (x * c) % 10
        tokens += [op, str(c)]
    return tokens + ["?"], str(x)


def hops_task(r: random.Random, hops: int, extra: int) -> tuple[list[str], str]:
    names = r.sample(LETTERS, hops + 1 + extra)
    chain, others = names[: hops + 1], names[hops + 1 :]
    value = str(r.randint(0, 9))
    bindings = [(chain[0], value)] + [(chain[i], chain[i - 1]) for i in range(1, hops + 1)]
    for i, name in enumerate(others):
        # Distractors: a digit, or a pointer to an earlier distractor.
        target = others[r.randrange(i)] if i and r.random() < 0.5 else str(r.randint(0, 9))
        bindings.append((name, target))
    r.shuffle(bindings)
    tokens = ["<bos>"]
    for name, target in bindings:
        tokens += [name, "=", target, ";"]
    return tokens + ["?", chain[-1]], value


def recall_task(r: random.Random, n: int) -> tuple[list[str], str]:
    keys = r.sample(LETTERS, n)
    values = [str(r.randint(0, 9)) for _ in keys]
    tokens = ["<bos>"]
    for k, v in zip(keys, values):
        tokens += [k, v]
    i = r.randrange(n)
    return tokens + ["?", keys[i]], values[i]


def example(r: random.Random, task: str, split: str) -> tuple[list[int], int, str, int]:
    lo, hi = RANGES[task][split]
    level = r.randint(lo, hi)
    if task == "state":
        tokens, answer = state_task(r, level)
    elif task == "hops":
        extra = r.randint(2, 4) if split == "id" else r.randint(3, 4)
        tokens, answer = hops_task(r, level, extra)
    else:
        tokens, answer = recall_task(r, level)
    return encode(tokens), TOKEN[answer], task, level


def batch(r: random.Random, size: int, split: str = "id", tasks: tuple[str, ...] = TASKS):
    return [example(r, tasks[i % len(tasks)], split) for i in range(size)]


def fixed_set(seed: str, per_task: int, split: str) -> list[tuple[list[int], int, str, int]]:
    """A frozen evaluation set (its own seed namespace, never used for training)."""
    r = random.Random(f"eval:{seed}:{split}")
    return [example(r, task, split) for task in TASKS for _ in range(per_task)]


def solve(tokens: list[int]) -> int:
    """Reference solver (checks the generators; never used by the models)."""
    words = [VOCAB[t] for t in tokens]
    body = words[1:words.index("?")]
    if all(w in DIGITS or w in "+-*" for w in body):
        x = int(body[0])
        for op, c in zip(body[1::2], body[2::2]):
            c = int(c)
            x = (x + c) % 10 if op == "+" else (x - c) % 10 if op == "-" else (x * c) % 10
        return TOKEN[str(x)]
    query = words[-1]
    if "=" in body:
        table = {body[i]: body[i + 2] for i in range(0, len(body), 4)}
        while query in table:
            query = table[query]
        return TOKEN[query]
    pairs = dict(zip(body[0::2], body[1::2]))
    return TOKEN[pairs[query]]
