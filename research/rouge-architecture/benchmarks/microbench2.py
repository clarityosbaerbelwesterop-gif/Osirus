"""Rouge micro-benchmark v2 (R1.03 onwards).

Identical to microbench.py (R1.01, R1.01b) except the hops task: v1 let
"the digit at the end of the longest chain" answer 91% of ID and 100% of
OOD hops examples without following the query. v2 uses two equal chains.
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


def hops_task(r: random.Random, hops: int, extra: int = 0) -> tuple[list[str], str]:
    """v2: TWO chains of exactly `hops` pointers, each ending in a different
    digit; the query is the head of one of them. Chain length and shape no
    longer identify the answer (v1: 'digit at the end of the longest chain'
    was right on 91% ID / 100% OOD). Guessing between the two digits: 50%."""
    names = r.sample(LETTERS, 2 * (hops + 1))
    chains = [names[: hops + 1], names[hops + 1 :]]
    values = [str(v) for v in r.sample(range(10), 2)]
    bindings = []
    for chain, value in zip(chains, values):
        bindings += [(chain[0], value)] + [(chain[i], chain[i - 1]) for i in range(1, hops + 1)]
    r.shuffle(bindings)
    tokens = ["<bos>"]
    for name, target in bindings:
        tokens += [name, "=", target, ";"]
    pick = r.randrange(2)
    return tokens + ["?", chains[pick][-1]], values[pick]


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
        tokens, answer = hops_task(r, level)
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


def shortcuts(tokens: list[int], task: str) -> dict[str, int]:
    """Answers of cheap cues that do not solve the task. A valid benchmark
    keeps each near its guess level (tests/test_r103.py audits this)."""
    words = [VOCAB[t] for t in tokens]
    body = words[1 : words.index("?")]
    if task == "hops":
        table = {body[i]: body[i + 2] for i in range(0, len(body), 4)}
        rev = {v: k for k, v in table.items() if v in table}

        def depth(k):
            n = 0
            while k in rev:
                k, n = rev[k], n + 1
            return n
        digit_letters = [k for k, v in table.items() if v in DIGITS]
        return {"longest_chain_digit": TOKEN[table[max(digit_letters, key=depth)]],
                "first_digit_binding": TOKEN[table[digit_letters[0]]]}
    if task == "state":
        return {"last_constant": TOKEN[body[-1]], "first_value": TOKEN[body[0]]}
    pairs = list(zip(body[0::2], body[1::2]))
    values = [v for _, v in pairs]
    return {"last_value": TOKEN[values[-1]], "most_common_value": TOKEN[max(sorted(set(values)), key=values.count)]}
