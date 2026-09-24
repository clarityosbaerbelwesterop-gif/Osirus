# M33 — Deep Thinking / Reasoning

M33 adds multi-step deliberation and anti false-completion on the existing agent loop checkpoint. There is no second scheduler, lease, or runtime.

## What shipped

### Hypothesis evidence states (M30-compatible)

The loop already persists hypotheses on `TaskKernel` with M30 states:

`OPEN` | `SUPPORTED` | `WEAKENED` | `REJECTED` | `CONFIRMED`

M33 does not replace this model. VERIFY steps still move only the hypotheses they name or whose statement or falsifier the evidence matches.

### Finish gate (anti false-completion)

When the checkpoint carries **hypotheses** or **success criteria**, `FINISH` is gated in `src/lib/agent/finish-gate.ts`:

1. At least one successful `VERIFY` step must appear in the slice unless the answer explicitly acknowledges an unresolved conflict.
2. The answer must not claim success that verification or hypothesis states reject.
3. Competing supported hypotheses (for example two opening years) cannot collapse to one side without reporting the disagreement.
4. Numeric answers must match a `SUPPORTED` or `CONFIRMED` hypothesis when one exists.

The loop records a correction observation and keeps running instead of finishing. Simple tasks without kernel gates behave as in M30.

Implementation: `assessFinishGate` in `src/lib/agent/finish-gate.ts`, wired into `runAgentLoop` for the `FINISH` action.

### Deep reasoning paths

`src/lib/agent/reasoning.ts` selects a deliberation profile from the objective and seeded kernel fields:

| Path          | When                                       | Phases                                                          |
| ------------- | ------------------------------------------ | --------------------------------------------------------------- |
| `direct`      | No hypotheses or success criteria          | answer                                                          |
| `standard`    | Gated task with success criteria           | hypothesize → verify → finish                                   |
| `adversarial` | Rival hypotheses or explicit contradiction | seed rivals → gather → verify each → resolve or report → finish |
| `compound`    | Multi-segment objective with gates         | decompose → evidence per segment → cross-check → finish         |

Path-specific directives are appended to the loop system prompt. They describe **actions**, not private chain-of-thought.

## Baseline impact

The M30.2 offline capability baseline (`src/lib/agent/baseline.ts`) now expects:

- **Gated domains** (THINKING, REASONING, RESEARCH, MATH): `falseCompletion = false` — the finish gate blocks unsupported FINISH probes.
- **Ungated domains** (CODING, BUILDING, COMPUTER, MEMORY): `falseCompletion = true` — unchanged; those fixtures do not seed hypothesis gates.

## Explicitly not in M33

- No hourly capability pulse (that is M34).
- No second scheduler or watchdog process.
- No replacement of the agent loop by Foundry-only work.

## Tests

- `tests/finish-gate.test.ts` — gate rules and hypothesis compatibility
- `tests/deep-reasoning.test.ts` — path selection and directives
- `tests/agent-loop.test.ts` — integrated blocked FINISH and simple-task regression
- `tests/capability-baseline.test.ts` — gated vs ungated false-completion expectations
