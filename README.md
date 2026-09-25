# Osirus

Osirus is a tenant-isolated agent operating system built as a modular Next.js application with a durable runtime, internal multi-tier memory, progressive skill disclosure and an event-driven ChatHub.

## Architecture invariants

- Neon/PostgreSQL is authoritative for durable runtime state; the browser is a projection.
- Runtime progress is append-only evidence, not simulated UI state.
- Memory is tenant-scoped and provenance-aware. The current recovered embedding column is JSONB and is **not** represented as vector search.
- Skills are progressively selected and capped at eight per stage by default.
- Secrets stay server-side and generated execution never runs inside the production web process.

## Database migrations

The ordered migration chain in `db/migrations` is the source of truth for a clean Osirus database:

- `000` bootstraps the extension and schema.
- `001` through `003` create the core runtime, memory/capability, and skill/connector entities.
- `004` adds security helpers, FORCE RLS policies, and update triggers.
- `005` adds the production runtime durability functions and indexes.
- `006` adds the database-backed, fail-closed mutation rate-limit store.
- `007` provisions the `osirus_app` role that makes those policies enforceable.
- `008` adds the durable workflow engine: DAG edges, leases and the atomic
  stage claim.
- `009` separates the retry ceiling from the slice ceiling and records
  verification verdicts with their evidence.

Neon Auth must be enabled before applying the chain because `osirus.users` is linked to the Neon Auth user table.

Apply the chain with `DATABASE_URL=... node scripts/apply-migrations.mjs`. Each
file is recorded in `osirus.schema_migrations` with a checksum, so reruns are
no-ops and a file edited after it was applied is reported rather than skipped.
`--dry-run` lists what is pending without executing anything.

### Row-level security depends on the connecting role

`004` enables `FORCE ROW LEVEL SECURITY` on every table, but Neon's managed
owner role carries the `BYPASSRLS` attribute, which skips policy evaluation
outright — `FORCE ROW LEVEL SECURITY` does not override it, and Neon does not
permit clearing it from the owner. Connecting as the owner therefore leaves all
policies inert: a probe run that way could read and delete another tenant's
rows.

`007` creates `osirus_app` without that attribute, and `queryAs`/`querySystem`
in `src/lib/db/client.ts` assume it for the duration of each transaction, in the
same statement that sets the tenant GUC. System work keeps its cross-tenant
reach through `osirus.is_system()`, which the policies evaluate — it does not
bypass them. Any new database entry point must go through those two helpers; a
connection that skips the role switch silently disables tenant isolation.

## Execution

A run is a DAG of stages in the database, not a function call. `POST
/api/runtime` plans the run, writes the graph, and then claims and executes
stages one at a time under a lease it renews, until the work is gone or the
request nears its deadline. It then returns with the run intact. Nothing about
finishing a run depends on that request surviving.

`osirus.claim_next_stage` is what makes several workers safe: it takes one
runnable stage with `FOR UPDATE ... SKIP LOCKED`, checks its dependencies in the
same statement, and mints a per-claim `lease_token`. Every later write is fenced
on that token, so a worker that stalled and woke up after its stage was
reclaimed cannot overwrite newer work -- it is told the lease is gone and
discards its result.

Two counters bound a stage. `attempt_count` bounds retries after a failure;
`slice_count` bounds how many times a stage may yield and resume. Keeping them
apart is what lets a stage allowed a single attempt still run in several slices.

Work nobody is holding is recovered two ways. The client's existing poll of
`GET /api/runtime/[runId]` drains its own run under the caller's own
authorisation. `POST` or `GET /api/scheduler/tick` claims across tenants behind
`OSIRUS_SCHEDULER_SECRET`, executing each stage as the run's owner rather than
as itself; with the secret unset it returns 503, never 200. The `vercel.json`
cron is a daily liveness floor, not the heartbeat -- the poll is.

## Verification

`src/lib/verification/engine.ts` replaces what used to be
`assistant.trim().length > 0`. Checks are typed `STRUCTURE`, `MODEL`, `TOOL`,
`TEST`, `BUILD`, `SOURCE`, `MATH`, `SECURITY` or `COMPOSITE`, and arbitration
over their results is pure, so the rule that decides whether something may be
called verified is unit-tested without a database, a sandbox or a model.

The rules that matter:

- A `MODEL` check alone can never reach `verified`; its ceiling is `unverified`.
- Deterministic evidence outranks model review; a deterministic pass the model
  objects to is `conflicted`, and a deterministic failure is `rejected`.
- A check that throws is `inconclusive`. Treating it as a pass is the exact
  failure this file exists to prevent.
- A cited source the run never retrieved fails. `mathCheck` accepts only methods
  that compute, so a model-reviewed derivation cannot be recorded as a checked
  one.

## Agent arms

`src/lib/arms` holds six specialised arms -- thinking, coding, research,
math/science, building and general -- behind one `AgentArm` interface. An arm
decides which stages exist, what the answering stage is told to produce, and
what counts as evidence at the end; everything else is shared.

The thinking arm produces a schema-validated `TaskAnalysis` through the
`THINKING` model role. That analysis is the plan: its proposed stages become the
graph, its verifier requirements become the checks, and its success criteria
become the acceptance contract the meta verifier grades the finished run
against. It carries conclusions only -- the schema has no field for reasoning,
and none may be added.

`src/lib/runtime/router-v2.ts` scores every arm rather than returning a first
match, so ambiguity is measurable. Compound objectives are segmented on
sequencing connectives and routed per segment, which composes several arms into
one DAG without a model call; a structured classification is escalated to only
when the scores are genuinely close.

## Tools and the sandbox

`src/lib/tools/registry.ts` decides three things before a call happens: whether
the arm may see the tool, whether the input matches its declared schema, and
whether a side-effecting call has an approval behind it. With no approval gate
configured, a side-effecting call does not run -- defaulting to allowed would
make the permission model opt-in. Denials are audited into `osirus.tool_calls`
alongside successes, with metadata rather than arguments and output.

MCP servers are discovered at runtime, with no hardcoded list, and trusted
least. A server names its tools and writes their descriptions; it does not get
to declare its own risk. Every discovered tool is external and high risk, so
every call goes through approval, descriptions are stripped of control
characters and injection fences, and names are namespaced so none can shadow a
builtin. Results reach a model only through `asPromptContext`, which labels them
as data and neutralises any delimiter they contain.

The sandbox is Vercel Sandbox over OIDC federation, so no `VERCEL_TOKEN` enters
the app runtime, and its network policy is deny-all unless a caller names the
hosts it needs. The coding arm writes its generated files there and runs a real
syntax check over them. Where no sandbox is configured -- anywhere outside a
Vercel function -- every command returns a null exit code, the check reports
inconclusive, and the verdict lands at `unverified`. Nothing reports success for
code that was not executed. `/api/health` reports sandbox availability under
`capabilities` without gating `status` on it.

Files, Diff, Terminal and Preview panels are **not built**. They need a sandbox
that outlives a single stage; today one is created and stopped inside the check
stage.

## Development

Copy `.env.example` to `.env.local`, provide server-side values, then run `npm install && npm run dev`.

## Runtime configuration sync

`.github/workflows/sync-runtime-configuration.yml` securely synchronizes the
existing GitHub runtime secrets to the existing Vercel project. It runs only on
the protected production branch, the active production-gate branch, or a manual
dispatch — never on arbitrary pull-request code.

- The Neon Auth base URL and its verified JWKS URL are synced as server-only
  values. They default to the Neon project's own auth endpoint; set the
  `NEON_AUTH_URL` secret only to point at a different project.
- `UNOROUTER_API_KEY_1` through `_3` are synced as sensitive Vercel variables.
  `NEON_API_KEY` remains GitHub-only: it is a Neon management credential, not a
  web-runtime secret.
- `DATABASE_URL` remains owned by the existing Vercel–Neon integration unless a
  GitHub `DATABASE_URL` secret is deliberately supplied.
- Model policy is **free-model-first** (M49). Every `OSIRUS_MODEL_*` role is
  written as `free`: the runtime discovers the verified free models from
  `GET /v1/models` (annotated by the public catalog, never extended by it) and
  serves each request from a bounded pool with health, per-model cooldowns
  (Retry-After honoured), pacing and context-aware selection. Basic operation
  never needs Grok, Opus or paid credit. A paid model is used only if a
  dispatch names a listed ID with `model_policy=configured-first`. After the
  upsert the workflow re-reads Vercel and fails unless all three keys and
  every model role cover production and preview. See
  `docs/provider-diagnostics.md` for the key audit and the safe three-key
  diagnostics workflow (staged in `ops/github-workflows/` until a maintainer
  with the `workflow` scope moves it into `.github/workflows/`), and `/api/readiness` for evidence-based readiness.
- The Neon Auth cookie secret is created once in Vercel if absent and is never
  printed. Its rotation requires an explicit manual-dispatch confirmation because
  it invalidates active sessions; a partially configured target fails closed
  instead of silently rotating an existing secret.
