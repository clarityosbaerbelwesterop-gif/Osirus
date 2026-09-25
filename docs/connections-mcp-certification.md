# Connections + MCP certification (Issue #26 §11–12)

Branch `fix/m50-connections-mcp-certification`, based on `main` at
`e30a1a3821b9e79e5926dfb22152fc1bb13ddb53`. Written 2026-09-25 (CEST).

**Bottom line:** every connector journey step and every MCP certification step
below passes in automated tests against the real product code and a real
Postgres. **None of it has been verified in a logged-in production browser
yet.** That run is blocked until the GitHub login fix (Tung, §9–10) lands. The
exact manual steps are at the end of this document.

## How this was verified

| Layer                                          | What is real                                                                                                                                                                                                                   | What is substituted                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Product code                                   | Connector libraries, API route handlers (platform connect/check/disconnect), MCP client, MCP store, tool registry, **database approval gate, audit and workspace policy** (`registryFor`), `RuntimeRepository.resolveApproval` | –                                                                                                                                    |
| Database                                       | Postgres 17 (PGlite, in-process) with **all 20 migrations** in `db/migrations`, forced row-level security and the `osirus_app` role assumed per statement, exactly as `src/lib/db/client.ts` does on Neon                      | Neon's HTTP transport                                                                                                                |
| Provider HTTP (GitHub, Vercel, Neon, Supabase) | Request URLs, headers and the product's parsing of responses                                                                                                                                                                   | `fetch` is mocked **at the provider boundary**; responses mimic the documented shapes. Tokens are random fakes minted in the test    |
| MCP                                            | A local MCP server (Streamable HTTP, JSON-RPC 2.0: `initialize`, `notifications/initialized`, paginated `tools/list`, `tools/call`, JSON and SSE answers, bearer auth)                                                         | The last network hop: the outbound guard still validates every URL, then only the test name `mcp.cert.example` is routed to loopback |
| SSRF guard                                     | URL validation, connect-time DNS check, redirect refusal, size cap (real `undici` Agent)                                                                                                                                       | `node:dns` answers and, for redirect tests only, `undici.fetch`'s response                                                           |

Test files:

- `tests/connections-journey.test.ts`: §11, all connectors
- `tests/mcp-certification.test.ts`: §12 journey, malicious descriptions, schema change after approval
- `tests/mcp-ssrf.test.ts`: §12 SSRF (87 cases)
- `tests/mcp-live-smoke.test.ts`: live smoke test, off by default (`OSIRUS_MCP_LIVE_SMOKE=1`)
- `tests/helpers/pglite.ts`, `tests/helpers/mcp-test-server.ts`: test infrastructure

Local run on this branch: `format:check`, `lint`, `typecheck`, `npm test`
(760 passed, 6 skipped), `build` and `test:e2e` (95 passed) are all green.

## §11 Connections: pass/fail matrix

`PASS (auto)` = covered by the automated tests above. `PENDING (prod)` = still
needs the logged-in production browser run.

| Step                                        | GitHub repos (fine-grained PAT)                                                                         | Vercel                                                                                                           | Neon                         | Supabase                         | Webhooks                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| CONNECT                                     | PASS (auto), after fix 1                                                                                | PASS (auto)                                                                                                      | PASS (auto)                  | PASS (auto)                      | PASS (auto): secret returned once                                      |
| VERIFY (bad token rejected, nothing stored) | PASS (auto): 401 and malformed token                                                                    | PASS (auto): 401 and unreachable                                                                                 | PASS (auto)                  | PASS (auto)                      | n/a (secret generated server-side); bad signature refused: PASS (auto) |
| STORE (AES-256-GCM, never returned)         | PASS (auto): `v1.` ciphertext; no plaintext in any table, page payload or log                           | PASS (auto): also checked in the API route response                                                              | PASS (auto)                  | PASS (auto)                      | PASS (auto): `secret_sealed`, not in list view                         |
| RELOAD                                      | PASS (auto): status + `loadConnections` page payload                                                    | PASS (auto)                                                                                                      | PASS (auto)                  | PASS (auto)                      | PASS (auto)                                                            |
| Tenant isolation (RLS)                      | PASS (auto)                                                                                             | PASS (auto)                                                                                                      | PASS (auto)                  | PASS (auto)                      | PASS (auto)                                                            |
| HEALTH CHECK                                | PASS (auto): ok, then revoked at GitHub → readable failure + `connector_expired` notification           | PASS (auto): via API route; revoked → readable failure (fix 5)                                                   | PASS (auto)                  | PASS (auto)                      | PASS (auto): last delivery status                                      |
| TOOL DISCOVERY                              | PASS (auto): read grant → read credential only; write grant only when asked; downgrade removes it       | PASS (auto): `vercel.deployments`, read/low                                                                      | PASS (auto): `neon.projects` | PASS (auto): `supabase.projects` | n/a                                                                    |
| USE                                         | PASS (auto): open PR; token sent to `api.github.com` only                                               | PASS (auto): via registry; result has no token                                                                   | PASS (auto)                  | PASS (auto)                      | PASS (auto): signed delivery verified, recorded once (dedupe)          |
| DISCONNECT (credential removed, tools gone) | PASS (auto): `credential_reference = null`, all grants revoked, `git.deliver` refuses before git/GitHub | PASS (auto): credential null, tools gone, a tool handed out earlier fails `*_not_connected`, check → 409 (fix 4) | PASS (auto)                  | PASS (auto)                      | PASS (auto): row gone, receiver no longer finds it                     |
| Logged-in prod browser                      | PENDING (prod)                                                                                          | PENDING (prod)                                                                                                   | PENDING (prod)               | PENDING (prod)                   | PENDING (prod)                                                         |

GitHub **login** (identity, Neon Auth) is not part of this workstream and was
not touched. The GitHub **repository** connector is a separate fine-grained PAT.

## §12 MCP certification: pass/fail matrix

| Step                                      | Result                              | Evidence (test)                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add server                                | PASS (auto)                         | Token sealed; URL query values masked in the view (fix 8); other tenant can't see, remove or check it                                                                                                                                                                                                                                                                            |
| Initialize                                | PASS (auto)                         | `initialize` → `notifications/initialized`; session id reused; server name/version stored as untrusted claims                                                                                                                                                                                                                                                                    |
| `tools/list`                              | PASS (auto)                         | Pagination (`nextCursor`) followed (fix 6); bearer token on every request                                                                                                                                                                                                                                                                                                        |
| Tool schemas                              | PASS (auto)                         | Parameter names shown; fingerprint over name + description + full input schema stored; all tools off, risk `high`                                                                                                                                                                                                                                                                |
| Enable tool                               | PASS (auto)                         | Only reviewed and enabled tools reach runs; `trust=mcp`, `effect=external`, `risk=high`, `requiresApproval=true`                                                                                                                                                                                                                                                                 |
| Approval                                  | PASS (auto)                         | First call parks with an `osirus.approvals` row (`requested`, includes the definition fingerprint); no duplicate on retry; server receives no `tools/call`                                                                                                                                                                                                                       |
| Successful execution                      | PASS (auto)                         | After `resolveApproval(approved)` the exact call runs (SSE answer path); audit row `completed`/`high`/`trust=mcp`, no arguments or token in it                                                                                                                                                                                                                                   |
| Rejected execution                        | PASS (auto)                         | A different input needs its own approval; rejected → `ToolPermissionError approval_rejected`, server not called                                                                                                                                                                                                                                                                  |
| Tool error                                | PASS (auto)                         | `isError: true` is a failed call, not a success (fix 7)                                                                                                                                                                                                                                                                                                                          |
| Server health                             | PASS (auto)                         | 503 → `failed` + readable error + health row, reviewed tools kept; wrong token → "rejected the credentials"; malformed `tools/list` → error, **tools not wiped** (fix 6); one oversized entry dropped/flagged on its own                                                                                                                                                         |
| Remove server                             | PASS (auto)                         | Server row, sealed token and tools gone; tools gone from runs; token in no table                                                                                                                                                                                                                                                                                                 |
| Malicious tool description                | PASS (auto)                         | Injection text flagged, fenced/capped (≤400 chars), `prompt_injection_neutralized` event, warning in UI; with the most permissive custom policy (`mcp_action: allow`) the call **still requires approval**                                                                                                                                                                       |
| Schema change after approval              | PASS (auto)                         | Same name + description, widened schema: the approved call is **refused before `tools/call`** (`mcp_tool_changed`), the tool is switched off (`reviewed_at = null`), `tool_denied` event; after re-review, the same input needs a **new approval** (old approval bound to the old fingerprint) (fixes 2 + 3). A description change found by a health check also voids the review |
| Live smoke test (public read-only server) | PASS (live, 2026-09-25 ~18:00 CEST) | DeepWiki `https://mcp.deepwiki.com/mcp` (no auth): server "DeepWiki" 2.14.3, protocol `2025-06-18`, 3 tools (`ask_wiki_question`, `read_wiki_contents`, `read_wiki_structure`), none flagged; `read_wiki_structure` for `modelcontextprotocol/modelcontextprotocol` returned 1594 chars through the real outbound guard + fingerprint check                                      |
| Logged-in prod browser                    | PENDING (prod)                      | See manual steps                                                                                                                                                                                                                                                                                                                                                                 |

### SSRF matrix (`tests/mcp-ssrf.test.ts`)

| Case                                                                                                       | Result                                                                             |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Non-https (`http:`, `ftp:`, `file:`)                                                                       | Blocked                                                                            |
| `localhost`, `localhost.` (fix 2a), `*.localhost`, `*.internal` (e.g. `metadata.google.internal`), `*.lan` | Blocked                                                                            |
| 127.0.0.0/8 incl. `127.1`, `2130706433`, `0x7f000001`                                                      | Blocked                                                                            |
| 10/8, 172.16/12 (172.15 and 172.32 allowed), 192.168/16, 100.64/10, 0/8, multicast, TEST-NETs              | Blocked                                                                            |
| 169.254/16 incl. `169.254.169.254` metadata                                                                | Blocked                                                                            |
| IPv6 `::1`, `::`, fc00::/7, fe80::/10, fec0::/10, ff00::/8, 2001:db8::/32                                  | Blocked                                                                            |
| IPv4-mapped/compatible/translated IPv6 (`[::ffff:127.0.0.1]` → `[::ffff:7f00:1]`), NAT64, 6to4, Teredo     | Blocked (**was an SSRF bypass**, fix 2)                                            |
| Credentials in URL, low non-443 ports                                                                      | Blocked                                                                            |
| DNS answer private, one of several answers private                                                         | Blocked at connect time                                                            |
| DNS rebinding (first answer public, connect-time answer private)                                           | Blocked at connect time; reported as `private_address`, not "unreachable" (fix 2b) |
| Redirects 301/302/307/308 (to metadata, loopback, private, even public)                                    | Never followed (`redirect: "manual"`)                                              |
| Response larger than the cap                                                                               | Refused                                                                            |

## Bugs found and fixed

1. **GitHub repository connector could never be connected (P1).** The grant
   insert used `$3` both as a uuid column and as `$3::text`; Postgres refuses a
   parameter with two deduced types (42P08), so every connect failed _after_ the
   installation row was already written (active token, no grant). Fixed with
   explicit casts; installation and grant are now one atomic statement. Prod
   (read-only check): the only GitHub installation there is `revoked` with no
   credential and 0 grants, consistent with this bug; no data repair needed.
2. **SSRF bypass via IPv6 literals that embed IPv4.** The URL parser normalises
   `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`, which the old check allowed, and IP
   literals skip the DNS guard, so the request reached loopback or metadata. Now
   IPv6 is fully parsed (mapped, compatible, translated, NAT64, 6to4, Teredo,
   site-local, docs). Also fixed: (a) `localhost.` with a trailing dot passed the
   host check; (b) connect-time DNS blocks came back as a generic `fetch failed`,
   so they were shown as "unreachable" and no `outbound_blocked` event was written.
3. **MCP schema change after approval did not void anything.** Only the
   description was compared, and only at health-check time. Now the fingerprint
   covers name, description and the full input schema; it is checked at every
   health check **and right before every `tools/call`**, and approvals are bound
   to it (tools without a fingerprint keep their old approval fingerprint).
4. **Platform health check on a disconnected connector** recorded a bogus failed
   health row and returned 200. Now it returns `409 not_connected`.
5. **Platform health errors** showed raw codes (`provider_rejected:401`). They are
   now readable ("no longer accepts this token…").
6. **A malformed `tools/list` wiped all reviewed tools** while marking the server
   healthy, and one oversized description (>4000 chars) made the whole list
   "empty". It is now an error that keeps the tools; bad entries are dropped
   individually; `nextCursor` pagination is followed; JSON-RPC ids are checked.
7. **MCP `isError` results counted as successful tool calls.** They now fail.
8. **MCP server URL echoed to the browser in full**, including API keys that
   servers often take as query parameters. Query values are now masked in the view.

**No database migration.** The MCP fingerprint and the "flagged" marker live in
the existing `mcp_server_tools.input_schema` jsonb column. Prod has 0 MCP
servers (read-only check), so no tools are affected by the stricter rule that a
tool without a fingerprint is only offered to runs after one health check.

## Not verified here (honest limits)

- No real Vercel, Neon, Supabase or GitHub API was called with a real token (per
  the brief: no real user credentials). Provider responses are mocked to the
  documented shapes, so a provider API change would not be caught here.
- UI click flows (forms, dialogs, toggles) were not driven in a logged-in browser.
  Only `test:e2e` against the static UI fixtures ran.
- Whether `OSIRUS_CONNECTOR_KEY` is set in Vercel production was not inspected
  here. If it is missing, every connector card shows "not set up" (NOT_CONFIGURED).
- The live MCP smoke test ran from this machine, not from Vercel's network.

## PENDING: logged-in production browser run

Blocked until Tung's GitHub login fix is merged and deployed. Run on
https://osirus.vercel.app with a **test account** and **throwaway tokens**
created only for this run, and revoke them at the end. Never paste tokens into
tickets, screenshots or logs. For each step record pass/fail, time (CEST) and a
screenshot with the token fields empty.

0. Sign in, open `/app/connections`. Every card should show a connect action, not
   "Connections are not set up" (that would mean `OSIRUS_CONNECTOR_KEY` is missing).
1. **GitHub repository:** create a fine-grained PAT (one test repo, Contents: read)
   → Connect → card shows your login, "read" and a healthy check. Reload the page:
   still connected. Click "Check now": healthy with latency. In chat, ask Osirus to
   look at `https://github.com/<you>/<test-repo>`: the coding workspace clones it.
   Revoke the PAT on GitHub → "Check now" says GitHub no longer accepts it and an
   inbox notification appears. Disconnect → card shows not connected; reload keeps
   it that way.
2. **Vercel / Neon / Supabase** (each): create a read-only / throwaway token →
   Connect → account name shown and healthy. Reload: still connected. "Check now":
   healthy. In chat ask e.g. "list my recent Vercel deployments" / "list my Neon
   projects" / "list my Supabase projects": answer uses the connector tool
   (visible in the run's tool calls). Disconnect → not connected; ask again: the
   tool is no longer offered. Revoke the token at the provider.
3. **Webhooks:** create a generic endpoint → the secret is shown once (copy it
   locally). Reload: secret not shown again. Send a signed test delivery (see
   `signGeneric` in `src/lib/webhooks/verify.ts`) → the card's last delivery shows
   "triggered". Delete the endpoint → the same delivery now gets 401.
4. **MCP:** Add server `https://mcp.deepwiki.com/mcp` (no token) → status healthy,
   3 tools listed, all off, "High risk · asks every time". Enable
   `read_wiki_structure`. In chat ask "use DeepWiki to show the wiki structure of
   modelcontextprotocol/modelcontextprotocol" → the run asks for approval
   (Approvals page / inbox). Approve → the answer uses the result. Ask again with a
   different repo → a new approval; **Reject** it → the run reports it was not run.
   Click "Check" on the server → healthy with latency. Try adding
   `https://169.254.169.254/` and `http://example.com/`: both refused with a
   readable reason. Remove the server → gone after reload, and the tool is no
   longer offered in a new chat.
5. Open `/app/settings/security` (security events): expect no token anywhere
   on the page. (URLs refused when a server is _added_ are rejected in the form
   and are not recorded as events; `outbound_blocked` events come from checks
   and tool calls.) `/app/audit` should list the MCP tool calls: completed,
   cancelled (rejected) and awaiting approval.
