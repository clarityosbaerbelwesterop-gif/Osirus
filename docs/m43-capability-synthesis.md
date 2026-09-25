# M43: Capability synthesis V2

M43 lets the Foundry mine procedures that verified runs share and turn them into skill candidates. It also lets the Foundry detect a tool the agent keeps missing and synthesize it, behind an isolated, fully gated pipeline. Nothing it produces is installed in production. A synthesized skill or tool reaches a run only when that run's policy names it. That policy is a Foundry trial, and afterwards champion and canary like any strategy change. The canary rollback quarantines it with its evidence.

## Mechanism

| Piece                  | Where                                                                                    | What it does                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration 018          | `db/migrations/018_capability_synthesis.sql`                                             | Additive. The CHECKs on `learning_artifacts` (kind and status), `generation_runs.kind` and `strategy_versions.status` are replaced by supersets. `status` is added to `skill_definitions` and `skill_versions` (candidate, experimental, active, quarantined, deprecated), with default `active`; disabled definitions become `deprecated`. `skill_definitions.pinned_version` is added. There are no new grants or policies. |
| Procedure mining       | `synthesis/skills.ts` `mineProcedures`                                                   | Takes the tool sequences of verified trials, collapsed and with failed steps removed. Tool n-grams of length 2 to 4 are kept when they occur in at least 3 distinct tasks from at least 2 generators, so a benchmark template does not count. Only the longest supported grams are kept.                                                                                                                                      |
| Skill synthesis        | `synthesizeSkill`, `persistSkillCandidate`                                               | Produces a structured candidate: trigger, preconditions, inputs, procedure, tools, verification, output, failure modes and provenance. It is written to the existing `skill_definitions` and `skill_versions` tables with status `candidate`, plus a `procedure` artifact.                                                                                                                                                    |
| Skill loading          | `skills/repository.ts` `loadEnabled`                                                     | The product loads active skills at their pinned version, or else at the newest active version. A policy's `genome.skills.include` (`id@version`) adds named candidate or experimental versions. Quarantined skills and versions never load.                                                                                                                                                                                   |
| Tool gap detection     | `synthesis/tools.ts` `detectToolGaps`                                                    | Looks for the same missing operation across at least 3 distinct tasks: the agent asked for a tool that does not exist, or did one operation by hand in 4 or more consecutive calls.                                                                                                                                                                                                                                           |
| Tool synthesis         | `synthesizeTool`                                                                         | A pipeline of gates. The first gate that fails stops it and the report says why. The stages and the isolation layers are listed below this table.                                                                                                                                                                                                                                                                             |
| Candidate, not install | `tool_candidate` artifact, status `proposed`                                             | It is used only when `genome.tools.include` names it. `agent/toolbox.ts` then registers it as `trust: "generated"`: read-only, low risk, and every call runs in a fresh isolated process. `ToolRegistry.register` refuses any generated tool with another effect or risk. The loader re-runs static analysis, so an edited artifact is refused.                                                                               |
| Evolution              | `evolveTool`                                                                             | A v1 failure pattern goes back to the proposer as feedback. v2 goes through the same pipeline and must beat v1's held-out rate, not only the no-tool baseline. v1 is then superseded.                                                                                                                                                                                                                                         |
| Quarantine             | `synthesis/quarantine.ts`, called from the canary rollback in `promotion/canary-step.ts` | When a canary rolls back, every synthesized tool and skill the version carried is quarantined. The skill's last active version is pinned again. A `promotion_events` row keeps the evidence, and a repair item goes on the agenda. Nothing is deleted.                                                                                                                                                                        |

**Pipeline stages:**

1. **Propose:** a schema-validated spec, a pure function and at least 3 tests.
2. **Static analysis:** an acorn AST allowlist.
3. **Sandbox:** the candidate compiles and runs in the isolated executor.
4. **Unit:** the proposer's tests plus held-out tests it never saw.
5. **Security:** the isolation probes must fail on this host, and the candidate's context must show no `process`, `require` or `fetch`.
6. **Adversarial:** 8 hostile inputs (wrong types, 100 kB strings, 200-deep nesting, `__proto__` and `constructor` keys) must return JSON or fail cleanly within time, with no prototype pollution.
7. **Holdout evaluation:** paired, with the tool against without it. The tool must add a gain.
8. **Candidate:** a `tool_candidate` artifact plus a `tool_synthesis` generation run.

**Isolation layers** (`synthesis/isolation.ts`):

- **Static.** An AST allowlist: one `function run(input)`. Only pure built-ins may be named. No imports, `this`, classes, async code or generators. No `constructor`, `__proto__` or `prototype`, and no computed member access beyond index arithmetic.
- **vm context.** A fresh context with no host globals. Code generation from strings and wasm is disabled.
- **Process.** A separate Node process under the permission model: no fs, no child processes. It has an empty environment and a 64 MB heap.
- **Time.** A timeout per call and a wall-clock kill.

## Root of trust

These stay outside what synthesis or any candidate can change:

- auth, tenancy, RLS and the security policy;
- the evaluation code and the promotion rules;
- rollback, the audit log (`promotion_events`) and budget enforcement.

It is enforced three ways:

- **The genome is strict.** `tests/capability-synthesis.test.ts` shows it rejects `auth`, `rls`, `promotion`, `evaluation`, `audit` and `budget`, and accepts only `gen.*@vN` tool ids.
- **The registry refuses** generated tools that are not read-only.
- **Generated code runs only** in the isolated executor.

## Evidence

The novel-capability test in `tests/capability-synthesis.test.ts` runs the real pipeline and the production agent loop:

1. **Tasks fail.** Three failing tasks from three different generators ask for a tool that does not exist (`iban.validate`).
2. **The gap is detected:** `iban.validate` across 3 tasks.
3. **The tool is synthesized.** The scripted proposer returns a mod-97 IBAN check as a pure function. It passes every gate: static analysis, sandbox, unit (3 proposed + 2 held-out), security, adversarial and holdout.
   - **Holdout:** 4 IBANs (Belgium and Italy, valid and invalid), each solved by `runAgentLoop` with and without the tool. With the tool: 4 of 4. Without it the policy guesses and gets 2 of 4.
4. **It is stored as a candidate, not installed.** It is promoted through a genome that names it.
5. **An unseen task selects it.** The task uses a Spanish IBAN; no test or holdout used Spain. The agent picks the tool from the tools it is offered.
6. **Verified performance rises.** Paired on the unseen task (one valid and one invalid Spanish IBAN): 2 of 2 with the tool, 1 of 2 without it. Without the tool the guess is right only for the valid IBAN.

**Other tests in the same file:**

- All 14 hostile sources are rejected at static analysis: `process`, `require`, `fetch`, `globalThis`, `constructor`, a string built into `constructor`, `__proto__`, `eval`, `Function`, `import()`, async code, `this`, extra top-level code and a class.
- The isolation probes are blocked. An infinite loop hits the timeout. Prototype pollution is detected.
- **Early stops:** a hostile candidate stops at static analysis, a wrong one at unit, and a useless one at holdout. None is stored.
- **Evolution and quarantine:** v1 → v2 supersedes v1. Quarantining v2 marks it quarantined, writes a promotion event and adds a repair item to the agenda.
- **Procedures:** a mined procedure spans 3 tasks and 2 generators. With a single generator, nothing is mined.

## Limits

- **The proposer in CI is scripted.** The live proposer is a Foundry call on the free model. Its output meets the same gates, and nothing here claims the model writes good tools.
- **Tool gaps come from observable requests only.** They need the agent to name the missing tool or to do the work by hand. A gap the agent never notices is not detected.
- **Every call starts its own process.** A generated tool call costs one Node process start, about 50 ms. That is acceptable for read-only helpers and is the price of isolation.
