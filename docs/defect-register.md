# Osirus Defect Register (M49–M55)

Every confirmed defect observed in the real product, with reproduction, root
cause, fix, test and status. A defect is never dropped because another problem
appeared. Severity: P0 security/data loss/product unavailable · P1 core feature
unusable · P2 major degraded experience · P3 polish.

| ID        | Title                                                                                                       | Sev                     | Status        |
| --------- | ----------------------------------------------------------------------------------------------------------- | ----------------------- | ------------- |
| OSIRUS-01 | Chat failure for exhausted free quota is reported as "temporarily unavailable" (dishonest, no honest state) | P1                      | FIXED         |
| OSIRUS-02 | No free-model product fallback: one unavailable/paid-only model makes chat unusable                         | P1                      | FIXED         |
| OSIRUS-03 | Model status page cannot say "quota exhausted" or "configuration problem" distinctly                        | P2                      | FIXED         |
| OSIRUS-04 | GitHub OAuth does not complete in production (operator report)                                              | P1                      | INVESTIGATING |
| OSIRUS-05 | Screenshot/visual evidence not visible where expected (operator report)                                     | P1                      | INVESTIGATING |
| OSIRUS-06 | No Impressum / Privacy / Terms / legal footer surfaces                                                      | P1 (EU release blocker) | FIXED (draft) |

---

## OSIRUS-01 — Dishonest chat failure message

- **Severity:** P1
- **Reproduction:** Run any chat with `OSIRUS_MODEL_STRONG` pointing at a paid
  model while the UnoRouter key has no credit. Provider answers 402
  (`insufficient_credit`). The run fails; the UI shows: "The strong model is
  temporarily unavailable. The model provider declined the request."
- **Root cause:** `failureMessage()` in `src/lib/ui/labels.ts` mapped
  `insufficient_credit` to the _transient outage_ wording. A permanent
  configuration/quota state was presented as temporary, and no distinct
  wording existed for credential or configuration failures.
- **Fix:** Distinct, honest categories in `failureMessage()`: quota/credit
  (permanent until topped up), credential, configuration, rate limit,
  provider outage. Model status gains `quota_exhausted` and
  `configuration_error` states.
- **Test:** `tests/ui-views.test.ts` ("tells the truth about provider
  failures").
- **Commit:** M49.

## OSIRUS-02 — Chat unusable when the configured model is not

- **Severity:** P1
- **Reproduction:** Same as OSIRUS-01; the run dies at "Produce the answer";
  no answer is ever produced even though a verified free model
  (`deepseek-v4-pro-0813:free`) exists and is allowlisted.
- **Root cause:** `UnoRouterProvider.modelFor()` threw `model_not_configured`
  for any unconfigured role, and there was no fallback when the configured
  model refused (no credit) — despite the provider being the only thing
  standing between the user and a working product.
- **Fix:** Free-model resilience inside the provider: when a role's configured
  model is unset, or refuses with a permanent refusal (no credit, model
  unknown to the provider), the provider transparently retries on the verified
  free model (`src/lib/models/free.ts` allowlist). A rejected credential is
  never papered over (a second model on the same broken key cannot fix it),
  and a rate limit is never sidestepped — the free model consumes no credit, so
  no quota is evaded. The primary refusal remains the error the caller sees if
  the stand-in also fails.
- **Test:** `tests/unorouter.test.ts` fallback cases.
- **Commit:** M49.

## OSIRUS-04 — GitHub OAuth failure (investigation)

- **Severity:** P1
- **Status:** INVESTIGATING — code-level audit complete; the remaining causes
  live in Neon Auth / GitHub OAuth App configuration, which only the operator
  console can change.
- **Code findings (c372254):** the catch-all Neon Auth route, the client and
  the sign-in button are wired correctly (`provider: "github"`,
  `callbackURL: "/app"`, server-managed PKCE/state). Workspace bootstrap runs
  from the Neon Auth session table, so no code step exists between callback and
  `/app` that can fail silently.
- **Operator checklist (requires Neon/GitHub console access, not code):**
  1. In Neon Auth → Providers → GitHub: Client ID + Client Secret set?
  2. In the GitHub OAuth App: callback URL exactly
     `https://osirus.vercel.app/api/auth/callback/github`?
  3. In Neon Auth → Settings: `https://osirus.vercel.app` listed as a trusted
     origin?
  4. Cookies: Neon Auth sets `Secure` cookies; over HTTPS that is correct, so a
     login loop points at origin mismatch, not cookie flags.

## OSIRUS-05 — Screenshot/artifact evidence (investigation)

- **Severity:** P1
- **Status:** INVESTIGATING. The browser QA code path
  (`src/lib/coding/browser-qa.ts`) is real: Playwright in the Vercel Sandbox
  captures screenshots per viewport and reports bytes. The deployed function
  registers no browser (`registerBrowserQa` is only called from CI/live-eval
  runners), so production QA falls back to the HTTP check and **no screenshots
  are produced in product runs** — the UI then has nothing to render. This is a
  designed fallback, not a bug in the pipeline, but from the user's chair it is
  missing evidence. Resolution belongs to M51/M52 (surface honest
  "browser QA unavailable in this deployment" state + wire sandbox-side
  capture into run artifacts).

## OSIRUS-06 — Legal surfaces missing

- **Severity:** P1 for an EU/German release (TMG §5 Impressum, GDPR
  transparency).
- **Status:** FIXED (draft): `/legal/impressum`, `/legal/privacy`,
  `/legal/terms` exist with clearly marked DRAFT content for operator/legal
  review, linked from the public footer. Final text is owned by the operator.
