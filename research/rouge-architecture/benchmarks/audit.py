"""Automatic shortcut audit for a benchmark (R1.06).

For every task and split it measures how well cheap cues predict the
answer, without solving the task:
- majority: always answer the most frequent training answer;
- position: answer with the token at a fixed position (from the start
  or from the end), for the best such position on the training data;
- bag-of-tokens: multinomial naive Bayes on token counts plus a length
  bucket (token frequencies, length and answer priors together).

The cue floor of a task is the best of these. A task is flagged when its
cue floor beats the chance level by more than the margin. Flags are
design bugs to fix, or (when the cue is part of the computation, e.g.
a partial sum) floors to report next to model accuracy.
The adversarial split keeps only examples on which the bag-of-tokens cue
model is wrong.

    python benchmarks/audit.py            # prints the audit of suite3
"""

from __future__ import annotations

import json
import math
import random
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import importlib  # noqa: E402

from benchmarks import suite3 as bench  # noqa: E402

MARGIN = 0.15
# Floors that are part of the task's semantics, reported next to accuracy
# instead of being designed away. Any other flag fails the tests.
KNOWN_FLOORS = {
    "stack": "the top of the stack is always a recent push; a recency heuristic is partial stack execution (floor ~0.3)",
}


class NaiveBayes:
    def __init__(self, examples):
        self.prior, self.counts, self.total = Counter(), {}, Counter()
        for tokens, answer, *_ in examples:
            self.prior[answer] += 1
            c = self.counts.setdefault(answer, Counter())
            for f in self.features(tokens):
                c[f] += 1
                self.total[answer] += 1
        self.vocab = len({f for c in self.counts.values() for f in c}) + 1
        self.n = sum(self.prior.values())

    @staticmethod
    def features(tokens):
        return list(tokens) + [f"len{len(tokens) // 4}"]

    def predict(self, tokens):
        feats = self.features(tokens)

        def score(a):
            c, tot = self.counts[a], self.total[a] + self.vocab
            return math.log(self.prior[a] / self.n) + sum(math.log((c[f] + 1) / tot) for f in feats)
        return max(self.prior, key=score)


def position_cue(train):
    best, best_acc = None, -1.0
    for p in list(range(0, 8)) + [-k for k in range(1, 8)]:
        acc = sum(1 for t, a, *_ in train if len(t) > abs(p) and t[p] == a) / len(train)
        if acc > best_acc:
            best, best_acc = p, acc
    return best, best_acc


def use(module: str) -> None:
    """Audit another benchmark module with the same interface (e.g. benchmarks.streams)."""
    global bench
    bench = importlib.import_module(module)


def audit_task(task: str, n_train: int = 3000, n_eval: int = 500, seed: str = "audit") -> dict:
    r = random.Random(f"{seed}:{task}")
    train = [bench.example(r, task, "id") for _ in range(n_train)]
    evals = {"dev": bench.fixed_set("dev", n_eval, "dev", (task,)),
             "ood": bench.fixed_set("ood", n_eval, "ood", (task,))}
    majority = Counter(a for _, a, *_ in train).most_common(1)[0][0]
    pos, _ = position_cue(train)
    nb = NaiveBayes(train)
    out = {}
    for split, xs in evals.items():
        guess = sum(bench.guess_level(task, t) for t, *_ in xs) / len(xs)
        cues = {
            "majority": sum(a == majority for _, a, *_ in xs) / len(xs),
            "position": sum(len(t) > abs(pos) and t[pos] == a for t, a, *_ in xs) / len(xs),
            "bag_of_tokens": sum(nb.predict(t) == a for t, a, *_ in xs) / len(xs),
        }
        floor = max(cues.values())
        out[split] = {"guess": round(guess, 3), **{k: round(v, 3) for k, v in cues.items()},
                      "cue_floor": round(floor, 3), "flag": floor > guess + MARGIN}
    return out


def adversarial(task: str, n: int, namespace: str, seed: str = "audit") -> list:
    """ID examples on which the bag-of-tokens cue model is wrong."""
    r = random.Random(f"{seed}:{task}")
    nb = NaiveBayes([bench.example(r, task, "id") for _ in range(3000)])
    gen, out = random.Random(f"suite3-adv:{namespace}:{task}"), []
    while len(out) < n:
        e = bench.example(gen, task, "id")
        if nb.predict(e[0]) != e[1]:
            out.append(e)
    return out


def main() -> None:
    if len(sys.argv) > 1:
        use(sys.argv[1])
    report = {t: audit_task(t) for t in bench.TASKS}
    print(json.dumps(report, indent=1))
    flagged = [(t, s) for t, v in report.items() for s, x in v.items() if x["flag"] and t not in KNOWN_FLOORS]
    print("flagged:", flagged or "none", "| known floors:", sorted(KNOWN_FLOORS))


if __name__ == "__main__":
    main()
