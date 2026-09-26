# M44: continuous self-play and the autonomous curriculum

Osirus is the intelligent system; the model is the engine. M44 makes Osirus
test, attack and extend its own machinery every hour, and learn only from
verified outcomes. No model is trained, and no weight changes.

## The hourly Recursive Intelligence Cycle (RIC)

- **Where it runs.** The RIC is one more bounded step of the existing
  scheduler tick (`src/app/api/scheduler/tick/route.ts`), after the Foundry
  step and the capability pulse, with 60 s of the tick. There is no second
  scheduler.
- **Where its state lives.** State is in `osirus_intel.rsi_cycles`
  (migration 019), under the same rules as the pulse:
  - one running cycle;
  - a lease to step it;
  - a phase cursor that moves only from the value the caller read, committed
    together with the state that phase produced.
- **Resilience.** A crash between phases loses nothing that was committed. A
  phase that throws is recorded with its error and passed over.
- **Phases** (`src/lib/intelligence/rsi/phases.ts`):
  - **health** — the last pulse cycle, weak cells, confirmed regressions, the
    live-call envelope;
  - **experience** — pulse results become experience rows. Infrastructure
    failures and inconclusive results are excluded; they never teach. Also
    writes failure memory and anti-patterns;
  - **gaps** — weak cells and findings become capability gaps. Support counts
    distinct evidence rows, not a running sum;
  - **challenge** — the adaptive curriculum stocks new verified tasks from
    gaps, weak cells and "harder versions of strengths";
  - **self_play** — two arenas per cycle, rotated, each at its adaptive level;
  - **red** — four attack classes per cycle, rotated;
  - **hypothesize** — code hypotheses for failing mechanisms; strategy
    hypotheses (the library, ordered by the M42 meta-policy);
  - **experiment** — at most one live order, within the call envelope;
  - **decide** — the paired decision rule over live evidence; promotion inside
    the Intelligence Plane; quarantine and rollback after a confirmed
    regression;
  - **memory** — strategic memory, and closing gaps that no longer reproduce;
  - **meta** — new and resolved weaknesses, retired generators, the daily
    rollup.
- **"No verified improvement" is a valid result**, and the cycle summary says so.
- **Tenant.** The cycle is tenantless: it runs as the system on `osirus_intel`
  and never reads a tenant's work.

## Live calls

By operator decision: about two calls an hour on the free model, 48 a day,
at most 12 on one live order (enough for a champion/challenger pair).

- The allowance accrues through the UTC day (`rsi/budget.ts`).
- Calls are reserved before they are spent, then settled against actual use.
- When the envelope is spent, the cycle continues offline.

### Which hypothesis gets the live order

- **Why this rule exists.** In production (2026-09-25/26) no live order opened in 6 cycles. The only live hypotheses targeted `coding.debug`, whose tasks need a sandbox. The capabilities the cycle actually measures (`reasoning.*`, `planning.*`, `memory.*`) had no strategy, so their gaps never became hypotheses.
- **New strategy.** The general arm now has a strategy of its own, `general.reasoning` (`strategies/genomes.ts`), which owns those capabilities. The M46 architecture and M48 model-use candidates apply to it.
- **How the experiment phase picks.** It takes the first live hypothesis that can be tested now:
  - a strategy with a champion;
  - label-verified tasks of the hypothesis's own capability;
  - tasks the live lane can check without a sandbox.

  A hypothesis that fails these checks is passed over; it does not block the others.

## Arenas (`src/lib/intelligence/generation/arenas.ts`)

An arena has three roles:

- a **generator** makes instances from a seed and a level, and keeps the
  ground truth in the instance's parameters;
- the **solver** is a real Osirus mechanism, called as production calls it;
- the **verifier** is an oracle computed from the generator's parameters.

No agent grades itself.

Every instance carries:

- its lineage (parent, reason, operators);
- a content fingerprint;
- a surface text, used for novelty checks.

Self-play (beyond the existing coding and math generators):

| Arena                      | Mechanism under test                                 |
| -------------------------- | ---------------------------------------------------- |
| researcher_vs_skeptic      | `research/citations.ts:verifyClaims`                 |
| solver_vs_falsifier        | `agent/team.ts:normalizeClaim` (disagreement engine) |
| retriever_vs_contradiction | `agent/mission.ts:addFacts` / `seedForStage`         |
| planner_vs_world_change    | `agent/long-horizon.ts:reconcileGoals` / `frontier`  |
| mission_vs_perturber       | `agent/mission.ts:assessMissionGate`                 |

Red Intelligence V2 has 19 attack classes:

- stale facts, conflicting memory, misleading source;
- prompt injection (fence forgery), false authority;
- incorrect tool result, partial tool failure, false success signal;
- misleading worker, hidden dependency, contradictory requirements;
- context overflow, wrong units, underdetermined problem;
- stale deployment state, plan corruption, handoff loss;
- wrong specialist, premature completion.

Each class attacks the mechanism that should resist it. Classes whose
mechanism is part of the trust root (fencing, the outcome rule) are marked:
their repair needs the operator.

**Generator quality** (`generation/challenges.ts`):

- **Score.** Each round scores its generator by validity, novelty and
  informativeness.
- **Raising difficulty.** Two clean rounds raise the level.
- **Confirmed failures.** A failure seen twice counts as confirmed, and the
  generator then explores the next level.
- **Retirement.** A generator that stops teaching (low score three times at
  its top level) is retired from the rotation. It still plays once a day.

## Findings on the first run

These are weaknesses no fixed suite had caught; each is recorded as a gap and
a code hypothesis.

- `normalizeClaim` takes the first number in a claim. "In 2023 the count was
  156" is read as 2023, so a correct minority is refuted by its own
  recomputation.
- The mission hands both "the deploy region is eu-west-1" and "… us-east-1"
  on as live facts, with no contradiction flag.
- `seedForStage` drops the newest verified fact when more than 12 verified
  facts exist.
- `reconcileGoals`:
  - a revised step keeps blocking its replacement;
  - a completed goal can never be reopened after a rollback.
- `assessMissionGate` calls a mission complete when a planned node never ran.
- `verifyClaims`:
  - five anonymous blogs outweigh an uncited primary source that was
    retrieved (SUPPORTED, confidence 1.0).
- `asPromptContext` (trust root): a zero-width character inside the END
  marker survives the fencing.
- `routeObjective` sends "standard deviation of …" to the general arm.

## Self-play repairs

- **Partitions.** Mutants and math variants keep their family's partition. A
  holdout family no longer leaks into dev.
- **Lineage.** Every generated task names its stored parent and its operators.
- **Fresh mutants.** The bug generator rotates mutation sets and moves on to
  pairs, so later rounds produce tasks nobody has seen. It skips known
  mutants without running them.
- **Round counter.** The problem-generator round is the UTC hour. It is no
  longer capped by the number of generation runs a listing returns.
- **Red coding traps.** Their labels are verified in the sandbox when one is
  available.

## Anti-contamination

Every curriculum task is checked against the stored holdout texts with the
dataset near-duplicate distance.

- The last template of every generator is held out, so a holdout task never
  shares wording with a dev task.
- An exact fingerprint is a duplicate.

## Pulse

The self-play arenas are a new pulse family, `SELF_PLAY`. Its instances are
fresh every hour, so the cell measures the mechanism on cases no fixed
fixture could have been tuned to.
