# M46: architecture evolution

In M46 the wiring of Osirus becomes a candidate the Foundry can test, with
the same UnoRouter model on both sides. Only a measured improvement is
promoted.

## The blocker that was removed

`runtime/executor.ts` used to compose the workflow graph _before_ it
resolved the strategy policy. A genome could therefore change what happened
inside a stage, but never the shape of the graph.

The policy is now resolved first. Its architecture then shapes the
composition and the graph. The arena harness does the same, so a trial runs
exactly the graph its architecture produces.

## `genome.architecture`

| Key        | Values (default first)                | Effect                                                                                                                    |
| ---------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `planning` | `direct` · `planner_executor`         | A thinking segment plans first and hands a typed plan contract to the executor (`arms/compose.ts: architectComposition`). |
| `memory`   | `early` · `late`                      | `late` removes the up-front retrieval stage and rewires its dependants. The loop searches memory on demand.               |
| `evidence` | `as_routed` · `first`                 | Research moves to the front of a compound composition.                                                                    |
| `critic`   | `none` · `specialist` · `adversarial` | Maps to `solver_critic` or `solver_adversary` (`agent/team.ts: topologyOf`). An explicit `team` wins.                     |

**An absent key is today's behavior.** The `ARCHITECTURE_SEARCH` pulse
family checks every hour that the default architecture produces a graph
identical to today's, for representative compositions. An accidental change
of runtime semantics is the failure this family catches.

## In the Foundry

**Candidates**

- Library entries per gap:
  - planning gap → planner-executor;
  - context gap → memory on demand;
  - verification gap → adversarial critic;
  - knowledge gap in research → evidence first.
- Exploratory mutations include one-variable architecture changes.

**Meta-policy.** Architecture has its own mechanism in the meta-policy
(`architecture`), so Osirus learns whether rewiring pays off for a given gap
kind.

**Comparison.** A challenger's architecture runs against the champion's on
the same tasks and model. The comparison uses the same paired decision rule
as every other candidate.

**Promotion.** A winning architecture is promoted to champion only inside
the Intelligence Plane. Product runs use active or canary versions, which
only the canary step can create.

## What is measured, honestly

The tests show structural differences, not a win:

- the architectures differ in the graph they run;
- on a scripted task, each run completes;
- memory on demand runs one stage fewer.

Whether an architecture _verifies more_ on the free model is decided only
by live paired trials through the RIC's live orders.
