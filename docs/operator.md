# Operating Osirus

This page is for the people who run the deployment. It explains the switches, what the Intelligence Foundry does on its own, where its limits are, and what to do when something goes wrong.

## Planes

**Product Plane.** What customers use: chat, runs, arms, tools, connections, automations. A product run makes one read of the Intelligence Plane while it plans: the active or canary strategy version for its arm. That read is cached for 60 s, times out after 800 ms, and falls back to the baseline strategy. Nothing else on the request path depends on the Foundry.

**Intelligence Plane.** The Foundry. It lives in the `osirus_intel` schema. Only the system writes there; operators can read it.

It measures capabilities, proposes and tests strategy changes, generates evaluation tasks, compiles what it learned, and promotes winners inside the lab. It never changes the following, and no code path exists for it to do so:

- authentication, authorization, RLS
- secrets and credentials
- billing and payments
- DNS
- destructive database operations

## Becoming an operator

Operators are rows in `osirus_intel.operators`, keyed by `osirus.users.id`. No route can create one. Add one with SQL as the database owner:

```sql
insert into osirus_intel.operators (user_id) values ('<user uuid>');
```

For everyone who is not an operator, `/internal/intelligence` and `/api/internal/intelligence/*` answer 404.

## The Intelligence Lab

The lab lives at `/internal/intelligence`. It shows:

- **Status:** switches, today's usage against the budgets, provider pauses
- **Current cycle:** the phase stepper and its log
- **Capability map:** each capability, with "held back by" for the weaker capabilities it depends on
- **Research agenda**
- **Experiments:** champion vs challengers, per partition, with P(better)
- **"Why did Osirus improve?":** one record per cycle, including cycles that found nothing
- **Strategy evolution**
- **Curriculum, self-play and red-intelligence runs**
- **Datasets and learning artifacts**
- **Models and training status**
- **Promotions and rollbacks**

Controls:

- **Run a tick now** (production deployment only).
- **Subsystem switches.** Training cannot be switched on while no real training provider exists; the server refuses it.

## How the Foundry runs

It runs inside the existing M20 scheduler tick (`/api/scheduler/tick`). There is no separate scheduler. Each tick:

1. Starts due automations.
2. Closes stuck runs:
   - a plan that died with no stages is marked failed (`planning_interrupted`);
   - a run whose stages all settled but that was never closed is finalized.
3. Runs one bounded Foundry step (60 s):
   - collect settled trials;
   - start the next trial;
   - advance the research cycle one or more phases.
4. Claims stages. Product stages go first: Foundry runs have `runs.priority = -1`.
5. If Foundry work moved in this tick and the day's continuation budget allows, requests the next tick. The server makes this request itself, after the response, with the scheduler secret. It never happens from a preview deployment.

The daily Vercel cron (03:00 UTC) starts a new chain every day.

### Trials

A trial is an ordinary run in the **Foundry workspace**:

- It belongs to the first operator, in its own organization named "Osirus Foundry", so it is never that person's default workspace.
- Its policy allows reading and sandbox work and denies everything else: no pushes, no deploys, no MCP calls, no external writes.
- Foundry runs never write memory, never notify anyone and never trigger automations. Memory one trial wrote would otherwise leak into the next trial and break the comparison.

Each trial is judged independently of the agent's own verdict:

- **Coding:** hidden tests run in the workspace after the agent finishes.
- **Math:** the computed value.
- **Text:** required and forbidden content.

### Cycle phases

`measure → select_agenda → generate_data → baseline → analyze → hypothesize → design → dev_eval → adversarial_eval → holdout_eval → decide → update_registry → compile → next`

Every phase is checkpointed in `research_cycles`. A crash mid-step:

- keeps the failure in the cycle log;
- releases the cycle lease;
- puts trials that had no run behind them back in the queue.

The next tick continues from the checkpoint.

### Decisions

A challenger wins only if all of the following hold:

- on the core partitions (dev and holdout together), it has at least 3 paired tasks and the posterior P(challenger better) is at least 0.85;
- it has more challenger-only successes than champion-only successes;
- holdout is not worse;
- adversarial is not worse by more than one task;
- false completions do not increase.

Otherwise the decision is:

- **regressed**, when P(better) is 0.15 or less;
- **inconclusive**, when the evidence is too thin;
- **no improvement**, when no challenger passed the dev screen.

Provider refusals are never counted as evidence.

## Models and quota

The Foundry runs on `deepseek-v4-pro-0813:free` (the operator's decision of 2026-09-23). That pool allows about one request per minute. It also refused further calls after about 90–100 calls a day (observed 2026-09-23); the published docs mention daily budgets that reset at midnight UTC.

When the provider refuses a call:

- the stage parks (`BLOCKED`) for as long as the provider asked, and keeps its loop state;
- the trial goes back in the queue uncounted;
- the Foundry records `providerPause` (code, until, calls seen that day) and starts nothing new until it lifts.

Default budgets are in `osirus_intel.settings`. Change them in the lab or with SQL:

| Budget                | Default | Why                                        |
| --------------------- | ------- | ------------------------------------------ |
| `dailyModelCalls`     | 90      | Under the free pool's observed limit       |
| `dailyChainedTicks`   | 36      | Each tick holds a function for up to 300 s |
| `dailySandboxMinutes` | 180     |                                            |
| `parallelTrials`      | 1       | The rate limit is per account              |

At these budgets a coding cycle (~250–300 calls) takes about three days and a math cycle about one day. Both are durable across days.

**Paid models** (`paidModelEmergency`) are an operator's emergency switch. They are off by default, and the runner refuses a non-free Foundry model unless that switch is on. Keys are never rotated to get around a limit.

## Product canaries

Low-risk assets reach customers only through a canary. The steps are 1 → 5 → 20 → 50 → 100 %; the bucket is a deterministic hash of the run id.

- **Start.** Needs all of:
  - `autoCanary` is on;
  - the lab champion is low risk;
  - it was verified on the product's own model (`productModel`).
- **Advance.** One step per pass, after 20 judged product runs at that step. Product runs contribute metrics only, never content.
- **Roll back** to `degraded` when the canary's verified rate is more than 10 points below the baseline over the same period.

While the product model has no credit, no candidate can be verified on it, so no canary starts. That is intended.

## Connections and events

| Connection             | What it grants                                       | How it is stored                                                                   |
| ---------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| GitHub                 | Clone; optional push and PR, each behind an approval | Sealed token, grants in `connector_grants`                                         |
| Vercel, Neon, Supabase | Read-only listing tools                              | Sealed token, verified live on connect; health recorded                            |
| MCP servers            | Tools reviewed one by one; every call asks           | Sealed bearer token; the Registry search offers https Streamable HTTP remotes only |
| Webhooks               | Start automations                                    | Sealed signing secret, shown once                                                  |

Webhook receivers live at `/api/hooks/<endpoint id>`.

- **Signature schemes:**
  - GitHub: `X-Hub-Signature-256`.
  - Vercel: `x-vercel-signature`.
  - Generic senders: `x-osirus-timestamp` plus `x-osirus-signature = sha256=HMAC(secret, timestamp + "." + body)`, accepted within a 5-minute window.
- **Replays.** A delivery id is accepted once.
- **Payload handling.** Only strictly validated fields reach the automation's objective: event kind, repository, ref, sha and status. Free text from the payload never does.

`OSIRUS_CONNECTOR_KEY` must be set for any stored credential. Without it, connections say so; they never fall back.

## Attachments

- **Limits.** Up to 10 MB per file, and 100 files per day on the free plan (`osirus.entitlements`).
- **Type detection.** The type comes from the bytes.
- **Supported formats.** PDF text is extracted per page; CSV, JSON, text, Markdown and code are chunked. Images are stored; the configured model does not read them, and the UI says so.
- **How runs use them.** A run retrieves only the passages that match its objective (full-text ranking, 12,000-character budget). They are labelled as untrusted file content. Attached CSV or JSON routes the run to the math/data arm first.

## Computer arm

Building QA and the `computer.inspect` tool drive Chromium inside the sandbox VM, at localhost:

- The browser is `playwright-core` with `@sparticuz/chromium`, installed from the npm registry on first use.
- If the browser cannot start, QA falls back to the HTTP check and records why.
- To check the VM path end to end, push a commit whose message contains `[run-computer]`.

## Evidence runs in CI

`.github/workflows/foundry.yml` runs on a push whose commit message contains:

| Marker           | What runs                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `[run-foundry]`  | Real Foundry cycles on the free model. Math first, then coding. Store snapshot, log and report are uploaded as artifacts. |
| `[run-computer]` | The live computer-arm check.                                                                                              |

## Troubleshooting

| Symptom                                 | Where to look                                                                                                         |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Lab says "Provider paused until …"      | The free pool refused. Wait for the time shown, or clear the pause in the lab after checking the provider.            |
| No cycle advances                       | Check `osirus_intel.settings.flags.intelligencePlane`, an operator row, and today's `resource_ledger`.                |
| A trial run stays open                  | It is probably parked on a provider refusal. Runs open longer than 30 h are judged as timed out and stopped.          |
| Tick returns `foundry.waiting: "error"` | The Foundry step threw. The product part of the tick still ran. Check the function logs for the tick.                 |
| Webhook returns 401                     | Wrong secret, a stale timestamp (generic), or the endpoint was deleted. The two cases get the same answer on purpose. |
