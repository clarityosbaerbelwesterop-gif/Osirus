# Provider diagnostics (M49)

This page records what is known about the three UnoRouter keys
(`UNOROUTER_API_KEY_1/2/3`) and how to measure them safely. It never contains a
key, an `Authorization` header or any other secret. Measured values go in the
"Results" table; until someone runs the workflow, those rows say **pending**.

## How to measure the keys (safe)

The workflow `provider-diagnostics.yml` (staged at
`ops/github-workflows/provider-diagnostics.yml`, see step 1) runs
`scripts/provider-diagnostics.mjs` with the three keys from GitHub Actions
secrets. For each key it calls:

- `GET https://api.unorouter.com/api/usage/token/` (Bearer key)
- `GET https://api.unorouter.com/v1/models` (Bearer key)

It outputs **only** these fields: label (`KEY_1`..`KEY_3`), HTTP status,
`total_granted`, `total_used`, `total_available`, `unlimited_quota`,
`model_limits_enabled`, `expires_at`, model count, free-model count, free model
IDs, and the free-model differences between keys. Usage fields that are not a
number or a boolean are dropped (`scripts/lib/provider-diagnostics.mjs`,
unit-tested), so no token name or free text can leak. Response bodies are
never printed.

Run it:

1. The workflow is in `.github/workflows/provider-diagnostics.yml`. It also
   sends one tiny chat request to up to 10 listed free models to check which
   of them answer as chat models; only the ID, HTTP status, a category and the
   latency are recorded, never the reply.
2. `gh workflow run provider-diagnostics.yml --repo clarityosbaerbelwesterop-gif/Osirus`
   (or Actions → "Provider diagnostics" → Run workflow).
3. Read the job summary, or download the `provider-diagnostics` artifact
   (`provider-diagnostics.md` / `.json`), and copy the table into "Results"
   below.

If the usage endpoint answers with `403 (html challenge)`, Cloudflare served a
browser challenge instead of the API (an unauthenticated request from outside
GitHub got exactly this on 2026-09-25). That is recorded as a status, not a
failure of the key.

## Results

| Key   | usage HTTP | total_granted | total_used | total_available | unlimited_quota | model_limits_enabled | expires_at | models HTTP | models  | free models |
| ----- | ---------- | ------------- | ---------- | --------------- | --------------- | -------------------- | ---------- | ----------- | ------- | ----------- |
| KEY_1 | pending    | pending       | pending    | pending         | pending         | pending              | pending    | pending     | pending | pending     |
| KEY_2 | pending    | pending       | pending    | pending         | pending         | pending              | pending    | pending     | pending | pending     |
| KEY_3 | pending    | pending       | pending    | pending         | pending         | pending              | pending    | pending     | pending | pending     |

Free model IDs per key and differences between keys: **pending** (needs the
workflow run above; this computer has no keys).

## What is already known without a key

- `GET /v1/models` requires a key (HTTP 401 without one). The runtime
  therefore discovers its free-model pool at run time with the configured key;
  no model ID is hard-coded as verified.
- The public catalog `GET https://api.unorouter.com/api/pricing` needs no key.
  On 2026-09-25 it listed 225 models, 105 flagged `is_free`, of which 61 are
  free, online, non-deprecated chat models on the OpenAI-compatible endpoint.
  Osirus uses the catalog only to _annotate_ IDs that `/v1/models` returned
  (free flag, context window, max output, tool support, chat capability). It
  never adds an ID from the catalog alone.
- `deepseek-v4-pro-0813:free`, the one free model Osirus had run before, is
  not a top-level catalog entry today (it only appears in provider group
  names). It stays a seed that is used only if discovery fails, and it is
  dropped from the pool as soon as a successful discovery does not list it.
- Three keys do not mean three free quotas: UnoRouter's free tier is per user
  and per free model. Osirus never rotates keys to get around a rate limit or
  an exhausted quota (see "Key rules" below).

## Vercel runtime configuration (three keys, production and preview)

Verdict from the code (`.github/workflows/sync-runtime-configuration.yml`,
`scripts/sync-vercel-runtime-env.mjs`, `scripts/lib/vercel-env.mjs`):

- **Before M49:** all three keys were required and upserted with
  `target: ["preview", "production"]` (the push trigger and the dispatch
  default both mean `both`). But the script validated the primary model
  (`grok-4.6`) against key 1 **before** the upsert and threw if it was not
  listed, so a model or key-1 problem blocked syncing everything. Every model
  role was forced to `grok-4.6`, nothing verified the result afterwards, and a
  change to `scripts/lib/vercel-env.mjs` did not re-trigger the sync. Operator
  confirmation: production and preview both hold all three keys, and every
  `OSIRUS_MODEL_*` is `grok-4.6` with no free model configured.
- **After M49** (script changes are live with the current workflow; the
  workflow file update itself is staged in `ops/github-workflows/`): the
  legacy `grok-4.6` workflow default is ignored under free-first, and the
  keys are synced even if model validation has problems
  (each key's `/v1/models` status is printed as label + HTTP status). Every
  role (`OSIRUS_MODEL_FAST/STRONG/THINKING/CODING/RESEARCH/MATH/VERIFY`) is
  rewritten to `free` (verified free pool), `OSIRUS_MODEL_POLICY=free-first`
  is written, and `OSIRUS_FREE_MODEL_PRIMARY/SECONDARY/TERTIARY` are written
  as preference hints from the key's own `/v1/models` list. After the upsert
  the script re-reads the Vercel env list (names, targets, `updatedAt` only,
  never values) and prints, per key and per target, `synced`, `present
(update not confirmed)` or `MISSING`; it fails if any of the three keys or
  any model role does not cover production and preview. Branch-pinned preview
  rows, which override the general preview value for their branch, are
  reported by count.
- Independently of the sync, the runtime now ignores a paid role value under
  the default free-first policy, so the stale `grok-4.6` values cannot block
  chat even before the sync runs.
- Vercel applies environment changes to **new** deployments only. After the
  sync, redeploy production (and preview).

## Key rules (audited in `UnoRouterProvider`)

| Failure                     | Same model, other key?                                                | Other free model?                                                                                                  |
| --------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 429 rate limit              | never                                                                 | the request waits for Retry-After; only if that wait exceeds the ceiling may a _ready_ verified free model take it |
| insufficient credit / quota | never                                                                 | yes (free models need no credit)                                                                                   |
| 401 / 403 credential        | yes (revoked-key failover); the rejected key is tried last for 10 min | no; a key problem is surfaced                                                                                      |
| 5xx / 408 / network         | yes (provider failure)                                                | yes, after the keys                                                                                                |
| unknown model (404)         | never                                                                 | yes                                                                                                                |

The rule lives in one predicate, `keyFailoverAllowed()` in
`src/lib/models/unorouter.ts`, and is unit-tested in
`tests/free-model-policy.test.ts`.
