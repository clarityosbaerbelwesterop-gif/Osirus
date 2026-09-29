"""Rouge benchmark v3 (R1.06): eleven code-generated, code-verified tasks
that test one capability each, with ID and OOD difficulty levels.

| task    | capability               | level (difficulty)           | ID      | OOD     | guess |
| ------- | ------------------------ | ---------------------------- | ------- | ------- | ----- |
| state   | state tracking           | operations on a mod-10 value | 2-12    | 16-32   | 10%   |
| recall  | exact recall             | stored key/value facts       | 2-10    | 14-20   | ~value floor |
| hops    | multi-hop reasoning      | pointer hops (2 equal chains)| 1-4     | 6-8     | 50%   |
| perm    | permutation composition  | permutations of 5 symbols    | 1-4     | 6-10    | 20%   |
| conn    | graph traversal          | path distance (2 equal paths)| 1-4     | 6-9     | 50%   |
| arith   | arithmetic with carries  | 2-digit addends (tens digit) | 2-4     | 6-8     | 10%   |
| binding | variable binding in time | assignment statements        | 3-8     | 12-20   | ~value floor |
| stack   | algorithm execution      | push / pop operations        | 4-10    | 16-24   | 1/live |
| trace   | code tracing (loops)     | loop iterations              | 1-4     | 6-9     | 10%   |
| cf      | counterfactual state     | operations, one replaced     | 2-6     | 8-9     | 10%   |
| plan    | planning depth           | tree distance (first step)   | 2-3     | 5-7     | 1/deg |

Every example is (token ids, answer id, task, level). Splits:
- train: an open stream (seeded by the run);
- dev: a frozen ID set for development;
- holdout: a frozen ID set whose seed namespace is the experiment id, so
  every experiment gets fresh hidden examples (rotating hidden test);
- ood: frozen, harder levels;
- adv: adversarial, i.e. ID examples on which the audit's cue model
  (benchmarks/audit.py) is wrong.

Design against shortcuts (lessons of R1.02 and microbench v1):
- structures that could reveal the answer by size or shape are balanced
  (two equal chains or paths; the query picks one at random);
- answers never depend on position alone;
- benchmarks/audit.py measures cue baselines per task and split, and the
  tests fail if a cue beats guessing by more than the documented margin.
"""

from __future__ import annotations

import random
import string

SPECIALS = ["<pad>", "<bos>", "?", "=", ";", "+", "-", "*", "!", "#", "(", ")"]
DIGITS = [str(d) for d in range(10)]
LETTERS = list(string.ascii_lowercase)
VOCAB = SPECIALS + DIGITS + LETTERS
TOKEN = {t: i for i, t in enumerate(VOCAB)}
PAD = TOKEN["<pad>"]

LEVELS = {
    "state": {"id": (2, 12), "ood": (16, 32)},
    "recall": {"id": (2, 10), "ood": (14, 20)},
    "hops": {"id": (1, 4), "ood": (6, 8)},
    "perm": {"id": (1, 4), "ood": (6, 10)},
    "conn": {"id": (1, 4), "ood": (6, 9)},
    "arith": {"id": (2, 4), "ood": (6, 8)},
    "binding": {"id": (3, 8), "ood": (12, 20)},
    "stack": {"id": (4, 10), "ood": (16, 24)},
    "trace": {"id": (1, 4), "ood": (6, 9)},
    "cf": {"id": (2, 6), "ood": (8, 9)},
    "plan": {"id": (2, 3), "ood": (5, 7)},
}
TASKS = tuple(LEVELS)


def _op(x: int, op: str, c: int) -> int:
    return (x + c) % 10 if op == "+" else (x - c) % 10 if op == "-" else (x * c) % 10


def state(r, n):
    x = r.randint(0, 9)
    t = ["<bos>", str(x)]
    for _ in range(n):
        op, c = r.choice("+-*"), r.randint(1, 9)
        x = _op(x, op, c)
        t += [op, str(c)]
    return t + ["?"], str(x)


def recall(r, n):
    keys = r.sample(LETTERS, n)
    vals = [str(r.randint(0, 9)) for _ in keys]
    t = ["<bos>"] + [w for kv in zip(keys, vals) for w in kv]
    i = r.randrange(n)
    return t + ["?", keys[i]], vals[i]


def hops(r, n):
    names = r.sample(LETTERS, 2 * (n + 1))
    chains = [names[: n + 1], names[n + 1 :]]
    vals = [str(v) for v in r.sample(range(10), 2)]
    b = []
    for ch, v in zip(chains, vals):
        b += [(ch[0], v)] + [(ch[i], ch[i - 1]) for i in range(1, n + 1)]
    r.shuffle(b)
    pick = r.randrange(2)
    return ["<bos>"] + [w for k, v in b for w in (k, "=", v, ";")] + ["?", chains[pick][-1]], vals[pick]


def perm(r, n):
    sym = list("abcde")
    t, mapping = ["<bos>"], {s: s for s in sym}
    for _ in range(n):
        p = sym[:]
        r.shuffle(p)
        step = dict(zip(sym, p))
        mapping = {s: step[mapping[s]] for s in sym}  # apply the new permutation after the previous ones
        t += p + [";"]
    x = r.choice(sym)
    return t + ["?", x], mapping[x]


def conn(r, n):
    """Two undirected paths of 10 nodes; is t on the same path as s?"""
    nodes = r.sample(LETTERS, 20)
    paths = [nodes[:10], nodes[10:]]
    edges = [(p[i], p[i + 1]) if r.random() < 0.5 else (p[i + 1], p[i]) for p in paths for i in range(9)]
    r.shuffle(edges)
    pi, pos = r.randrange(2), r.randrange(10 - n)
    if r.random() < 0.5:
        s, t = (r.sample([pos, pos + n], 2))
        s, t, ans = paths[pi][s], paths[pi][t], "1"
    else:  # the same distance, measured into the other path, so position says nothing
        s, t = (r.sample([pos, pos + n], 2))
        s, t, ans = paths[pi][s], paths[1 - pi][t], "0"
    return ["<bos>"] + [w for a, b in edges for w in (a, b, ";")] + ["?", s, t], ans


def arith(r, n):
    nums = [r.randint(10, 99) for _ in range(n)]
    t = ["<bos>"]
    for i, v in enumerate(nums):
        t += ([] if i == 0 else ["+"]) + list(str(v))
    return t + ["?"], str(sum(nums) // 10 % 10)


def binding(r, n):
    """Every variable is assigned first (random order), then n statements
    that assign a digit or copy another variable's current value; the query
    is uniform over all four variables, so recency is not a cue."""
    vars_ = list("abcd")
    val: dict[str, int] = {}
    t = ["<bos>"]
    order = vars_[:]
    r.shuffle(order)
    for v in order:
        val[v] = r.randint(0, 9)
        t += [v, "=", str(val[v]), ";"]
    for _ in range(n):
        v = r.choice(vars_)
        if r.random() < 0.4:
            w = r.choice([x for x in vars_ if x != v])
            val[v] = val[w]  # copy the current value (assignment time)
            t += [v, "=", w, ";"]
        else:
            val[v] = r.randint(0, 9)
            t += [v, "=", str(val[v]), ";"]
    q = r.choice(vars_)
    return t + ["?", q], str(val[q])


def stack(r, n):
    """A stack machine: letters are pushed, '-' pops; the answer is the top
    of the stack at the end. n operations, never popping an empty stack and
    ending with at least one element. Order-dependent (a bag of tokens
    cannot know which letters were popped)."""
    letters = r.sample(LETTERS, 26)
    st, t, used = [], ["<bos>"], 0
    for i in range(n):
        if len(st) > 1 and r.random() < 0.4:
            st.pop()
            t.append("-")
        else:
            st.append(letters[used])
            t.append(letters[used])
            used += 1
    # End with 1-3 pops after a few pushes, so the answer never sits at a
    # fixed distance from the end (a position cue measured at 62% otherwise).
    for _ in range(r.randint(1, 3)):
        st.append(letters[used])
        t.append(letters[used])
        used += 1
    for _ in range(r.randint(1, 3)):
        if len(st) > 1:
            st.pop()
            t.append("-")
    return t + ["?"], st[-1]


def trace(r, n):
    """x = a ; y = b ; # n ( body ) ? v, with a 1-2 statement body mod 10."""
    x, y = r.randint(0, 9), r.randint(0, 9)
    body = []
    for _ in range(r.randint(1, 2)):
        tgt, op, c = r.choice("xy"), r.choice("+-*"), r.randint(1, 9)
        body.append((tgt, op, c))
    env = {"x": x, "y": y}
    for _ in range(n):
        for tgt, op, c in body:
            env[tgt] = _op(env[tgt], op, c)
    q = r.choice(sorted({tgt for tgt, _, _ in body}))  # queried variable is always changed by the loop
    t = ["<bos>", "x", "=", str(x), ";", "y", "=", str(y), ";", "#", str(n), "("]
    for tgt, op, c in body:
        t += [tgt, op, str(c), ";"]
    return t + [")", "?", q], str(env[q])


def cf(r, n):
    x0 = r.randint(0, 9)
    ops = [(r.choice("+-*"), r.randint(1, 9)) for _ in range(n)]
    i, c = r.randint(1, n), r.randint(1, 9)
    changed = ops[:]
    changed[i - 1] = (ops[i - 1][0], c)
    x = x0
    for op, k in changed:
        x = _op(x, op, k)
    t = ["<bos>", str(x0)] + [w for op, k in ops for w in (op, str(k))]
    return t + ["!", str(i), str(c), "?"], str(x)


def plan(r, n):
    """A random tree on 14 letters; the first step from s towards t."""
    while True:
        nodes = r.sample(LETTERS, 14)
        parent = {nodes[i]: nodes[r.randrange(i)] for i in range(1, 14)}
        adj = {v: set() for v in nodes}
        for a, b in parent.items():
            adj[a].add(b)
            adj[b].add(a)
        branching = [v for v in nodes if len(adj[v]) >= 3]
        if not branching:
            continue
        s = r.choice(branching)
        prev, frontier, dist = {s: None}, [s], {s: 0}
        while frontier:
            nxt = []
            for u in frontier:
                for w in adj[u]:
                    if w not in dist:
                        dist[w], prev[w] = dist[u] + 1, u
                        nxt.append(w)
            frontier = nxt
        targets = [v for v in nodes if dist[v] == n]
        if targets:
            break
    t_ = r.choice(targets)
    step = t_
    while prev[step] != s:
        step = prev[step]
    edges = [(a, b) if r.random() < 0.5 else (b, a) for a, b in parent.items()]
    r.shuffle(edges)
    return ["<bos>"] + [w for a, b in edges for w in (a, b, ";")] + ["?", s, t_], step


GEN = {"state": state, "recall": recall, "hops": hops, "perm": perm, "conn": conn, "arith": arith,
       "binding": binding, "stack": stack, "trace": trace, "cf": cf, "plan": plan}


def example(r: random.Random, task: str, split: str) -> tuple[list[int], int, str, int]:
    lo, hi = LEVELS[task]["ood" if split == "ood" else "id"]
    level = r.randint(lo, hi)
    tokens, answer = GEN[task](r, level)
    return [TOKEN[w] for w in tokens], TOKEN[answer], task, level


def batch(r: random.Random, size: int, split: str = "id", tasks: tuple[str, ...] = TASKS, max_level=None):
    return [example(r, tasks[i % len(tasks)], split) for i in range(size)]


def fixed_set(namespace: str, per_task: int, split: str, tasks: tuple[str, ...] = TASKS) -> list:
    """Frozen evaluation set. `namespace` separates dev, holdout (experiment id) and ood."""
    r = random.Random(f"suite3:{namespace}:{split}")
    return [example(r, t, "ood" if split == "ood" else "id") for t in tasks for _ in range(per_task)]


# ---- reference solver (used by the tests; never by a model) ----

def solve(tokens: list[int], task: str) -> int:
    w = [VOCAB[t] for t in tokens]
    q = w.index("?")
    if task == "state":
        x = int(w[1])
        for op, c in zip(w[2:q:2], w[3:q:2]):
            x = _op(x, op, int(c))
        return TOKEN[str(x)]
    if task == "recall":
        return TOKEN[dict(zip(w[1:q:2], w[2:q:2]))[w[q + 1]]]
    if task == "hops":
        table = {w[i]: w[i + 2] for i in range(1, q, 4)}
        x = w[q + 1]
        while x in table:
            x = table[x]
        return TOKEN[x]
    if task == "perm":
        perms = [w[i:i + 5] for i in range(1, q, 6)]
        x = w[q + 1]
        for p in perms:
            x = p["abcde".index(x)]
        return TOKEN[x]
    if task in ("conn", "plan"):
        adj: dict[str, set] = {}
        for i in range(1, q, 3):
            a, b = w[i], w[i + 1]
            adj.setdefault(a, set()).add(b)
            adj.setdefault(b, set()).add(a)
        s, t = w[q + 1], w[q + 2]
        prev, frontier = {s: None}, [s]
        while frontier:
            nxt = []
            for u in frontier:
                for v in adj[u]:
                    if v not in prev:
                        prev[v] = u
                        nxt.append(v)
            frontier = nxt
        if task == "conn":
            return TOKEN["1" if t in prev else "0"]
        while prev[t] != s:
            t = prev[t]
        return TOKEN[t]
    if task == "arith":
        return TOKEN[str(sum(int(x) for x in "".join(w[1:q]).split("+")) // 10 % 10)]
    if task == "binding":
        val = {}
        for i in range(1, q, 4):
            v, rhs = w[i], w[i + 2]
            val[v] = val[rhs] if rhs in val else int(rhs)
        return TOKEN[str(val[w[q + 1]])]
    if task == "stack":
        st = []
        for x in w[1:q]:
            st.pop() if x == "-" else st.append(x)
        return TOKEN[st[-1]]
    if task == "trace":
        env = {"x": int(w[3]), "y": int(w[7])}
        n = int(w[10])
        body = [(w[i], w[i + 1], int(w[i + 2])) for i in range(12, w.index(")"), 4)]
        for _ in range(n):
            for tgt, op, c in body:
                env[tgt] = _op(env[tgt], op, c)
        return TOKEN[str(env[w[q + 1]])]
    if task == "cf":
        bang = w.index("!")
        ops = list(zip(w[2:bang:2], (int(c) for c in w[3:bang:2])))
        i, c = int(w[bang + 1]), int(w[bang + 2])
        ops[i - 1] = (ops[i - 1][0], c)
        x = int(w[1])
        for op, k in ops:
            x = _op(x, op, k)
        return TOKEN[str(x)]
    raise KeyError(task)


def guess_level(task: str, tokens: list[int]) -> float:
    """Chance accuracy of guessing uniformly among the plausible answers
    (for recall and binding: the distinct digits in the context; for stack:
    the letters in the context)."""
    w = [VOCAB[t] for t in tokens]
    q = w.index("?")
    if task in ("hops", "conn"):
        return 0.5
    if task == "perm":
        return 0.2
    if task in ("recall", "binding"):
        return 1 / len({x for x in w[1:q] if x in DIGITS})
    if task == "stack":
        return 1 / len({x for x in w[1:q] if x in LETTERS})
    if task == "plan":
        s = w[q + 1]
        deg = sum(1 for i in range(1, q, 3) if s in (w[i], w[i + 1]))
        return 1 / deg
    return 0.1
