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

Neon Auth must be enabled before applying the chain because `osirus.users` is linked to the Neon Auth user table.

## Development

Copy `.env.example` to `.env.local`, provide server-side values, then run `npm install && npm run dev`.
