# OSIRUS — Security Audit (Preliminary: code + DB + CI level)

Audit date: 2026-10-01 · Ref: `main` @ `716f1f7`, Neon project `super-voice-69875601`
Scope so far: static/authorized review of auth, API surface, DB/RLS, secrets, dependencies surface, workflows. **Phase F dynamic red-team (live reproduction, exploit PoCs, regression tests) is pending and will append to this file.** Certification gates (CRITICAL=0, HIGH=0, …) are NOT yet met until DB-1/DB-2 are resolved and Phase F completes.

## Summary

| Severity | Count | IDs |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 2 | DB-1, DB-2 |
| MEDIUM | 3 | AUTH-1, CONN-1, CICD-1 |
| LOW | 6 | AUTH-2, AUTH-3, AUTH-4, DB-3, DB-4, CICD-2 |
| INFO | 5 | AUTH-5, AUTH-6, DB-5, DB-6, CONN-4 |

No hardcoded secrets found (repo read + env surface + workflow review; caveat: GitHub code search does not index this repo, so scanning was by enumeration). No CRITICAL issues identified at code level.

## Findings

### HIGH

**DB-1 — RLS trust root uses forgeable session GUCs.** `is_system()` and `current_user_id()` derive from `current_setting('app.osirus_system')` / `current_setting('app.current_user_id')`. Any session able to run SQL (SQLi, leaked connection string, compromised worker) can `SET app.osirus_system='true'` for full cross-tenant access; custom GUCs cannot be privilege-restricted for plain `SET`. *Fix:* derive identity from a non-forgeable source (signed JWT verified inside a SECURITY DEFINER function, or hash-challenge the system flag); ensure app uses `SET LOCAL` per transaction; never expose raw SQL.

**DB-2 — RLS enforcement depends on the app always assuming `osirus_app`.** The only login-capable app role is `neondb_owner` with `BYPASSRLS=true`; `osirus_app` is NOLOGIN. Any code path connecting as owner without `SET ROLE osirus_app` silently voids all tenant isolation. *Fix:* verify every request path sets the role (add a regression test + runtime assertion); prefer a dedicated LOGIN role without BYPASSRLS; reserve owner for migrations.

### MEDIUM

**AUTH-1 — Publicly-known fallback cookie secret.** `src/lib/auth/server.ts` builds the auth instance with literal fallback secret `"osirus-build-only-cookie-secret-not-for-production-000000"` when `NEON_AUTH_COOKIE_SECRET` is unset. Route gates mitigate, but `auth.middleware()` in `src/proxy.ts` runs without that gate — partial misconfiguration could accept cookies signed with a public secret. *Fix:* throw at startup in production when secret missing; proxy fails closed when `!authConfigured`; remove deterministic fallback.

**CONN-1 — `OSIRUS_CONNECTOR_KEY` undocumented.** Absent from `.env.example` and `src/lib/env.ts`; fresh deployments silently disable all connections (fails closed but invisible). *Fix:* document + validate with `min(32)`.

**CICD-1 — Stale secret-bearing workflow triggers on dead branches.** `sync-runtime-configuration.yml` (Vercel/DB secrets in scope) fires on pushes to `build/m1-m5-production-gate`; `foundry.yml`/`live-evals.yml` key off other dead build branches. *Fix:* remove refs, then delete the 34 merged branches.

### LOW

- **AUTH-2** — Duplicate dead `proxy.ts` at repo root with wrong matcher (`/app/:path*` misses `/app`); if ever activated it regresses the issue-#26 OAuth login loop. *Fix:* delete.
- **AUTH-3** — `verifyBearer` (`src/lib/auth/session.ts`) validates no issuer/audience; possibly unused. *Fix:* add iss/aud or remove.
- **AUTH-4** — merged into CONN-1 (env drift list also includes `OSIRUS_FREE_MODEL_*`, `ROUGE_CORE_MODEL`, `ROUGE_SUBSTITUTE_CORES`, `CRON_SECRET`, `OSIRUS_UI_FIXTURES`).
- **DB-3** — No IP allowlist on Neon project; `production` branch not marked protected; public connections not blocked. *Fix:* enable `allowed_ips`, protect branch.
- **DB-4** — All `osirus` functions rely on default PUBLIC EXECUTE (fragile; mitigated by missing schema USAGE). *Fix:* explicit `REVOKE … FROM PUBLIC; GRANT EXECUTE TO osirus_app`.
- **CICD-2** — `ci.yml` has no explicit `permissions:` block; hardcoded Vercel team/project IDs in 4 workflows; `software-rsi.yml` (runs model-generated patches) is well-hardened but has wider-than-needed `issues:write`/`actions:write`. *Fix:* set `permissions: contents: read`, move IDs to `vars`, trim software-rsi perms.

### INFO

- **AUTH-5** — Cookie flags are library-managed (Better Auth defaults: HttpOnly, SameSite=Lax, Secure in prod); assert flags in prod e2e.
- **AUTH-6** — No app-level rate limit on sign-in/up; relies on provider defaults — confirm provider-side throttling.
- **DB-5** — PITR window 6h (free plan); raise for production.
- **DB-6** — `attachments.content` bytea in-DB; consider object storage at scale.
- **CONN-4** — GitHub token redaction from workspace logs verified good.

## Verified-strong areas (explicitly checked, no issue found)

- OAuth state/PKCE provider-owned; all callback/redirect URLs hardcoded — **no open-redirect surface**; error codes regex-whitelisted before render (no XSS).
- OAuth callback flow correct: verifier exchange in active `src/proxy.ts`; prod e2e confirms full lifecycle. **No login loop in code.**
- CSRF: `hasSameOrigin` fails closed on all mutations.
- Scheduler endpoint: `timingSafeEqual`, fails closed unconfigured, GitHub OIDC with full claim pinning.
- Webhooks: HMAC verified before body read; indistinguishable failures.
- Connector tokens: AES-256-GCM at rest, never echoed; verified-before-stored.
- Security headers/CSP strong (`frame-ancestors 'none'`, HSTS prod, COOP/CORP, restrictive Permissions-Policy).
- Prompt-injection surface: `asPromptContext` fencing is the only tool-output path to the model; attachments labeled untrusted; MCP descriptions sanitized/capped; SSRF guard with DNS-rebinding resistance; sandbox deny-all network by default; generated tools quarantined read-only.
- DB: RLS ENABLED+FORCED on all 81 app tables; 180 policies; append-only audit tables; no plaintext credential columns; migrations consistent with checksums.
- CI: no `pull_request_target`; no event-data shell injection; OIDC-to-production (no prod secrets in GitHub); token masking; traces off on prod journeys.
- Neon Auth managed schema grant-isolated; no session-fixation surface; server-side logout invalidation verified by e2e.

## Phase F backlog (dynamic red-team — next stage)

1. Live reproduction of AUTH-1 partial-misconfig path; DB-1/DB-2 role-assumption regression tests.
2. IDOR/tenant-crossover probes against API routes (per-route authz matrix).
3. Rate-limit bypass, replay, oversized-payload, timeout-abuse tests on `/api/*`.
4. Upload abuse: path traversal, content-type confusion, archive bombs, prompt injection via files.
5. Agent-security: malicious MCP server responses, poisoned memory, confused-deputy via connections, cross-workspace memory leakage (`workspace_id IS NULL` rows).
6. Dependency audit (`npm audit`) + supply-chain review of `package-lock.json`.
7. Billing-adjacent: entitlement bypass and usage-ledger race conditions (no Stripe yet).
8. `npm run build` + full test suite verification of any fix before CLOSED status.
