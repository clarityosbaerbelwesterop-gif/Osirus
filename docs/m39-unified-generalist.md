# M39: Unified cross-domain generalist

M39 makes a compound objective one mission instead of a sequence of specialist conversations. It builds on the existing run, stage and TaskState machinery; it adds no second agent loop, scheduler or checkpoint store.

## Mechanism

| Piece                        | Where                                                                   | What it does                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mission state                | `agent/mission.ts`, table `osirus.run_missions` (migration 017)         | One authoritative record per run. It holds the contract and the capability nodes. It holds facts with provenance: capability, stage, kind, evidence refs, verified or not. It also holds hypotheses (rejected ones are kept), contradictions between capabilities, open questions, constraints, plan revisions, capability switches and handoff counts.                                                                   |
| Concurrent writes            | `runtime/missions.ts`                                                   | Writers compare and swap on `version`, and `updateMission` retries a lost race. Two stages that reconcile at once both land. A row that keeps moving raises `MissionConflictError` instead of being overwritten.                                                                                                                                                                                                          |
| Mission graph                | `arms/compose.ts` `missionFor`, `runtime/executor.ts`                   | The mission is created when the run is planned: one node per capability segment. Stages stay the existing `run_stages` DAG.                                                                                                                                                                                                                                                                                               |
| Evidence-preserving handoff  | `arms/mission-runtime.ts`                                               | **At the start of the answering loop,** the stage is seeded from the mission: verified facts first, each labelled with where it came from; rejected hypotheses as known dead ends; open contradictions. This replaces receiving earlier answers as prose. **After the loop,** the stage's kernel is reconciled into the mission. **At `verifyStage`,** the verdict and the typed handoff are reconciled into the mission. |
| Stage-local state            | same                                                                    | TaskState stays stage-local working state. The mission is global.                                                                                                                                                                                                                                                                                                                                                         |
| Dynamic capability switching | `SPAWN_WORKER`, which now has a production hook                         | A stage that finds its capability insufficient asks for another. `appendStages` (`runtime/dispatch.ts`) inserts that capability's segment plus a continuation of the asking capability, and every stage that waited on the asking stage now waits on the continuation. The mission records the reason, the triggering evidence and the new dependency as a switch and a plan revision. At most 4 switches per mission.    |
| Cross-domain finish gate     | `assessMissionGate`, applied in `metaVerifyStage` and `finalizeRunCore` | **Complete:** every capability node the mission ran has a verified verdict and no contradiction between capabilities is open. **Failed:** any node is rejected or conflicted, or a contradiction is open; the run fails with `mission_incomplete` and the list of what is missing. **Partial:** some nodes are unverified; the run completes, but the mission outcome is `partial` and it is never reported as verified.  |
| Repair                       | same                                                                    | Short of complete, the contract check re-runs the capability that fell short, once (answer, verify, contract check).                                                                                                                                                                                                                                                                                                      |
| Scope of the gate            | same                                                                    | It applies to runs that span more than one capability or grew one. Single-capability runs keep today's behaviour.                                                                                                                                                                                                                                                                                                         |

The arena harness runs the same code in memory: `MemoryMissionStore` and an in-memory graph appender. Its stage loop re-reads the graph after every stage, so a switch behaves offline as it does in production.

## Evidence

### Capability switching end to end

Test: `tests/mission.test.ts`, through the arena harness with the real arms.

1. The math arm's loop asks for another capability because it lacks an external parameter.
2. That capability's segment is inserted after the asking stage.
3. A math continuation (`answer`, `verify`) runs after the inserted segment.
4. The mission records the switch and a plan revision.
5. The activity log records `mission.capability_added`.

### Generalist pulse (CROSS_DOMAIN L1–L5)

Source: `agent/pulse/cross-domain-suite.ts`, in the unified pulse as `m39:cross_domain:l1…l5`.

**Levels:**

- L1: research, compute.
- L2: research with a stale value that it rejected, compute, reasoning.
- L3: research, reasoning, `compute.run`.
- L4: research, coding, with `node --test` deciding.
- L5: research, reasoning, compute, then a capability switch that adds research, then compute, coding (`node --test`), a browser DOM check and synthesis.

**How it runs:** each step is the production agent loop with real tools and a deterministic verifier. Decisions come from one fixed fixture policy: read a verified fact first, avoid a value that a rejected hypothesis names, otherwise take the first mention. That policy is applied to whatever the step was handed.

**Paired comparison:** the same five tasks, the same policy and the same loop, run twice:

- **with the mission** (seed plus gate);
- **pre-M39** (earlier answers as prose, last stage decides completion).

|                                  | Mission            | Pre-M39 prose                                               |
| -------------------------------- | ------------------ | ----------------------------------------------------------- |
| Verified success                 | **5 / 5**          | 2 / 5                                                       |
| False completions                | **0**              | 1 (L5 finished "done" with a wrong price and failing tests) |
| Handoff loss of structured facts | 0                  | 1 (no structured facts are handed over)                     |
| Capability switches recorded     | 1 (L5)             | 0                                                           |
| Model calls                      | identical per task | identical per task                                          |

**Where the difference comes from:**

- The stale 16% value, which research rejected, reaches downstream steps as a rejected hypothesis instead of as the first number in a paragraph.
- The mission gate refuses to finish on a rejected coding or browser verdict.

**What this does not measure:** a model. It is an offline fixture measurement of the handoff and gate mechanism, and it says so in every pulse result. Live measurement belongs to the Foundry (durable trials on the free model).

## Found while building

- **Seeding the mission's contract criteria into every stage kernel would have activated the M33 finish gate on every run.** The Foundry test caught it: every scripted math trial became `wrong_answer`. The contract is checked at mission level only.
- **`node --test <dir>` fails on Node 22.** The suite runs `node --test` with discovery instead.
