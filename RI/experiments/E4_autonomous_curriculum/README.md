# E4 — Autonomous learning selection (M5)

Question: can a learner choose which task family to practise next using uncertainty, recent performance and estimated cross-task reuse?

Families are synthetic and their success probabilities are evaluator-side. Policies: uncertainty+reuse heuristic, random, fixed round-robin, error-only. Measures: success, family coverage, interaction cost. Run `python -m unittest -v` and `python evaluate.py --seeds 0 1 2 3 4 5 6 7 8 9`.

This is an explicit curriculum heuristic, not intrinsic motivation. Synthetic results cannot establish general intelligence.