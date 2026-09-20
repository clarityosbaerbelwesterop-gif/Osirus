# Osirus

Osirus is a tenant-isolated agent operating system built as a modular Next.js application with a durable runtime, internal multi-tier memory, progressive skill disclosure and an event-driven ChatHub.

## Architecture invariants

- Neon/PostgreSQL is authoritative for durable runtime state; the browser is a projection.
- Runtime progress is append-only evidence, not simulated UI state.
- Memory is tenant-scoped and provenance-aware. The current recovered embedding column is JSONB and is **not** represented as vector search.
- Skills are progressively selected and capped at eight per stage by default.
- Secrets stay server-side and generated execution never runs inside the production web process.

## Database recovery

The existing `osirus-m1-m5-verify` schema was inspected and reconstructed into `db/migrations`. `000_recovered_schema.sql` is the canonical table/constraint/index recovery snapshot; `004_security_rls.sql` contains recovered helper functions, FORCE RLS policies and triggers.

## Development

Copy `.env.example` to `.env.local`, provide server-side values, then run `npm install && npm run dev`.
