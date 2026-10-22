# RI — Reasoning Intelligence

Research prototype exploring explicit reusable operations, composition, autonomous task selection, continual memory and constrained improvement.

## Current branch
`ri/isolated-foundation` — work stays under `RI/` plus the dedicated validation workflow.

## Milestones implemented as research code
- **M3 / E2:** operational intervention strategy with random and fixed baselines.
- **M4 / E3:** two-stage prerequisite task and probe/verify composition with equal query budgets.
- **M5 / E4:** heuristic task selection compared with random, fixed and error-only curricula.
- **M6 / E5:** explicit continual memory and a reset-memory ablation.
- **M7 / E6:** bounded, allow-listed configuration proposals with a synthetic promotion gate.

## Run tests and experiments
Python 3.12 is configured in GitHub Actions. Locally, from the repository root:

```bash
python RI/run_experiments.py
```

The workflow `.github/workflows/ri-validation.yml` runs on pushes to this branch that touch RI files, pull requests, and manual dispatch. Check Actions for the actual run and logs; a committed workflow is not itself evidence that it passed.

## Scientific status and limits
M3–M7 are small CPU-friendly toy experiments and harnesses. Their procedures, task families, and parts of the scoring rules are hand-designed. They do not establish autonomous skill acquisition, consciousness, general intelligence, or a novel principle of intelligence. Do not promote a hypothesis based on passing unit tests alone. Inspect raw results, compare baselines, vary task families and seeds, and preserve negative findings.

## Next gate
Execute CI, fix all actual failures, audit evaluation leakage and fairness, then redesign weak toy tasks into held-out tasks where capabilities must be acquired from interaction rather than supplied in advance.
