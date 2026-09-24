# DEFERRED — M31, M32, M33, M34

The capability brief stopped mid-sentence in M30.4. This PR implements M30.1 through M30.4 only. The milestones below are not designed here and not implemented here. Do not read the current memory helper, the hypothesis list, the offline baseline, or the durable runtime as substitutes for them.

## M31 — Memory OS

DEFERRED. Awaiting the rest of the brief.

Already in the product, and left as they are: workspace memory retrieval, Memory Compiler v2 (unverified outcomes stay unpromoted), and the new `TaskState.knownFacts` copy of what the current loop retrieved. None of that is a memory operating system.

## M32 — Deep Cognition

DEFERRED. Awaiting the rest of the brief.

`TaskState` and the evidence-sensitive hypothesis update are the M30 cognitive record on the existing loop checkpoint. They are not a deep-cognition stack, and this PR does not add one.

## M33 — Deep Thinking / Reasoning

Implemented on branch `build/m33-deep-thinking`. See `docs/m33-deep-thinking.md`.

Multi-step deliberation with M30 hypothesis states, finish gating when TaskKernel carries hypotheses or success criteria, adversarial and compound reasoning paths on the existing loop, plus docs and tests. No second scheduler.

## M34 — Hourly Capability Pulse / RSI Watchdog

DEFERRED. Awaiting the rest of the brief.

`src/lib/agent/baseline.ts` is a one-shot offline measurement. It is not scheduled, not hourly, and not a pulse over live providers. M34 owns the hourly evaluator and RSI watchdog.

## Explicitly not in this PR

- No second scheduler, lease, checkpoint store, or run state machine.
- No replacement of the agent by Foundry-only work.
- No AGI or ASI claim.
