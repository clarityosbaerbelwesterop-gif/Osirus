# OSIRUS Security Red-Team — Round 2

- **Date:** 2026-10-02
- **Scope:** All eight attack surfaces (AUTH, TENANCY, API, MCP/AGENT, BILLING, FILES, DEPLOYMENT, FRONTEND/XSS) per spec §12.
- **Method:** Static code analysis only. No dynamic testing against production or external systems. Every finding cites the code actually read.
- **Base commit:** `06ab95ff8a5271945dc10d8780ef01b56f719dcf` (main, post PR #47), fresh codeload tarball.
- **Relation to prior work:** Builds on `docs/OSIRUS_MASTER_AUDIT.md` (notably residual DB-1) and `docs/SECURITY_AUDIT.md`; does not re-prove their closed findings.

## Summary

| Severity | Count |
| -------- | ----- |
| CRITICAL | 0     |
| HIGH     | 0     |
| MEDIUM   | 2     |
| LOW      | 7     |
| INFO     | 5     |

| Status         | Count |
| -------------- | ----- |
| VERIFIED       | 9     |
| HYPOTHESIS     | 3     |
| NOT-VULNERABLE | 8     |

No remotely exploitable tenant-isolation breach, auth bypass, or injection path was found. The two MEDIUM findings are a budget-enforcement weakening in automation runs and a DNS-rebinding window in the research fetcher. Master-audit residual **DB-1 is confirmed unchanged** (see § "Master-Audit DB-1").

---

## Findings

### RT2-01 — Automation budget upsert silently clears the default run ceilings

- **Severity:** MEDIUM
- **Surface:** MCP/AGENT (budget enforcement)
- **Status:** VERIFIED
- **Evidence:** `src/lib/automations/store.ts:254-262`; `src/lib/runtime/dispatch.ts:343-372` (`setBudget` upsert); `src/lib/runtime/executor.ts:48-54` (`DEFAULT_RUN_BUDGET`); `src/lib/runtime/dispatch.ts:230-233` ("no budget row … is unbounded"); user-controlled input at `src/app/api/automations/route.ts:51-52`.
- **Description:** Every planned run receives `DEFAULT_RUN_BUDGET` (maxModelCalls 40, maxToolCalls 100, maxAttempts 60, maxRepairRounds 4, maxWallClockMs 30 min) via `planRuntimeRun`. When an automation defines `maxCostUsd` **or** `maxTokens`, `startAutomationRun` calls `setBudget` a second time — and `setBudget` is a full-row upsert (`on conflict (run_id, scope, scope_id) do update` of every dimension). Dimensions not passed default to `null` = unbounded. An automation that sets only `maxCostUsd` therefore runs with `max_model_calls`, `max_tool_calls`, `max_attempts`, `max_repair_rounds`, `max_input_tokens`, `max_output_tokens` all cleared.
- **Root cause:** Partial-update intent implemented as a whole-row replace; `null` in `osirus.consume_budget` means "no ceiling", and absence of a row is documented as unbounded.
- **Impact:** A tenant can create up to 20 scheduled automations (free plan) whose runs have no model-call/attempt ceilings inside the 30-minute wall-clock bound, amplifying platform-side model/compute spend beyond the intended per-run envelope. Not a cross-tenant issue.
- **Recommended fix:** In `startAutomationRun`, spread the defaults into the automation-specific `setBudget` call (`...DEFAULT_RUN_BUDGET, maxCostUsd: …, maxInputTokens: …`), or make `setBudget` merge with the existing row instead of replacing it.
- **Regression test proposal:** Unit test: automation with `maxTokens` set → resulting `osirus.run_budgets` row still carries `max_model_calls = 40` and `max_attempts = 60`.
- **Owner action needed:** y

### RT2-02 — Research web fetch: DNS check-then-connect TOCTOU (rebinding window)

- **Severity:** MEDIUM
- **Surface:** MCP/AGENT (SSRF via model-chosen URLs)
- **Status:** VERIFIED (code gap; exploitation path is HYPOTHESIS-level)
- **Evidence:** `src/lib/research/fetch.ts:81-87` (DNS validated once, at check time); `src/lib/research/fetch.ts:112-124` (plain global `fetch` with default DNS at connect time); self-acknowledged residual in the file header comment (`src/lib/research/fetch.ts:13-16`); http scheme permitted at `src/lib/research/fetch.ts:70`. Contrast with the connect-time guard in `src/lib/security/outbound.ts:159-178` (`guardedLookup` dispatcher).
- **Description:** `assertPublicUrl` resolves the hostname and refuses private answers, but the subsequent `fetch()` re-resolves DNS through the default resolver. An attacker-controlled domain (reached via a model-chosen URL, e.g. from web content the research agent reads) can answer a public IP at check time and `127.0.0.1`/link-local at connect time, passing both gates. `outboundFetch` in `src/lib/security/outbound.ts` already solves exactly this with a dispatcher-level `lookup` hook, but the research fetcher does not use it.
- **Root cause:** Two SSRF guards with different strength; the stronger one is not reused for model-driven fetching.
- **Impact:** Bounded on Vercel serverless (no cloud metadata endpoint; deny-by-default network), but any service on the function's loopback or reachable private network becomes fetchable, with the response body returned to the model context. Also allows plaintext `http://` hops.
- **Recommended fix:** Route research fetches through `outboundFetch` (or the same `guardedLookup` undici dispatcher), and consider requiring `https:` for research documents.
- **Regression test proposal:** Unit test with a stubbed resolver that flips answers between calls: `safeFetch` must refuse when the connect-time answer is private.
- **Owner action needed:** y

### RT2-03 — `ci.yml` runs PR-controlled code without a `permissions:` block

- **Severity:** LOW
- **Surface:** DEPLOYMENT
- **Status:** VERIFIED
- **Evidence:** `.github/workflows/ci.yml:1-13` (no top-level `permissions:`); fix already prepared but unapplied in `docs/security/ci-workflow-hardening.patch` (adds `permissions: contents: read`); master audit "CI hardening" row in `docs/OSIRUS_MASTER_AUDIT.md` §E.
- **Description:** CI checks out pull-request code and runs `npm ci` (lifecycle scripts), tests, and `npm run build` with the default `GITHUB_TOKEN` permission set. For fork PRs the token is read-only by GitHub default, so the practical exposure is same-repo PRs/branches if the repository default is read-write.
- **Recommended fix:** Apply `docs/security/ci-workflow-hardening.patch` (or at minimum its `permissions: contents: read` hunk).
- **Regression test proposal:** Workflow-lint step asserting every workflow file declares an explicit top-level `permissions:` block.
- **Owner action needed:** y

### RT2-04 — Stale dead-branch push triggers on workflows that hold secrets

- **Severity:** LOW
- **Surface:** DEPLOYMENT
- **Status:** VERIFIED
- **Evidence:** `.github/workflows/sync-runtime-configuration.yml:5` (`build/m1-m5-production-gate`); `.github/workflows/foundry.yml:21` (`build/m21-m25-intelligence-foundry`); `.github/workflows/live-evals.yml:45` (`build/m11-m15-agent-intelligence`). Confirmed in master audit ("stale branch triggers").
- **Description:** These workflows receive `UNOROUTER_API_KEY_*` and (sync) `VERCEL_TOKEN`, `DATABASE_URL`, `NEON_AUTH_*`. If any of the named branches is recreated and pushed, the workflow runs with secrets on whatever code lands there. Only collaborators can push branches, so this is a hygiene/latent-risk issue, not an external vector.
- **Recommended fix:** Delete the dead push triggers (in the same unapplied patch) and the merged branches.
- **Regression test proposal:** CI check that `on.push.branches` entries reference existing protected branches only.
- **Owner action needed:** y

### RT2-05 — Production CSP allows `'unsafe-inline'` for `script-src`

- **Severity:** LOW
- **Surface:** FRONTEND
- **Status:** VERIFIED
- **Evidence:** `next.config.ts:9-11` (production `script-src 'self' 'unsafe-inline'`); full CSP at `next.config.ts:34-49`.
- **Description:** The CSP is otherwise tight (`object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `connect-src 'self'`, `img-src 'self' data:`), but `'unsafe-inline'` in `script-src` means any HTML-injection bug anywhere in the app is directly exploitable for script execution; the CSP provides no second line of defense for XSS. The Markdown renderer is safe today (see RT2-15), so this is hardening, not a live vector.
- **Recommended fix:** Move to a nonce- or hash-based `script-src` (Next.js supports nonce CSP via middleware), keeping `'unsafe-inline'` only in development.
- **Regression test proposal:** Header assertion in e2e-prod: production `Content-Security-Policy` must not contain `unsafe-inline` in `script-src`.
- **Owner action needed:** y

### RT2-06 — `/api/readiness` discloses operational detail to anonymous callers

- **Severity:** LOW
- **Surface:** API
- **Status:** VERIFIED
- **Evidence:** `src/app/api/readiness/route.ts:13-21` (no auth); payload assembled in `src/lib/readiness/collect.ts:155-178`: per-key provider status (`keyStatus`, labels `KEY_1..3` with HTTP status — `src/lib/models/model-runtime.ts:163-193`), last successful model + timestamp, last authenticated-activity timestamp, and whether `OSIRUS_SCHEDULER_SECRET` / `OSIRUS_CONNECTOR_KEY` are configured.
- **Description:** The endpoint is unauthenticated by design (uptime probes), but it returns more than a ready/not-ready bit: provider key validity per key slot, model identifiers in use, tenant-activity timing, and secret-configuration booleans. This is useful reconnaissance for timing attacks against the scheduler window and for confirming which provider keys are live.
- **Recommended fix:** Return the detailed evidence only to authenticated operators (`isOperator`), and a minimal `{ready: bool}` body otherwise.
- **Regression test proposal:** Contract test: anonymous response contains no `model.keyStatus`, no timestamps, no `runtime.*` flags.
- **Owner action needed:** y

### RT2-07 — Workspace file route echoes internal error text to the client

- **Severity:** LOW
- **Surface:** FILES
- **Status:** VERIFIED
- **Evidence:** `src/app/api/workspaces/[runId]/file/route.ts:73-76` (`error.message.slice(0, 80)` returned); message sources in `src/lib/coding/workspace.ts:131-133` (`read_failed:${stderr}`).
- **Description:** On read failure the route returns the workspace layer's error message, which can embed up to 120 characters of sandbox `stderr`. The sandbox belongs to the caller's own run (RLS-scoped load at line 54-57), so this is self-disclosure, not cross-tenant — but it trains clients to trust server-rendered error strings and can leak sandbox-internal paths.
- **Recommended fix:** Map to a fixed enum (`path_escapes`, `binary_file`, `read_failed`) without the raw suffix.
- **Regression test proposal:** API test asserting the error body matches a closed set of codes.
- **Owner action needed:** n

### RT2-08 — Entitlement limit check is check-then-insert (TOCTOU)

- **Severity:** LOW
- **Surface:** BILLING (entitlements)
- **Status:** VERIFIED
- **Evidence:** `src/lib/entitlements/index.ts:70-79` (`assertWithinLimit`: separate `count(*)` query before the caller's insert); insert e.g. `src/lib/attachments/store.ts:86-111`.
- **Description:** The count and the subsequent insert run in different transactions, so N concurrent uploads can all pass the check and exceed the daily/total limits by N-1. Impact is a small, bounded over-admission of free-plan quota; the per-day windows and per-request size caps contain it.
- **Recommended fix:** Enforce with a single atomic statement (e.g. `insert … select … where (select count(*) …) < limit`, or a constraint trigger).
- **Regression test proposal:** Concurrency test firing 10 parallel uploads at the limit boundary; expect at most `limit` rows.
- **Owner action needed:** n

### RT2-09 — Auth actions echo provider error messages verbatim

- **Severity:** LOW
- **Surface:** AUTH
- **Status:** HYPOTHESIS (depends on Neon Auth/Better Auth message content; not statically verifiable)
- **Evidence:** `src/app/auth/sign-in/actions.ts:19`; `src/app/auth/sign-up/actions.ts:24` (`error.message` returned to the client unmodified).
- **Description:** If the provider distinguishes "user not found" from "wrong password" (or "already registered" on sign-up), these endpoints become account-enumeration oracles. There is also no application-level rate limit on the auth server actions or on `/api/auth/*` (the Neon Auth handler at `src/app/api/auth/[...path]/route.ts` is not behind `enforceRateLimit`); throttling depends entirely on the managed provider.
- **Recommended fix:** Normalize to a generic message ("Invalid email or password" / "If this address can be registered, we have emailed you"), and add a per-IP/per-email throttle in front of the auth routes if the provider does not supply one.
- **Regression test proposal:** Test that sign-in failure text is identical for unknown-email and wrong-password cases.
- **Owner action needed:** y

### RT2-10 — Vercel team/project IDs hardcoded in workflows

- **Severity:** INFO
- **Surface:** DEPLOYMENT
- **Status:** VERIFIED
- **Evidence:** `.github/workflows/foundry.yml:65-66,104-105,131-132`; `.github/workflows/live-evals.yml:115-116`; `.github/workflows/sync-runtime-configuration.yml:49-50`.
- **Description:** `team_5KyyWAPW9vLU4EiaKaYZuhaG` / `prj_fuwXsDnXAfGE4fl4Offo0xBBnZP7` are identifiers, not credentials, and useless without a token; but the master audit intended them as repo variables (`VERCEL_TEAM_ID`/`VERCEL_PROJECT_ID`, currently unset), and hardcoding diverges from that plan.
- **Recommended fix:** Apply the variable migration in the unapplied CI hardening patch.
- **Regression test proposal:** Repo lint: no `team_`/`prj_` literals under `.github/workflows/`.
- **Owner action needed:** y

### RT2-11 — Read-only GET endpoints have no rate limit; run poll can trigger background work

- **Severity:** INFO
- **Surface:** API
- **Status:** VERIFIED
- **Evidence:** `src/app/api/sessions/route.ts:31-46` (GET, no limiter); `src/app/api/notifications/route.ts:12-16`; `src/app/api/policy/route.ts:10-14`; `src/app/api/attachments/route.ts:15-27`; `src/app/api/runtime/[runId]/route.ts:32-95` (GET, no limiter; `pollNudge` may start a 240 s continuation via `after()` at lines 78-80 with no same-origin check).
- **Description:** Mutating routes are consistently rate-limited (per-user, per-route, fixed minute window, fail-closed — `src/lib/product/api.ts:29-111`), but reads are not. An authenticated user can amplify database load by polling; separately, a bare authenticated GET to `/api/runtime/[runId]` can cause the platform to spend up to 240 s of model execution on the caller's own run. The latter is by design for the UI poller, but it means GETs are not side-effect-free, and cookie-based GET CSRF (top-level navigation under a Lax cookie) could nudge a victim's stalled run. Impact is limited to the caller's own workspace.
- **Recommended fix:** Add a generous read limiter (e.g. 300/min/user) and require the polling client to opt into continuations via a same-origin POST.
- **Regression test proposal:** Test that the N+1th GET within a minute returns 429; test that a cross-origin GET cannot start a continuation.
- **Owner action needed:** n

### RT2-12 — Session cookie flags and auth-handler CSRF are library-internal

- **Severity:** INFO
- **Surface:** AUTH
- **Status:** HYPOTHESIS (not statically verifiable)
- **Evidence:** `src/lib/auth/server.ts:20-26` (`createNeonAuth` with `baseUrl`, `cookies.secret`, `logLevel` only); catch-all handler at `src/app/api/auth/[...path]/route.ts:1-15`.
- **Description:** `Secure`/`HttpOnly`/`SameSite` attributes of the session cookie and the origin validation inside the Neon Auth (Better Auth) handler are set by the library and are not visible in this repository. Application-level mutating routes independently enforce `hasSameOrigin` (fail-closed on a missing Origin header — `src/lib/security/request.ts:14-23`), which mitigates CSRF for everything except the auth handler itself. SameSite defaults therefore matter mainly for the auth endpoints and the GET-with-side-effects case in RT2-11.
- **Recommended fix:** One staging-environment check of the actual `Set-Cookie` attributes and of cross-origin POST rejection on `/api/auth/*`; record the result in this file.
- **Regression test proposal:** e2e-prod assertion on cookie attributes.
- **Owner action needed:** y (verification only)

### RT2-13 — GitHub connector POST reads an unbounded JSON body; DELETE not rate-limited

- **Severity:** INFO
- **Surface:** API
- **Status:** VERIFIED
- **Evidence:** `src/app/api/connectors/github/route.ts:68` (`await request.json()` with no byte cap — the shared `readJsonBody` cap is not used); `src/app/api/connectors/github/route.ts:101-113` (DELETE: origin check but no `enforceRateLimit`, unlike POST).
- **Description:** The zod schema caps the token at 300 chars, but the raw body is parsed without a size limit (platform body limits still apply). The un-limited DELETE is inconsistent with the rest of the surface; worst case is connector churn, not data loss.
- **Recommended fix:** Use `readJsonBody(request, 2*1024)` and add the shared `limited()` call to DELETE.
- **Regression test proposal:** 1 MB body to POST returns 413; DELETE over the minute limit returns 429.
- **Owner action needed:** n

### RT2-14 — Fixed-window rate limiter allows 2× burst at window edges

- **Severity:** INFO
- **Surface:** API
- **Status:** VERIFIED (inherent to the design, documented here for completeness)
- **Evidence:** `src/lib/security/rate-limit.ts:27-36` (`date_trunc('minute', now())` window key).
- **Description:** A per-minute fixed window permits up to twice the nominal rate across a boundary. Limits are low (10-120/min) and the limiter fails closed when the store is unreachable, so this is informational.
- **Recommended fix:** Optional: sliding window via two adjacent counters.
- **Regression test proposal:** Boundary test at t=59.9 s / t=60.1 s.
- **Owner action needed:** n

---

## NOT-VULNERABLE (attacked and held)

### RT2-15 — Stored/reflected XSS via Markdown and artifacts

- **Surface:** FRONTEND — **Status:** NOT-VULNERABLE
- **Evidence:** `src/components/chat/markdown.tsx:13-17` (no raw-HTML plugin installed; react-markdown escapes HTML), URL transform via `defaultUrlTransform` (`markdown.tsx:110-112`), images rendered as links, external links `rel="noopener noreferrer nofollow"`; only `dangerouslySetInnerHTML` in the repo is static JSON-LD (`src/app/page.tsx:53-55`); binary artifacts served PNG-only with `nosniff` + `Content-Security-Policy: default-src 'none'; sandbox` (`src/app/api/runtime/[runId]/artifacts/[artifactId]/route.ts:57-69`); attachment content is never served back to the browser at all (only parsed chunks into model context — `src/lib/attachments/store.ts`).

### RT2-16 — Cross-tenant data access (IDOR/BOLA)

- **Surface:** TENANCY — **Status:** NOT-VULNERABLE
- **Evidence:** Every tenant-scoped query runs through `queryAs` with per-transaction `app.current_user_id` + the NOLOGIN/NOBYPASSRLS role (`src/lib/db/client.ts:18-32`); repositories additionally parameterize `workspace_id` from the bootstrapped identity, never from request input (e.g. `src/lib/runtime/repository.ts:96-105`, `src/lib/attachments/store.ts:145-155`); foreign IDs answer 404 and are recorded as security events (`src/lib/security/access.ts`). RLS: ENABLED+FORCED on all 81 tables (master audit, re-verified structurally in `db/migrations/004_security_rls.sql`, `013_product_frontier.sql:115-163`). Direct `db()` use exists only for `select 1` probes (`src/app/api/health/route.ts:14-15`, `src/lib/readiness/collect.ts:41-43`).

### RT2-17 — Entitlement self-upgrade / plan tampering

- **Surface:** BILLING — **Status:** NOT-VULNERABLE
- **Evidence:** `osirus.entitlements` write policy requires `osirus.is_system()` (`db/migrations/013_product_frontier.sql:160-163`); tenant role can only `SELECT` its own row (`:157-159`); limits are applied server-side from the DB row merged over hard-coded plan floors (`src/lib/entitlements/index.ts:41-79`). No route writes entitlements.

### RT2-18 — SSRF via user-supplied MCP server URLs

- **Surface:** MCP/AGENT — **Status:** NOT-VULNERABLE
- **Evidence:** `src/lib/security/outbound.ts` enforces https-only, no URL credentials, blocked hostnames, IP-literal checks for IPv4/IPv6 including mapped/translated forms, port policy, connect-time DNS validation via `guardedLookup` (rebinding-resistant, `:159-178`), no redirects, 15 s timeouts, 1 MB response cap. Applied at server creation (`src/lib/connectors/mcp-store.ts:188`) and every RPC (`src/lib/tools/mcp.ts:210`).

### RT2-19 — MCP tool poisoning / rug-pull after review

- **Surface:** MCP/AGENT — **Status:** NOT-VULNERABLE
- **Evidence:** Discovered tools are namespaced and cannot shadow builtins; every MCP tool is external+high-risk so every call passes the approval gate (`src/lib/tools/mcp.ts:14-23`); tool descriptions are sanitized and injection-flagged (`src/lib/tools/mcp.ts:99-134`); a sha256 definition fingerprint is rechecked on health checks and before every call, and a changed definition disables the tool and voids prior approvals (`src/lib/connectors/mcp-store.ts:20-32`, `src/lib/tools/mcp.ts:83-97`).

### RT2-20 — Webhook forgery / replay

- **Surface:** API — **Status:** NOT-VULNERABLE
- **Evidence:** HMAC-SHA256 (GitHub/generic) / HMAC-SHA1 (Vercel, provider-defined) over the raw body, constant-time compare including length-mismatch padding (`src/lib/webhooks/verify.ts:31-77`); generic senders also sign a ±5-minute timestamp; delivery IDs are accepted once via an `on conflict do nothing` insert (`src/lib/webhooks/store.ts:124-135`); unknown endpoint and bad signature both answer 401 `invalid_signature` (`src/app/api/hooks/[endpointId]/route.ts:36-65`); only strictly validated fields reach the automation objective (`verify.ts:79-182`); per-endpoint rate limit 60/min.

### RT2-21 — Scheduler tick abuse

- **Surface:** API/MCP-AGENT — **Status:** NOT-VULNERABLE
- **Evidence:** Fails closed when the secret is unset (`src/app/api/scheduler/tick/route.ts:86-96`); constant-time secret compare with length padding (`:46-57`); GitHub OIDC alternative pins issuer, audience per endpoint, repository, exact workflow file, `refs/heads/main`, event names, RS256-only, JWKS with 1 h cache (`src/lib/security/github-oidc.ts:92-160`); route limited to 60/min; response carries counts only, no tenant data (`:263-320`); per-tick work bounded (`MAX_STAGES_PER_TICK 12`, `MAX_RUNS_PER_TICK 6`, 240 s budget, chain backstop `MAX_CHAIN 288`).

### RT2-22 — Generated-code execution (Foundry tool synthesis)

- **Surface:** MCP/AGENT — **Status:** NOT-VULNERABLE
- **Evidence:** Four independent layers: acorn AST allowlist (no imports, no computed string member access, no async, forbidden property names, node-count cap), fresh `vm` context with string/wasm code generation disabled and prototype-pollution tripwire, child process under Node `--permission` with empty env and 64 MB heap, wall-clock kill (`src/lib/intelligence/synthesis/isolation.ts:20-365`); self-probes must fail before any tool is accepted (`:372-418`).

### RT2-23 — Sandbox escape / path traversal in coding workspaces

- **Surface:** FILES — **Status:** NOT-VULNERABLE
- **Evidence:** Double path checking (syntactic `isSafeRelativePath` + in-sandbox `realpath` containment, symlink writes refused) in `src/lib/coding/workspace.ts:102-147`; sandbox network is deny-all by default (`src/lib/sandbox/vercel.ts:192-197`); the local driver refuses to construct inside Vercel (`src/lib/sandbox/local.ts:31-36`) and there is no in-process fallback (`src/lib/sandbox/index.ts:55-64`); clone URLs restricted to https github.com without embedded credentials (`workspace.ts:276-306`); command logs redact credentials (`workspace.ts:41-52`).

---

## Master-Audit DB-1 — re-assessment

DB-1 (`docs/OSIRUS_MASTER_AUDIT.md` §E; design note in `db/migrations/020_function_execute_grants.sql:1-24`) states: tenant identity rides on transaction-local GUCs (`app.current_user_id`, `app.osirus_system`) under the shared `osirus_app` role; any principal that can run arbitrary SQL as that role can `set_config` and impersonate any tenant or the system, and no in-Postgres primitive closes this while the Neon owner holds BYPASSRLS.

**This round confirms DB-1 unchanged: still a valid residual HIGH, still accepted, no new path to it found.** Specifically checked:

- All application SQL is parameterized; the only dynamic SQL fragments are fixed column-name maps (`src/lib/intelligence/store/pg-store.ts:703-722` uses an allowlist `assignments()` builder). No route accepts or proxies raw SQL.
- `queryAs`/`querySystem` are the only entry points that touch tenant data; the two `db()` call sites run `select 1` only.
- `osirus_app` is NOLOGIN; migration 020 revoked PUBLIC EXECUTE on all functions in both schemas and set matching default privileges.
- The escalation precondition for DB-1 is therefore unchanged: an attacker first needs arbitrary SQL execution as the owner-granted role, which no application surface provides.

One residual observation to add to DB-1's record: `hasSameOrigin` is not applied to `GET /api/runtime/[runId]`, which can start background work (RT2-11); this is orthogonal to DB-1 but is the only state-changing GET found.

---

## Prioritized fix order

**P0** — none (no CRITICAL/HIGH findings; DB-1 remains the standing P0-class residual by prior decision).

**P1**

1. RT2-01 — merge-not-replace automation budgets (one-line spread fix; closes a spend-amplification path).
2. RT2-02 — route research fetches through the connect-time-guarded dispatcher.
3. RT2-03 + RT2-04 + RT2-10 — apply `docs/security/ci-workflow-hardening.patch` (permissions block, dead triggers, repo variables) and delete the stale branches.

**P2**

4. RT2-05 — nonce-based `script-src` for production.
5. RT2-06 — operator-gate the detailed readiness payload.
6. RT2-09 — normalize auth error text; confirm provider-side throttling.
7. RT2-07, RT2-08, RT2-11, RT2-13, RT2-14 — hardening backlog.
