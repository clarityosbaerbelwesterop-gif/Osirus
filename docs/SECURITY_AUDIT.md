# OSIRUS — Security Audit (code + DB + CI level, Phase F fixes applied)

Audit date: 2026-10-01 · Ref: `main` @ `716f1f7`, Neon project `super-voice-69875601`; fixes on branch `security/phase-f-20261001`.
Scope: static/authorized review of auth, API surface, DB/RLS, secrets, dependencies surface, workflows, followed by Phase F fix work with regression tests. Live production probes against `osirus.vercel.app` were not possible from this environment (egress blocked) and are covered by `prod-journey.yml` plus the remaining backlog below. Certification gates: CRITICAL=0 met; HIGH: DB-2 CLOSED, DB-1 remains a documented residual (no in-Postgres fix exists — see finding).

## Summary

| Severity | Count | IDs                                                                           |
| -------- | ----- | ----------------------------------------------------------------------------- |
| CRITICAL | 0     | —                                                                             |
| HIGH     | 2     | DB-1 (documented residual), DB-2 (**CLOSED**)                                 |
| MEDIUM   | 3     | AUTH-1 (**CLOSED**), CONN-1 (**CLOSED**), CICD-1 (patch ready)                |
| LOW      | 6     | AUTH-2/AUTH-3/AUTH-4/DB-4 (**CLOSED**), DB-3 (operator), CICD-2 (patch ready) |
| INFO     | 5     | AUTH-5, AUTH-6, DB-5, DB-6, CONN-4                                            |

No hardcoded secrets found (repo read + env surface + workflow review; caveat: GitHub code search does not index this repo, so scanning was by enumeration). No CRITICAL issues identified at code level.

## Findings

### HIGH

**DB-1 — RLS trust root uses forgeable session GUCs. (RESIDUAL — documented, not fixable in-database.)** `is_system()` and `current_user_id()` derive from `current_setting('app.osirus_system')` / `current_setting('app.current_user_id')`. Any session able to run SQL (SQLi, leaked connection string, compromised worker) can `SET app.osirus_system='true'` for full cross-tenant access; custom GUCs cannot be privilege-restricted for plain `SET`. **Phase F outcome:** investigated for a hard fix — Postgres offers no secret primitive a same-role session cannot also read, so no in-database mechanism makes the GUC unforgeable without moving identity enforcement out of the session. Rather than ship a fake fix, migration `020_function_execute_grants.sql` carries the residual-risk statement in its header, and the risk is held down by: parameterised-only statements (no path from request data to `set_config`), no raw-SQL endpoint, `osirus_app` NOLOGIN with closed membership, and `SET LOCAL` transaction scoping everywhere (asserted by `tests/migrations.test.ts`). A hard boundary, if ever required, must come from outside the session (separate credentials per trust level or a GUC-owning proxy).

**DB-2 — RLS enforcement depends on the app always assuming `osirus_app`. (CLOSED 2026-10-01.)** The only login-capable app role is `neondb_owner` with `BYPASSRLS=true`; `osirus_app` is NOLOGIN. Any code path connecting as owner without `SET ROLE osirus_app` silently voids all tenant isolation. **Phase F fix:** `tests/db-rls-hardening.test.ts` (9 PGlite tests) proves `queryAs`/`querySystem` assume `osirus_app` in the same transaction as the tenant GUC, two-tenant isolation holds, `querySystem` is policy-mediated, and role membership is closed. Role switch + transaction scoping additionally pinned in `tests/migrations.test.ts`. Remaining hardening (dedicated LOGIN role for the app, owner reserved for migrations) is an operator/Neon action tracked under DB-3.

### MEDIUM

**AUTH-1 — Publicly-known fallback cookie secret. (CLOSED 2026-10-01.)** `src/lib/auth/server.ts` built the auth instance with a literal, repo-public fallback secret when `NEON_AUTH_COOKIE_SECRET` was unset, and `auth.middleware()` in `src/proxy.ts` ran without a configuration gate. **Fix:** the fallback is now a per-process `randomBytes(32)` secret (an unconfigured deployment can issue no stable, forgeable cookies across restarts and fails closed at the edge), and `src/proxy.ts` returns 500 when `!authConfigured` instead of running middleware. **Regression tests:** `tests/auth-config.test.ts` (no public fallback, random 64-hex per-instance secret, configured path verbatim), `tests/proxy-guard.test.ts` (fail-closed 500, delegation, request-id echo/mint).

**CONN-1 — `OSIRUS_CONNECTOR_KEY` undocumented. (CLOSED 2026-10-01.)** Absent from `.env.example` and `src/lib/env.ts`; fresh deployments silently disabled all connections. **Fix:** added to the zod env schema (`min(32)`, optional, fail-closed comment), `src/lib/connectors/crypto.ts` now reads the boot-parsed env object, and `.env.example` documents it alongside every other runtime-read variable (AUTH-4 drift list). **Regression:** `tests/security-agent.test.ts` crypto cases drive the parsed env object; connector/MCP journey suites mirror the key into it explicitly.

**CICD-1 — Stale secret-bearing workflow triggers on dead branches. (PATCH READY — operator must apply.)** `sync-runtime-configuration.yml` (Vercel/DB secrets in scope) fires on pushes to `build/m1-m5-production-gate`; `foundry.yml`/`live-evals.yml` key off other dead build branches. **Phase F:** reviewed patch shipped at `docs/security/ci-workflow-hardening.patch` (removes the dead triggers and stale `if` condition). The integration token lacks the `workflow` scope, so applying it plus deleting the 34 merged branches is an operator action.

### LOW

- **AUTH-2** (CLOSED) — Duplicate dead `proxy.ts` at repo root deleted on the Phase F branch; X-Request-Id correlation lives in the active `src/proxy.ts`, asserted by `tests/proxy-guard.test.ts` (which also proves the root file stays absent).
- **AUTH-3** (CLOSED) — `verifyBearer` (`src/lib/auth/session.ts`) validated no issuer/audience and was unused; the module is deleted and its software-rsi guardrails allowlist entry removed.
- **AUTH-4** (CLOSED) — merged into CONN-1; `.env.example` now documents every runtime-read variable (`OSIRUS_FREE_MODEL_*`, `ROUGE_CORE_MODEL`, `ROUGE_SUBSTITUTE_CORES`, `CRON_SECRET`, `OSIRUS_UI_FIXTURES`, tuning knobs, `ROUGE_ALLOW_ULTRA` marked internal/dangerous).
- **DB-3** — No IP allowlist on Neon project; `production` branch not marked protected; public connections not blocked. _Operator action (Neon console):_ enable `allowed_ips`, protect branch, raise PITR window (DB-5).
- **DB-4** (CLOSED) — All `osirus` functions relied on default PUBLIC EXECUTE. Migration `020_function_execute_grants.sql` revokes PUBLIC EXECUTE on every function in `osirus`/`osirus_intel` via a `pg_proc` sweep, grants EXECUTE to `osirus_app`, and pins the same rule as default privileges for future migrations; assertions in `tests/migrations.test.ts`. **Must be applied to the production Neon database after merge** (`node scripts/apply-migrations.mjs`).
- **CICD-2** (patch ready) — `ci.yml` explicit `permissions: contents: read` and Vercel IDs moved to `vars` are in `docs/security/ci-workflow-hardening.patch`; trimming `software-rsi.yml` permissions (`issues:write`/`actions:write`) remains open as a separate, deliberate review. _Operator action:_ apply patch, create repo variables `VERCEL_TEAM_ID`/`VERCEL_PROJECT_ID`.

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

## Phase F resolution log (2026-10-01, branch `security/phase-f-20261001`)

Every closed item followed reproduce → root cause → fix → regression test → re-run:

| Finding         | Fix                                                        | Regression proof                                         |
| --------------- | ---------------------------------------------------------- | -------------------------------------------------------- |
| AUTH-1          | per-process random cookie secret; proxy fails closed       | `tests/auth-config.test.ts`, `tests/proxy-guard.test.ts` |
| AUTH-2          | dead root `proxy.ts` deleted; request-id in `src/proxy.ts` | `tests/proxy-guard.test.ts` (absence assertion)          |
| AUTH-3          | unused `verifyBearer` module deleted                       | build + full suite green without it                      |
| AUTH-4 / CONN-1 | env schema + `.env.example` closed; crypto reads boot env  | `tests/security-agent.test.ts`, journey suites           |
| DB-2            | role assumption proven, not just asserted                  | `tests/db-rls-hardening.test.ts` (9 PGlite tests)        |
| DB-4            | migration 020 grant sweep + default privileges             | `tests/migrations.test.ts` (020 block)                   |
| DB-1            | no in-DB fix exists — residual documented in 020 header    | `tests/migrations.test.ts` (documentation assertion)     |
| CICD-1/2        | `docs/security/ci-workflow-hardening.patch`                | operator applies (token lacks `workflow` scope)          |

## Remaining backlog (dynamic red-team — next stage)

1. ~~Live reproduction of AUTH-1 partial-misconfig path; DB-1/DB-2 role-assumption regression tests~~ — done (see log).
2. IDOR/tenant-crossover probes against API routes (per-route authz matrix).
3. Rate-limit bypass, replay, oversized-payload, timeout-abuse tests on `/api/*`.
4. Upload abuse: path traversal, content-type confusion, archive bombs, prompt injection via files.
5. Agent-security: malicious MCP server responses, poisoned memory, confused-deputy via connections, cross-workspace memory leakage (`workspace_id IS NULL` rows).
6. Dependency audit (`npm audit`) + supply-chain review of `package-lock.json`.
7. Billing-adjacent: entitlement bypass and usage-ledger race conditions (no Stripe yet).
8. `npm run build` + full test suite verification of any fix before CLOSED status.
9. Live production probes of `osirus.vercel.app` (auth flow, headers, cookie flags) — blocked from this environment, run via Playwright prod journey or manually.
