"""Depth-controlled benchmark v2 for R1.02b (learned halting).

v1 (depthbench.py) was void: its distractor chains were shorter than the
queried chain at large depths, so "the terminal of the longest chain" was
correct on 100% of OOD examples and 92% at depth 8 (0% at depth 1). Deep
examples could be solved without following the chain.

v2 removes every length cue. Every example has exactly TWO chains of 17
nodes each (34 distinct symbols from a-z, 0-9), each ending in a terminal
bound to itself, written as shuffled bindings "x y ;", then "? s". The query
s sits at exactly `depth` hops from the terminal of its chain; the answer
is that terminal. Both chains always have the same length and shape, so
the only way to tell which terminal belongs to s is to follow the pointers
(or to compute connectivity, e.g. by pointer doubling). Guessing a
terminal gives 50% at every depth.

    ID  (training and in-distribution test): depth 1..8
    OOD (test only):                        depth 12 and 16

Every example is 1 + 3*34 + 2 = 105 tokens, so compute can only track
depth. Extra hops past the terminal stay there.
"""

from __future__ import annotations

import random
import string

SPECIALS = ["<pad>", "<bos>", "?", ";"]
SYMBOLS = list(string.ascii_lowercase) + list(string.digits)
VOCAB = SPECIALS + SYMBOLS
ID = {tok: i for i, tok in enumerate(VOCAB)}
PAD, BOS = ID["<pad>"], ID["<bos>"]
CHAIN = 17
NODES = 2 * CHAIN
DEPTHS = {"id": list(range(1, 9)), "ood": [12, 16]}
EVAL_DEPTHS = {"id": [1, 2, 4, 8], "ood": [12, 16]}


def example(r: random.Random, depth: int) -> tuple[list[int], int, int, int]:
    """(token ids, answer id, depth, number of terminals = 2)."""
    nodes = r.sample(SYMBOLS, NODES)
    chains = [nodes[:CHAIN], nodes[CHAIN:]]
    edges = [(a, b) for chain in chains for a, b in zip(chain, chain[1:])] + [(c[-1], c[-1]) for c in chains]
    r.shuffle(edges)
    chain = chains[r.randrange(2)]
    query = chain[CHAIN - 1 - depth]
    tokens = ["<bos>"] + [t for a, b in edges for t in (a, b, ";")] + ["?", query]
    return [ID[t] for t in tokens], ID[chain[-1]], depth, 2


def batch(r: random.Random, size: int, split: str = "id") -> list:
    return [example(r, r.choice(DEPTHS[split])) for _ in range(size)]


def fixed_set(seed: str, per_depth: int, split: str) -> list:
    """Frozen evaluation set: the same examples for every model and seed."""
    r = random.Random(f"depth2-eval:{seed}:{split}")
    return [example(r, d) for d in EVAL_DEPTHS[split] for _ in range(per_depth)]


def solve(tokens: list[int]) -> int:
    """Reference solver: follow the pointers from the query to the terminal."""
    words = [VOCAB[t] for t in tokens]
    nxt = {words[i]: words[i + 1] for i in range(1, len(words) - 2, 3)}
    node = words[-1]
    while nxt[node] != node:
        node = nxt[node]
    return ID[node]


def shortcuts(tokens: list[int]) -> dict[str, int]:
    """Answers of cheap heuristics that do NOT follow the chain from the
    query. A valid benchmark keeps each at the 50% guess level at every
    depth (tests/test_r102.py audits this)."""
    words = [VOCAB[t] for t in tokens]
    pairs = [(words[i], words[i + 1]) for i in range(1, len(words) - 2, 3)]
    nxt = dict(pairs)
    terminals = [a for a, b in pairs if a == b]

    def length(t):  # nodes that reach terminal t
        n = 0
        for a in nxt:
            x = a
            while nxt[x] != x:
                x = nxt[x]
            n += x == t
        return n

    q = words[-1]
    qpos = next(i for i, (a, _) in enumerate(pairs) if a == q)
    tpos = {t: next(i for i, (a, _) in enumerate(pairs) if a == t) for t in terminals}
    return {
        "longest_chain": ID[max(terminals, key=length)],
        "first_terminal": ID[terminals[0]],
        "nearest_terminal_in_text": ID[min(terminals, key=lambda t: abs(tpos[t] - qpos))],
        "query_target_is_terminal_else_first": ID[nxt[q] if nxt[nxt[q]] == nxt[q] else terminals[0]],
    }
