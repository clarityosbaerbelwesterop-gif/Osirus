# OSIRUS — Connections & MCP Audit

Audit date: 2026-10-01 · Ref: `main` @ `716f1f7` · All findings code-verified.

## Verdict

The connections/MCP system is **REAL end-to-end** — client, credential storage, health checks, UI, and permission model all exist. **Nothing found that is advertised-but-unimplemented.** No fake MCP capability.

## Connection inventory

| Connector | Real? | Permissions | Writes external data? | Approval required? |
|---|---|---|---|---|
| MCP servers (user-added, Streamable-HTTP) | ✅ Real (`src/lib/tools/mcp.ts`, `src/lib/connectors/mcp-store.ts`) | All MCP tools forced `external`/`high` risk | Yes (depends on server) | **Yes — every call** |
| GitHub (fine-grained PAT) | ✅ Real (`src/lib/connectors/github.ts`) | `repo:read` / `repo:write` grants in `osirus.connector_grants` | Yes — `git.deliver` (branch/push/PR) | Write ops: grant **and** per-run approval; protected-branch + no-force-push rules |
| Vercel / Neon / Supabase (PAT) | ✅ Real (`src/lib/connectors/platform.ts`) | **Read-only tools only by design** | No | Reads need no approval (deliberate) |
| Outbound webhooks | ✅ Real (`src/lib/webhooks/`) | HMAC-signed deliveries, idempotent records | Yes (delivery) | Endpoint creation is user action |
| MCP Registry search | ✅ Real (`src/lib/connectors/mcp-registry.ts`) | Official registry, streamable-http remotes only | No | n/a |

## MCP hardening (verified)

- Real Streamable-HTTP JSON-RPC: initialize/session/SSE; paginated `tools/list` (≤256 tools, ≤10 pages).
- Namespaced tool IDs (`mcp:server/tool`) — cannot shadow builtins.
- **Definition fingerprinting:** sha256 of tool definition re-verified *before every call* (`assertToolUnchanged` → `McpToolChangedError` → tool auto-disabled).
- Per-tool review/enable flow; DB refuses enabled-without-review.
- Descriptions sanitized, quoted, capped; injection-flagged.
- Display URLs mask query parameters.

## Credential storage

| Secret | Location | Encryption | Scope |
|---|---|---|---|
| MCP bearer tokens | `osirus.mcp_servers.credential_reference` | AES-256-GCM (`src/lib/connectors/crypto.ts`), key = `OSIRUS_CONNECTOR_KEY` env | workspace + RLS |
| GitHub PAT | `osirus.connector_installations.credential_reference` | same | org+workspace |
| Vercel/Neon/Supabase PATs | same | same | org+workspace |
| Webhook signing secrets | `osirus.webhook_endpoints.secret_sealed`, shown once | same | workspace |
| Model provider keys | env only (`UNOROUTER_API_KEY_1..3`), never in DB | n/a | deployment |

DB spot-check confirms sealed envelope references (`v1.…` prefixes), no provider-token shapes (`ghp_`, `github_pat_`) stored. No plaintext credential storage found anywhere.

## Connections UI

Real: `src/app/app/connections/page.tsx` + `github-card` / `platform-card` / `mcp-manager` / `webhooks-card` components. States `CONNECTED / DEGRADED / EXPIRED / NOT_CONNECTED / NOT_CONFIGURED` (`src/lib/ui/connection-state.ts`), health line (never green without a real check), last-used (`lastToolCallAt`), reconnect / "Change access" / disconnect flows, per-tool review toggles with injection flags.

## Findings / gaps

| ID | Severity | Issue | Recommendation |
|---|---|---|---|
| CONN-1 | MEDIUM (operability) | `OSIRUS_CONNECTOR_KEY` missing from `.env.example` and zod env schema — fresh deploys silently show all connections NOT_CONFIGURED (fails closed, but invisible) | Add to `.env.example` + `src/lib/env.ts` with `min(32)` |
| CONN-2 | LOW | Reads need no approval (deliberate); exfil path is read-then-external-write — mitigated by approval ledger on writes | Document the design decision in security model |
| CONN-3 | LOW | Approvals are exact-input-bound; no "approve for rest of run" option — heavy for interactive use | Consider scoped approval grants (design tradeoff) |
| CONN-4 | INFO | GitHub token passed via credential-helper env, redacted from workspace logs — verified good | — |
