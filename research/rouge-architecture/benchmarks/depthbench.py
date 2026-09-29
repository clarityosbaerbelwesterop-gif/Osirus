"""Depth-controlled benchmark for R1.02 (learned halting).

Every example is a functional graph over N = 18 distinct letters, written as
shuffled bindings "x y ;" (x points to y), followed by "? s". Following the
pointers from s ends in a terminal t (a letter bound to itself, "t t ;").
The answer is t. The required depth is the number of hops from s to t;
it is set exactly per example:

    ID  (training and in-distribution test): depth 1..8
    OOD (test only):                        depth 12 and 16

Distractors are other chains with their own terminals (lengths drawn from
the same range), so "the terminal" is not identifiable without following
the chain. Every example has the same length (1 + 3N + 2 = 57 tokens), so
compute can only track depth, not input length. Extra hops past t stay at
t, so thinking longer never changes a correct answer.
"""

from __future__ import annotations

import random
import string

SPECIALS = ["<pad>", "<bos>", "?", ";"]
LETTERS = list(string.ascii_lowercase)
VOCAB = SPECIALS + LETTERS
ID = {tok: i for i, tok in enumerate(VOCAB)}
PAD, BOS = ID["<pad>"], ID["<bos>"]
NODES = 18
DEPTHS = {"id": list(range(1, 9)), "ood": [12, 16]}
EVAL_DEPTHS = {"id": [1, 2, 4, 8], "ood": [12, 16]}


def example(r: random.Random, depth: int) -> tuple[list[int], int, int, int]:
    """(token ids, answer id, depth, number of terminals)."""
    letters = r.sample(LETTERS, NODES)
    chain, rest = letters[: depth + 1], letters[depth + 1 :]
    edges = [(a, b) for a, b in zip(chain, chain[1:])] + [(chain[-1], chain[-1])]
    terminals = 1
    while rest:  # distractor chains, 1..8 hops (as many as the letters allow)
        k = min(r.randint(1, 8), len(rest) - 1)
        part, rest = rest[: k + 1], rest[k + 1 :]
        edges += [(a, b) for a, b in zip(part, part[1:])] + [(part[-1], part[-1])]
        terminals += 1
    r.shuffle(edges)
    tokens = ["<bos>"] + [t for a, b in edges for t in (a, b, ";")] + ["?", chain[0]]
    return [ID[t] for t in tokens], ID[chain[-1]], depth, terminals


def batch(r: random.Random, size: int, split: str = "id") -> list:
    return [example(r, r.choice(DEPTHS[split])) for _ in range(size)]


def fixed_set(seed: str, per_depth: int, split: str) -> list:
    """Frozen evaluation set: the same examples for every model and seed."""
    r = random.Random(f"depth-eval:{seed}:{split}")
    return [example(r, d) for d in EVAL_DEPTHS[split] for _ in range(per_depth)]


def solve(tokens: list[int]) -> int:
    """Reference solver: follow the pointers from the query to the terminal."""
    words = [VOCAB[t] for t in tokens]
    nxt = {words[i]: words[i + 1] for i in range(1, len(words) - 2, 3)}
    node = words[-1]
    while nxt[node] != node:
        node = nxt[node]
    return ID[node]
