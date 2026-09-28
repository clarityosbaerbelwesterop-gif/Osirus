# Rouge 1 — architecture plan (M56–M75)

> **Superseded (2026-09-28).** Rouge 1 is now a trained model: a derivative
> of Qwen3.5-397B-A17B with its own checkpoints. See
> [`native-model.md`](native-model.md) and
> [`compute-plan.md`](compute-plan.md). This document records the M56–M57
> model-system prototype, which is kept as **legacy research**
> ([`legacy-runtime.md`](legacy-runtime.md)). Its milestone plan from M58
> onward no longer applies.

Rouge 1 is a model system: a foundation model plus Rouge's own cognition,
managed context, memory, verification and learned policies. Its initial
foundation core is Grok 4.6, reached through UnoRouter. Rouge does not own,
download or fine-tune Grok's weights, and Grok 4.6 does not have a 2M-token
native window. "2M" in this document always means **Rouge 2M managed
context**.

Osirus stays the agent product. In ChatHub, **AI** mode is Rouge 1 and
**Agent** mode is Osirus. The short version for users: Rouge thinks, Osirus
acts.

This plan rests on an inspection of the real repository and services on
2026-09-27. It replaces the SHAs and assumptions in the original brief.

## 1. Where things stand (inspected 2026-09-27)

| Area               | Finding                                                                                                                                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| main               | `04e1a0f` (#33: runs always finish, one fast answer to "Hallo", Neon/Supabase keys). Production runs this SHA on osirus.vercel.app.                                                                                                       |
| Open PRs           | None.                                                                                                                                                                                                                                     |
| Production health  | `prod-journey.yml` run 36320814899 passed: GitHub sign-in reaches GitHub, email sign-up lands in `/app`, "Hallo" is `completed` with 1 answer, 6 stages (general only) and 33 s, and an MCP server is added, checked and removed.         |
| M49–M55            | M49 (free-model-first recovery) and parts of M50 are merged: screenshots (#27), connections/MCP (#30), sign-in errors (#31). `docs/defect-register.md` still lists OSIRUS-04/05 as investigating. M51–M55 were never built as milestones. |
| UnoRouter keys     | Three keys (`UNOROUTER_API_KEY_1..3`), not four. Each lists 260 models, 119 of them free. **`total_available` is 0 on every key** (provider-diagnostics run 36320559288).                                                                 |
| Grok 4.6           | Paid. With 0 balance every call is refused (`insufficient_credit`). **Rouge cannot run on Grok 4.6 until credit exists.** Buying credit is the owner's decision.                                                                          |
| Free pool          | These chat-probed models answered in 2–4 s: `laguna-s-2.1:free`, `nemotron-3-ultra-550b-a55b:free`, `deepseek-v4-pro:free`, `gemini-3.6-flash:free`, `glm-5.3-flash-search:free`. Some others were unavailable.                           |
| Teacher (Opus 5.5) | No Anthropic credential is configured. The teacher lab (M64) needs one obtained legitimately; until then it runs in offline mode, on stored verified comparisons only.                                                                    |
| ChatHub            | A single mode: every message is an Osirus agent run (router, then arms, then durable stages). There is no direct-model path yet.                                                                                                          |
| Context            | `context/builder.ts` assembles token-budgeted buckets for a single call. There is no paging, ledger or index across calls.                                                                                                                |
| Memory             | `memory/os.ts` (Memory OS I): episodic, semantic, procedural and strategic planes. Only verified items are promoted; contradiction queues exist.                                                                                          |
| Verification       | `verification/engine.ts` and `checks.ts`: structure, secret leak, model review, compute evidence. `verification/outcome.ts` holds the canonical outcome.                                                                                  |
| RSI                | Hourly RIC (`intelligence/rsi/*`, migration 019), software RSI as draft PRs (M45), architecture, compute and model-usage genome fields (M46–M48), and the meta-policy (`intelligence/meta/*`).                                            |
| Evaluation         | Arena (`arena/*`), capability pulse (016), live evals, and a **raw model vs Osirus benchmark** (`intelligence/benchmark/raw-vs-osirus.ts`) that uses the same judge for both sides.                                                       |
| Capacity           | `models/capacity.ts` schedules P0–P4, and interactive work outranks RSI (M49).                                                                                                                                                            |

## 2. Principles carried into every milestone

1. **The core is swappable.** Rouge talks to a `FoundationAdapter`, never to
   a vendor. The path is Rouge, then the adapter, then UnoRouter, then the
   core.
2. **Substitution is always labelled.** An interactive answer may come from
   a substitute model when the core refuses, for example for lack of credit.
   The answer then says so, and so does telemetry. An evaluation forbids
   substitution, so every number it reports is the named core's own.
3. **Rouge vs the raw core, on the same core, is mandatory** for every
   capability claim. It uses the same tasks, the same verifier, and a
   separate budget.
4. **Measure before claiming.** Rouge-run results are kept apart from
   published external results. Competitor scores are never fabricated. The
   numbers in the brief are recorded as _operator-supplied published results
   (unverified)_, never as Rouge results.
5. **Benchmarks never train Rouge.** Evaluation tasks stay out of every
   dataset (existing contamination checks: `datasets/verify.ts`, simhash
   against eval corpora). Holdouts are blind and rotated.
6. **No private chain of thought in the UI.** Status labels describe
   activity ("Thinking deeply", "Cross-checking"), never reasoning text.
7. **Osirus Agent mode keeps working.** Rouge is additive. Osirus adopts
   Rouge as its cognitive core only after an arena comparison shows a gain.

## 3. Layers and where they live

```
src/lib/rouge/
  types.ts            RougeRequest / RougeResponse / RougeVersion / stream events     M56
  foundation.ts       FoundationAdapter, CoreSpec, the core table                       M56
  foundations/        UnoRouterFoundation (the only provider contact)                   M56
  policy.ts           RougePolicy (versioned, evolvable), identity, effort map          M56
  telemetry.ts        per-request metadata, never content                               M56
  runtime.ts          RougeRuntime: request, then one coherent answer                   M56
  kernel/             task understanding, intent, uncertainty, planner, synthesis       M57
  effort/             effort controller (difficulty, uncertainty, stakes)               M58
  context/            ledger, segment store, indexes, working set, paging, pins         M59–M60
  memory/             Rouge memory planes on Memory OS                                  M61
  response/           response policies (clarity, structure, length)                    M62
  verify/             adaptive verifier over verification/engine                        M63
  teacher/            teacher lab (verified comparisons, extracted lessons)             M64
  selfplay/           Rouge self-play configurations on generation/self-play            M65
  compiler/           training compiler on intelligence/datasets                        M66
  rsi/                Rouge policies wired into the RIC; champion/challenger            M67
  meta/               improvement-policy learning on intelligence/meta                  M68
  evals/              long-context suite (128k–2M), arena certification                 M69–M70
```

Existing Osirus modules are reused, not duplicated:

- `verification/engine` becomes the Rouge verifier's backend.
- The Memory OS stores Rouge memory, in its own scope.
- `raw-vs-osirus.ts` grows a Rouge lane.
- `capacity.ts` stays the single capacity manager.
- `entitlements` carries the plan limits (M75).

## 4. Milestones

Each milestone ships with its implementation, tests, a live or offline
evaluation against the raw core, regression checks, documentation and its
own PR.

- **M56 Foundation (this PR).** The runtime, request and response, adapter,
  policy, telemetry and version, with the core pinned and substitution
  labelled. Live evaluation: `rouge-eval.yml`, raw core vs Rouge on the same
  core with substitution forbidden.
- **M57 Cognitive kernel.** Task understanding, then a plan, then
  self-correction, then synthesis, inside one answer with no visible stages.
  An authenticated `/api/rouge` streaming endpoint (same-origin, rate
  limited, RLS-scoped conversation storage).
- **M58 Adaptive reasoning.** An effort controller replaces
  `defaultEffort`. It must match DEEP accuracy on the hard families with
  fewer calls and tokens than always-DEEP, and xhigh never becomes a default.
- **M59–M60 2M managed context.** A context ledger with exact source
  references and an index (lexical first, then semantic), plus a working-set
  selector bounded by the core's native window. Paging operations: page
  in/out, pin, recall, rehydrate, cross-check. Pinned segments are never
  compressed.
- **M61 Memory.** Working, episodic, semantic, procedural and strategic
  planes. Only verified content is promoted to semantic memory.
- **M62 Response intelligence.** Evolvable response policies, graded by
  rubric verifiers and preference pairs, never by the model grading itself.
- **M63 Verifier.** Adaptive depth: factual, citation, math, code,
  consistency, constraints, counterexamples.
- **M64 Teacher lab.** Needs a legitimate teacher credential. Lessons are
  extracted from verified comparisons; teacher outputs are never memorised.
- **M65 Self-play.** Solver vs falsifier, researcher vs skeptic, coder vs
  bug generator, writer vs editor, retriever vs needle hider, planner vs
  constraint perturber. An independent verifier decides each round.
- **M66 Training compiler.** Train, dev, holdout and adversarial splits,
  deduplicated and checked for contamination.
- **M67 RSI v2 for Rouge.** Champion/challenger on every policy, with
  rollback on regression.
- **M68 Meta-RSI.** Learn which remedy works for which gap.
- **M69 Long-context suite.** 128k up to 2M managed context.
- **M70 Certification.** Raw core vs Rouge across unrelated domains.
- **M71 Multimodal.** Only after Grok image input is verified.
- **M72 AI/Agent UX.**
- **M73 Polish and security.**
- **M74 Reliability and capacity.**
- **M75 Billing and release.**

M73–M75 add no new intelligence architecture.

## 5. Core migration

Rouge's memory, policies, RSI history and identity belong to Rouge, not to
the core. A new core is never switched in automatically. The decision needs
three runs on the same tasks:

1. the raw new core;
2. Rouge on the current core;
3. Rouge (candidate) on the new core.

The core changes only when the third run beats the second on the
certification suite with no regression in any domain. The switch is a policy
version (`RougePolicy.core`) plus `ROUGE_CORE_MODEL`, never a silent change.

## 6. Owner decisions (2026-09-27)

The owner decided two things.

1. **Teacher.** The Claude development session is the teacher, trainer and
   designer. It writes Rouge's policies, tasks, verifiers and training
   material directly into this repository. Everything it writes goes
   through the same gates as everything else:
   - code-checked tasks;
   - independent verifiers;
   - blind holdouts before promotion.

   Its lessons are labelled `teacher: claude-session`. An Opus 5.5 API
   teacher (M64) is added only if a legitimate credential is configured.

2. **Core when Grok 4.6 cannot answer.** Rouge uses a similarly strong or
   stronger core, chosen by measurement, not by reputation. This works
   through the **core ladder** (M56.1):
   - Grok 4.6 is asked first.
   - When it refuses before answering (no credit, unknown model, outage,
     rate limit), the measured substitutes answer in order.
   - A core without credit is skipped for 10 minutes, then asked again.
   - Every substituted answer is labelled with the core that served it.
   - Evaluations never leave the named core.

   The order of the substitutes comes from the core selection tournament:
   - `rouge-eval.yml` with `mode=core-selection`;
   - 21 teacher-written, code-checked tasks across 9 families;
   - to be eligible, a core must answer every task and get at least 80%
     right.

   The result is recorded in `MEASURED_SUBSTITUTES`, with the run it came
   from.

Live results so far (M56 foundation eval, substitution forbidden):

| Run         | Core                              | Raw   | Rouge | Notes                                                                                                                                   |
| ----------- | --------------------------------- | ----- | ----- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 36321530627 | `grok-4.6`                        | —     | —     | `insufficient_credit` on raw and Rouge; stopped after 2 calls                                                                           |
| 36321535200 | `nemotron-3-ultra-550b-a55b:free` | 2 / 2 | 2 / 2 | Served core = named core. Rouge adds about 190 input tokens (identity) and wrote longer replies to "number only" prompts: an M62 target |

### Core selection tournament (run 36324746302, 2026-09-27)

The tournament ran 21 teacher-written, code-checked tasks across 9 families. Each core ran through Rouge with substitution forbidden and had a 12-minute budget.

| Core                              | Correct | Strict | Median | Result                                |
| --------------------------------- | ------- | ------ | ------ | ------------------------------------- |
| `nemotron-3-ultra-550b-a55b:free` | 21/21   | 21/21  | 8.7 s  | **Eligible: the measured substitute** |
| `laguna-s-2.1:free`               | 16/21   | 16/21  | 2.0 s  | Below 80%                             |
| `k2-horizon:free`                 | 13/21   | 13/21  | 60.9 s | Hit the time budget                   |
| `gemini-3.6-flash:free`           | 11/21   | 11/21  | 60.6 s | Hit the time budget                   |
| `qwen3.6-plus:free`               | 10/21   | 10/21  | 60.6 s | Hit the time budget                   |
| `mimo-v2.6-pro:free`              | 3/21    | 3/21   | —      | `provider_unavailable`                |
| `kimi-k3:free`                    | 2/21    | 2/21   | —      | `rate_limited`, unavailable           |
| `grok-4.6`                        | 0/21    | 0/21   | —      | `insufficient_credit`                 |
| `deepseek-v4-pro:free`            | 0/21    | 0/21   | —      | `provider_unavailable`                |
| `glm-5.3-flash-thinking:free`     | 0/21    | 0/21   | —      | `provider_unavailable`                |
| `step-3.7-flash:free`             | 0/21    | 0/21   | —      | `provider_unavailable`                |

`MEASURED_SUBSTITUTES` is `["nemotron-3-ultra-550b-a55b:free"]`. Grok 4.6 is still asked first. The substitute answers only while Grok refuses, and every answer it gives is labelled with the model that served it.

These tasks are easy for a strong core. That is fine for choosing a core, but it cannot show what Rouge adds. The M57 benchmark uses harder, procedurally generated blind tasks for that.

## 7. M56 as delivered

- `src/lib/rouge/*`:
  - the foundation contracts;
  - `UnoRouterFoundation` (pinned core, reasoning effort per request,
    `fallback: false` for evaluations);
  - `RougePolicy` p0: quick, standard, deep and ultra map to low, medium,
    high and xhigh, and only "ultra" reaches xhigh;
  - the truthful identity instruction;
  - content-free telemetry.
- `models/unorouter.ts` has two additive options:
  - `reasoningEffort` per provider instance;
  - `fallback: false`, which keeps a pinned model on its own model.

  Existing behaviour is unchanged when neither is set.

- `ROUGE_CORE_MODEL`: the core, default `grok-4.6`.
- `evals/rouge-foundation.eval.ts` and `.github/workflows/rouge-eval.yml`: a
  raw core vs Rouge live evaluation. It is manual, prints metadata only and
  forbids substitution.
- Tests:
  - `tests/rouge-foundation.test.ts`;
  - `tests/unorouter.test.ts` (a pinned core with no fallback).

M56 adds no cognition by design, so Rouge and the raw core should score the
same on it. What M56 measures is integrity:

- the served core equals the named core;
- effort maps as specified;
- refusals are reported honestly;
- the identity instruction adds a fixed token overhead.

## 8. M57 cognitive kernel

M57 is not done when the code is. It is done when a blind benchmark on the
same core shows that Rouge is measurably more capable than the raw core.

**Status (2026-09-28):** the kernel is merged at the owner's request, and p1
stays the default.

- The first development run could not be scored: rate limits hit, and the
  raw core got every task it answered right.
- The benchmark was made harder and retries were added.
- p2 becomes the default only after it passes a holdout run. M57 stays open
  until then, and M58 does not start.

### What the kernel does (policy p2, `src/lib/rouge/kernel/`)

1. **Task model** (`task-model.ts`). One quick call analyses the task before
   anything is solved:
   - its kind (computation, logic, code, knowledge, analysis, writing,
     conversation);
   - the goal, the givens and the constraints;
   - the pitfalls a careful solver could still fall into;
   - a difficulty from 1 to 5;
   - two or three genuinely different approaches.
2. **Approach search** (`cognition.ts`). Computation, logic and code tasks go
   to independent solvers, one approach each, in parallel. Each solver is
   briefed with the task model and ends with a committed `FINAL ANSWER`.
3. **Uncertainty** (`answers.ts`). Rouge measures how far the approaches
   agree. Formatting differences such as `1,234` against `1234` do not count
   as disagreement.
4. **Metacognition.**
   - When the approaches disagree, an adjudicator re-derives the answer, audits
     each attempt and names the first error in each wrong one. It never goes
     by the majority.
   - When the approaches agree on a task of difficulty 4 or more, a verifier
     checks the answer by an independent method. A dissent overturns the
     answer only if a fresh solver agrees with the verifier.
5. **Synthesis.** One clean answer, with no attempts, solvers or checks shown.
   When the person fixed a short answer ("number only"), the checked answer
   itself is the reply. The M57 contract check and its one repair round still
   guard the final shape.

Conversation, writing and open questions are answered in one call, briefed
by the task model. Small talk and `effort: quick` skip the kernel entirely.

Streaming shows activity labels only: "Understanding the task", "Exploring 3
approaches", "Cross-checking the approaches", "Verifying", "Writing the
answer". Telemetry records what the kernel did: mode, task kind, difficulty,
approaches, confidence, adjudicated, verified, corrected and calls. It never
records content.

The policies:

| Policy | What it does                                                       |
| ------ | ------------------------------------------------------------------ |
| p0     | The foundation alone: the baseline                                 |
| p1     | Answer contracts and quick small talk, one call                    |
| p2     | p1 plus deliberation; the default only if it passes the gate below |

### The capability gate (`evals/rouge-m57.eval.ts`, `rouge-eval.yml` mode `capability`)

**Sides.** Every task is answered by three sides, all on the same core with
substitution forbidden:

- **raw**: one call, with the task as the only message and no system prompt;
- **sc**: self-consistency, meaning five raw samples and a majority vote over
  the answers as the checker reads them. This is the strongest simple
  baseline at a similar call budget, so a gain over raw cannot be put down to
  "more calls" alone;
- **rouge**: Rouge p2.

**Tasks** (`evals/rouge/m57-benchmark.ts`). Ten families: exact arithmetic,
date offsets, weekdays, letter counts, modular powers, base conversion,
knights and knaves, race orderings, Python program tracing, and list
operations.

- Every task is generated from a seed and every answer is computed by code.
- No task is written by hand and no model judges an answer.
- The puzzles are generated with a solver and kept only if exactly one
  solution fits.
- The trace, date and weekday answers were checked against CPython.
- The checker is lenient about format, because it measures whether the
  answer is right. It reads every side the same way.

**Blindness.**

- `dev` uses the fixed seed `m57-dev-1`. It is for calibration and debugging
  only and can never pass the gate.
- `holdout` uses a fresh random seed on every run. The seed is recorded in
  the evidence only after the run.
- Nothing in `src/` imports the benchmark (a test enforces this). The
  kernel's prompts are general-purpose and name no task family.
- A holdout seed is used once. If the kernel changes after a holdout run, the
  next run needs a new seed.

**Contamination.** A holdout task may not equal:

- any development task;
- any core-selection task;
- any M57 contract-holdout task.

The eval asserts this.

**Gate.** Fixed before the first holdout run. It is decided on the holdout,
comparing Rouge with raw on the tasks both completed. All of the following
must hold:

1. At least 90% of the tasks completed on both sides.
2. The lower bound of the 95% paired-bootstrap interval of the accuracy
   difference is above 0.
3. McNemar's exact test gives p < 0.05.
4. At least 3 of the 10 families improved.
5. No family lost more than one task.

**Reporting.** Rouge against self-consistency is always reported next to the
gate, so the gain can be attributed honestly: to structure, or to extra
samples.

Logs are public and hold metadata only: per-task verdicts, calls, latencies
and kernel metadata. They never hold a prompt or an answer.
