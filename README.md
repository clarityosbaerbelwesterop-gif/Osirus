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

Neon Auth must be enabled before applying the chain because `osirus.users` is linked to the Neon Auth user table.

## Development

Copy `.env.example` to `.env.local`, provide server-side values, then run `npm install && npm run dev`.

## Runtime configuration sync

`.github/workflows/sync-runtime-configuration.yml` securely synchronizes the
existing GitHub runtime secrets to the existing Vercel project. It runs only on
the protected production branch, the active production-gate branch, or a manual
dispatch — never on arbitrary pull-request code.

- `NEON_AUTH_URL` is mapped to the server-only Neon Auth base URL and its
  verified JWKS URL.
- `UNOROUTER_API_KEY_1` through `_3` are synced as sensitive Vercel variables.
  `NEON_API_KEY` remains GitHub-only: it is a Neon management credential, not a
  web-runtime secret.
- `DATABASE_URL` remains owned by the existing Vercel–Neon integration unless a
  GitHub `DATABASE_URL` secret is deliberately supplied.
- The workflow validates the selected model against UnoRouter before syncing all
  Osirus model roles. It defaults to `grok-4.6` with high reasoning. To select
  Opus, set the repository variable `OSIRUS_PRIMARY_MODEL` to the exact,
  currently available UnoRouter Opus 5 model ID, then dispatch the workflow.
- The Neon Auth cookie secret is created once in Vercel if absent and is never
  printed. Its rotation requires an explicit manual-dispatch confirmation because
  it invalidates active sessions; a partially configured target fails closed
  instead of silently rotating an existing secret.
