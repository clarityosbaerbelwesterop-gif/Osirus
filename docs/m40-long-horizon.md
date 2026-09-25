# M40: Long-horizon autonomy V2

M40 lets a run outlive a slice, a worker, a deployment and a wait without losing what it knew, repeating what it did, or paying while nothing can move. It extends the M39 mission (`osirus.run_missions`) and the existing stage runtime. It adds no scheduler, no second checkpoint store and no migration.

## Mechanism

| Piece                  | Where                                                                                  | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Durable mission memory | `agent/long-horizon.ts`, stored in the mission row                                     | The mission row also holds the waits, the goal stack, the action ledger, `lastActiveAt` and `nextWake`. These fields are optional, so M39 rows read as empty.                                                                                                                                                                                                                                                                                           |
| Typed waits            | loop action `WAIT` (`agent/decision.ts`, `agent/loop.ts`), `StageOutcome.WAITING.wake` | An agent can wait for `ci`, `deployment`, `external_event`, `dependency`, `rate_limit`, `schedule` or `human`. Each wait is bounded to 7 days at most. `wakeFor` turns the request into a wake condition: `time`, `poll` (a model-free probe every 5 minutes, up to a deadline), `event` (up to a deadline) or `human`.                                                                                                                                 |
| Waiting costs nothing  | `runtime/settlement.ts` `settlementFor`                                                | A time, poll or event wait parks the stage as `blocked` with `runnable_after` set to when it is due, so the claim scan skips it. A wait for a person parks it as `waiting`. Either way no attempt is spent, and a re-claimed stage decides without a model whether to wake (`arms/horizon-runtime.ts` `resumeStage`).                                                                                                                                   |
| Run status             | `runtime/repository.ts` `stageProgress`, `runtime/worker.ts`                           | Only approval and human waits make a run `waiting_for_approval`. A run waiting on the world stays `running` with the reason `waiting_external`.                                                                                                                                                                                                                                                                                                         |
| Release from outside   | `runtime/waits.ts` `releaseWaits`, called by `/api/hooks/[endpointId]`                 | A verified webhook delivery releases every stage in the endpoint's own workspace whose event key or CI/deployment ref it satisfies. A release happens only for a fresh (non-duplicate) delivery. Afterwards one tick is requested.                                                                                                                                                                                                                      |
| Model-free probe       | `runtime/waits.ts` `deliveryProbe`                                                     | A due poll or event wait checks the webhook deliveries recorded in its workspace since the wait began. The read runs as the caller, under RLS. Only CI failures are delivered, so a CI success is reported as "not observed" at the deadline and never as success.                                                                                                                                                                                      |
| Human waits            | existing approval queue                                                                | A `human` wait creates an `agent:question` approval. `resolveApproval` releases it, as it does every other decision a person makes.                                                                                                                                                                                                                                                                                                                     |
| Temporal re-validation | `revalidateMission`, `pruneExpired`                                                    | Runs when a stage resumes from a wait, or after more than 10 minutes idle. It marks expired facts invalid, but never deletes them: a fact is past its `validUntil` or volatility window, or is an `event` fact after any wait. It weakens hypotheses whose support rested only on invalidated facts, and writes a plan revision. Expired facts are dropped from the resumed kernel and become "re-observe" questions. The loop is told what went stale. |
| Volatility             | `mission.ts` `addFacts`                                                                | A fact is as volatile as its most volatile sighting. A price that research reported as slow and a tool reported as event-bound is event-bound.                                                                                                                                                                                                                                                                                                          |
| Goal stack             | `reconcileGoals`, `frontier`                                                           | Goals move between active, blocked, deferred, completed and failed. They record their prerequisites, alternatives and the hypotheses already ruled out. On resume, the loop is told the frontier: the first active goal whose prerequisites are done.                                                                                                                                                                                                   |
| Action ledger          | `ToolRegistry.useLedger`, `missionLedger` (attached in `agent/toolbox.ts`)             | Every `external` call records an intent before it runs and a done or failed record after. A replay of the same tool with the same input (a stable hash) returns the recorded result and does not run again. An intent without an end is not repeated blindly: the call returns `action_outcome_unknown`. If the intent cannot be recorded, the call does not run at all (fail closed).                                                                  |

## Evidence

### LONG_HORIZON L1–L5 pulse

Source: `agent/pulse/long-horizon-suite.ts`. It is part of the unified pulse as `m40:long_horizon:l1…l5`.

**How each slice runs.** Each slice runs the same pieces a BaseArm stage runs: `resumeStage`, `runAgentLoop`, `parkOnWait`, the mission ledger on a `ToolRegistry`, `settlementFor` and the mission gate.

**How failures are injected.**

- **Worker kill:** a JSON round trip of the checkpoint.
- **Deploy between slices:** an older checkpoint is hydrated.
- **Provider refusal:** a `ProviderError rate_limited` from the decider.
- **Partial tool failure:** a write tool that fails once.

**Levels.**

| Level | Scenario                                                                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L1    | A worker is killed after a checkpoint; the run resumes.                                                                                                |
| L2    | A deployment wait.                                                                                                                                     |
| L3    | An irreversible publish, then a hydrated older checkpoint, plus a flaky write.                                                                         |
| L4    | An assumption goes stale during a deployment wait.                                                                                                     |
| L5    | Two capabilities, a crash, a CI wait, a provider refusal, a price that changes during the wait, a replan and a verified finish under the mission gate. |

**Paired comparison.** One fixture policy runs in both modes, so the difference comes from the mechanism, not from a model:

- **M40:** typed waits, ledger and re-validation.
- **Pre-M40:** no typed wait, so the policy polls a status tool and yields every slice; no ledger; no re-validation.

| Task                | Mode    | Verified | False completion | Model calls | While waiting | Parked slices | Duplicate external actions | Stale facts used |
| ------------------- | ------- | -------- | ---------------- | ----------- | ------------- | ------------- | -------------------------- | ---------------- |
| L1 crash + resume   | M40     | yes      | no               | 4           | 0             | 0             | 0                          | 0                |
|                     | pre-M40 | yes      | no               | 4           | 0             | 0             | 0                          | 0                |
| L2 deployment wait  | M40     | yes      | no               | 3           | **0**         | 3             | 0                          | 0                |
|                     | pre-M40 | yes      | no               | 9           | 6             | 0             | 0                          | 0                |
| L3 idempotent       | M40     | yes      | no               | 8           | 0             | 0             | **0**                      | 0                |
|                     | pre-M40 | no       | **yes**          | 8           | 0             | 0             | 1                          | 0                |
| L4 stale assumption | M40     | yes      | no               | 4           | 0             | 2             | 0                          | **0**            |
|                     | pre-M40 | no       | **yes**          | 7           | 4             | 0             | 0                          | 1                |
| L5 full             | M40     | yes      | no               | 9           | 0             | 1             | 0                          | 0                |
|                     | pre-M40 | no       | **yes**          | 9           | 6             | 0             | 0                          | 1                |

**Totals.** M40 verifies 5 of 5 and spends 0 model calls while waiting. Pre-M40 verifies 2 of 5, spends 16 model calls while waiting, and has 3 false completions.

**Scope.** This is an offline fixture measurement of the mechanism, and every pulse result says so. It does not measure a model.

### Production arm path

`tests/long-horizon.test.ts` runs the real general arm through the arena harness. The arm's loop issues `WAIT deployment`, and the stage is re-claimed three times. The first two probes report unmet; the third reports met, and the stage finishes. Every probe saw the same model-call count, so parking spent no model call.

The same file also covers:

- settlement of every wait kind;
- the delivery key mapping;
- re-validation: expiry, weakening, and nothing deleted;
- volatility merge and kernel pruning;
- the goal frontier;
- the ledger: a replay, an intent without an end, fail closed, and a stable key.

### Recovery matrix

| Failure                        | Covered by                                                                                                                                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker kill after a checkpoint | L1, L5                                                                                                                                                                                                                  |
| Provider refusal               | L5. The loop state is kept, and the stage is blocked and then resumed.                                                                                                                                                  |
| Lease expiry                   | The claim scan already re-claims an expired lease from the last checkpoint (`claim_next_stage`, migration 012). This is the same code path as a worker kill. The SQL probe on the disposable branch is part of landing. |
| Duplicate scheduler call       | Stage claims are fenced by lease token in `claim_next_stage`. Pulse ticks are fenced by lease and compare-and-swap (`tests/capability-pulse.test.ts`).                                                                  |
| Deploy between slices          | L3: an older checkpoint is hydrated; the ledger prevents a second publish.                                                                                                                                              |
| Stale assumption               | L4, L5                                                                                                                                                                                                                  |
| Partial tool failure           | L3                                                                                                                                                                                                                      |

## Limits

- **CI success is not observable yet.** GitHub delivers only failures to the webhook receiver. A CI wait therefore ends when a failure is delivered or at its deadline, and says which.
- **The goal stack comes from the stage kernel's plan and subgoals.** There is no separate planner.
- **Dedupe covers `external` tools only.** A workspace `write` repeated with the same input can be intended, for example writing a file back, so writes are not deduplicated.
