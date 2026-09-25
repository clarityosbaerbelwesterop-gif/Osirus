import { randomBytes } from "node:crypto";
import {
  branchPinnedRows,
  coversTargets,
  FREE_POOL_SENTINEL,
  hasAnyValue,
  MODEL_ROLE_KEYS,
  optionalSecret,
  parseModelPolicy,
  parseTargetList,
  rankFreeModels,
  resolveRoleModel,
  staleTargets,
  UNOROUTER_KEY_NAMES,
  uncoveredTargets,
} from "./lib/vercel-env.mjs";

const api = "https://api.vercel.com";

// The Neon Auth base URL is public configuration -- the browser calls it -- not
// a secret. Defaulting it removes a hand-maintained GitHub secret that can
// silently drift from the Neon project; NEON_AUTH_URL still overrides it.
const DEFAULT_NEON_AUTH_URL =
  "https://ep-icy-shadow-b2ea2wve.neonauth.c-6.eu-central-1.aws.neon.tech/neondb/auth";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured in GitHub Actions`);
  return value;
}

async function vercelRequest(path, init = {}) {
  const response = await fetch(`${api}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${required("VERCEL_TOKEN")}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new Error(
      `Vercel environment synchronization failed (${response.status})`,
    );
  }
  return response.json();
}

// Model IDs Osirus has previously run successfully (src/lib/models/free.ts).
const KNOWN_FREE_MODELS = ["deepseek-v4-pro-0813:free"];

/**
 * GET /v1/models for one key. Returns the HTTP status and the listed IDs;
 * never prints or returns the key, and never prints a response body.
 */
async function listModels(apiKey) {
  try {
    const response = await fetch("https://api.unorouter.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { status: response.status, ids: new Set() };
    const body = await response.json();
    const models = Array.isArray(body?.data) ? body.data : [];
    return {
      status: response.status,
      ids: new Set(
        models
          .map((model) => (typeof model?.id === "string" ? model.id : null))
          .filter(Boolean),
      ),
    };
  } catch {
    return { status: "network_error", ids: new Set() };
  }
}

/** The public catalog needs no key; failure only loses annotations. */
async function publicCatalog() {
  try {
    const response = await fetch("https://api.unorouter.com/api/pricing", {
      signal: AbortSignal.timeout(15_000),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

const teamId = required("VERCEL_TEAM_ID");
const projectId = required("VERCEL_PROJECT_ID");
const neonAuthUrl = (
  optionalSecret(process.env.NEON_AUTH_URL) ?? DEFAULT_NEON_AUTH_URL
).replace(/\/$/, "");
// All three keys are required and all three are synced to every target.
const unoRouterKeys = UNOROUTER_KEY_NAMES.map((name) => required(name));
const targets = parseTargetList(process.env.OSIRUS_SYNC_TARGET);
const syncGitBranch = process.env.OSIRUS_SYNC_GIT_BRANCH?.trim() || undefined;
const modelPolicy = parseModelPolicy(process.env.OSIRUS_MODEL_POLICY);

// Validate every key by its /v1/models status (label + status only). A key
// problem is reported but does not stop the keys from being synced: the
// runtime's credential failover depends on all three being present.
const listings = [];
for (const [index, key] of unoRouterKeys.entries()) {
  const listing = await listModels(key);
  listings.push(listing);
  const freeCount = [...listing.ids].filter((id) => /:free$/i.test(id)).length;
  console.log(
    `KEY_${index + 1}: /v1/models HTTP ${listing.status}, ${listing.ids.size} models, ${freeCount} free`,
  );
}
const firstValid = listings.find((listing) => listing.ids.size > 0);
const listedIds = firstValid?.ids ?? new Set();
const freeRanked = rankFreeModels(
  listedIds,
  await publicCatalog(),
  KNOWN_FREE_MODELS,
);
const roleModel = firstValid
  ? resolveRoleModel({
      requested: process.env.OSIRUS_PRIMARY_MODEL,
      policy: modelPolicy,
      listedIds,
    })
  : FREE_POOL_SENTINEL;
if (
  process.env.OSIRUS_PRIMARY_MODEL?.trim() &&
  roleModel === FREE_POOL_SENTINEL &&
  modelPolicy === "free-first"
)
  console.log(
    "Notice: OSIRUS_PRIMARY_MODEL is ignored under the free-first policy; every role is set to the verified free-model pool.",
  );
const [freePrimary, freeSecondary, freeTertiary] = freeRanked;
console.log(
  `Model policy: ${modelPolicy}; roles: ${roleModel}; free tiers: ${
    [freePrimary, freeSecondary, freeTertiary].filter(Boolean).join(", ") ||
    "none listed"
  }.`,
);

const query = new URLSearchParams({ teamId });
const existingResponse = await vercelRequest(
  `/v10/projects/${encodeURIComponent(projectId)}/env?${query}`,
);
const existing = Array.isArray(existingResponse.envs)
  ? existingResponse.envs
  : [];

// DATABASE_URL is owned by the Vercel-Neon integration, which provisions it per
// deployment and scopes preview values to a git branch. GitHub Actions cannot
// read it, and its absence here is not a failure: database availability is
// certified separately by deploying and asserting /api/health runs SELECT 1.
const databaseUrl = optionalSecret(process.env.DATABASE_URL);
const uncoveredDatabaseTargets = uncoveredTargets(
  existing,
  "DATABASE_URL",
  targets,
  syncGitBranch,
);
if (!databaseUrl && uncoveredDatabaseTargets.length > 0) {
  console.warn(
    `Notice: DATABASE_URL is not directly visible for ${uncoveredDatabaseTargets.join(
      ", ",
    )}. This is expected while the Vercel-Neon integration owns it. Not synchronizing it; database health is certified by /api/health on a fresh deployment.`,
  );
}

// A configured-but-blank secret must not stand in for a real one: it would
// leave the app with an empty cookie secret and auth permanently unconfigured.
const cookieSecretFromGitHub = optionalSecret(
  process.env.NEON_AUTH_COOKIE_SECRET,
);
const rotateCookieSecret =
  process.env.OSIRUS_ROTATE_AUTH_COOKIE_SECRET === "true";
const hasCookieSecret = coversTargets(
  existing,
  "NEON_AUTH_COOKIE_SECRET",
  targets,
  syncGitBranch,
);
const hasAnyCookieSecret = hasAnyValue(existing, "NEON_AUTH_COOKIE_SECRET");
if (!hasCookieSecret && hasAnyCookieSecret && !rotateCookieSecret) {
  throw new Error(
    "NEON_AUTH_COOKIE_SECRET is only partially configured in Vercel. Refusing to rotate active sessions; complete the target manually or dispatch with explicit rotation.",
  );
}
const cookieSecret =
  rotateCookieSecret || !hasAnyCookieSecret
    ? (cookieSecretFromGitHub ?? randomBytes(48).toString("base64url"))
    : undefined;

// The scheduler tick secret. Generated once and left alone afterwards:
// replacing it mid-flight would make every scheduled tick fail closed until
// the cron configuration caught up. Never printed, same as the cookie secret.
const schedulerSecretFromGitHub = optionalSecret(
  process.env.OSIRUS_SCHEDULER_SECRET,
);
const hasAnySchedulerSecret = hasAnyValue(existing, "OSIRUS_SCHEDULER_SECRET");
const schedulerSecret =
  schedulerSecretFromGitHub ??
  (hasAnySchedulerSecret ? undefined : randomBytes(48).toString("base64url"));

// The key that encrypts connector credentials (GitHub tokens) at rest.
// Generated once and never rotated by this script: a new key would make every
// stored credential undecryptable. Never printed.
const hasAnyConnectorKey = hasAnyValue(existing, "OSIRUS_CONNECTOR_KEY");
const connectorKey = hasAnyConnectorKey
  ? undefined
  : randomBytes(48).toString("base64url");

const variables = [
  {
    key: "NEON_AUTH_BASE_URL",
    value: neonAuthUrl,
    type: "sensitive",
  },
  {
    key: "NEON_AUTH_JWKS_URL",
    value: `${neonAuthUrl}/.well-known/jwks.json`,
    type: "sensitive",
  },
  {
    key: "UNOROUTER_BASE_URL",
    value: "https://api.unorouter.com/v1/chat/completions",
    type: "plain",
  },
  ...UNOROUTER_KEY_NAMES.map((key, index) => ({
    key,
    value: unoRouterKeys[index],
    type: "sensitive",
  })),
  { key: "OSIRUS_MODEL_POLICY", value: modelPolicy, type: "plain" },
  // Every role is rewritten -- this replaces the old grok-4.6 defaults. The
  // pool sentinel means "verified free-model pool, discovered at runtime".
  ...MODEL_ROLE_KEYS.map((key) => ({ key, value: roleModel, type: "plain" })),
  // Preference hints only; the runtime re-verifies against /v1/models.
  ...[
    ["OSIRUS_FREE_MODEL_PRIMARY", freePrimary],
    ["OSIRUS_FREE_MODEL_SECONDARY", freeSecondary],
    ["OSIRUS_FREE_MODEL_TERTIARY", freeTertiary],
  ]
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => ({ key, value, type: "plain" })),
  ...(roleModel === "grok-4.6"
    ? [
        {
          key: "OSIRUS_REASONING_EFFORT",
          value: "high",
          type: "plain",
        },
      ]
    : []),
  ...(databaseUrl
    ? [{ key: "DATABASE_URL", value: databaseUrl, type: "sensitive" }]
    : []),
  ...(cookieSecret
    ? [
        {
          key: "NEON_AUTH_COOKIE_SECRET",
          value: cookieSecret,
          type: "sensitive",
        },
      ]
    : []),
  ...(schedulerSecret
    ? [
        {
          key: "OSIRUS_SCHEDULER_SECRET",
          value: schedulerSecret,
          type: "sensitive",
        },
        // Vercel Cron sends `Authorization: Bearer $CRON_SECRET` and cannot
        // set a custom header. Holding the same value under both keys lets the
        // cron authenticate without adding a second credential that would also
        // open the route.
        {
          key: "CRON_SECRET",
          value: schedulerSecret,
          type: "sensitive",
        },
      ]
    : []),
  ...(connectorKey
    ? [
        {
          key: "OSIRUS_CONNECTOR_KEY",
          value: connectorKey,
          type: "sensitive",
        },
      ]
    : []),
].map((variable) => ({
  ...variable,
  target: targets,
  comment: "Managed by Osirus GitHub Actions runtime configuration sync",
}));

const syncStartedAt = Date.now() - 60_000; // tolerate clock skew
const upsertQuery = new URLSearchParams({ teamId, upsert: "true" });
await vercelRequest(
  `/v10/projects/${encodeURIComponent(projectId)}/env?${upsertQuery}`,
  {
    method: "POST",
    body: JSON.stringify(variables),
  },
);

// Verify from Vercel itself -- names, targets and timestamps only, never
// values -- that all three keys and every model role now cover every
// requested target.
const afterResponse = await vercelRequest(
  `/v10/projects/${encodeURIComponent(projectId)}/env?${query}`,
);
const afterSync = Array.isArray(afterResponse.envs) ? afterResponse.envs : [];
const verificationFailures = [];
for (const key of [
  ...UNOROUTER_KEY_NAMES,
  ...MODEL_ROLE_KEYS,
  "OSIRUS_MODEL_POLICY",
]) {
  const missing = uncoveredTargets(afterSync, key, targets, syncGitBranch);
  const stale = staleTargets(
    afterSync,
    key,
    targets,
    syncStartedAt,
    syncGitBranch,
  );
  const pinned = branchPinnedRows(afterSync, key).filter(
    (branch) => branch !== syncGitBranch,
  );
  const states = targets.map((target) => {
    if (missing.includes(target)) return `${target}=MISSING`;
    if (stale.includes(target))
      return `${target}=present (update not confirmed)`;
    return `${target}=synced`;
  });
  console.log(
    `${key}: ${states.join(" ")}${
      pinned.length
        ? ` [${pinned.length} branch-pinned preview row(s) override this for their branches]`
        : ""
    }`,
  );
  if (missing.length) verificationFailures.push(key);
}

console.log(
  `Synchronized ${variables.length} server-only runtime variables to ${targets.join(
    ", ",
  )}.`,
);
console.log(
  "Vercel applies environment changes to NEW deployments only: redeploy production and preview after this sync.",
);
console.log(
  cookieSecret
    ? "Provisioned the Neon Auth cookie secret without printing it."
    : "Preserved the existing Neon Auth cookie secret.",
);
console.log(
  schedulerSecret
    ? "Provisioned the scheduler tick secret without printing it."
    : "Preserved the existing scheduler tick secret.",
);
console.log(
  connectorKey
    ? "Provisioned the connector encryption key without printing it."
    : "Preserved the existing connector encryption key.",
);

if (verificationFailures.length) {
  throw new Error(
    `Vercel does not cover every target for: ${verificationFailures.join(", ")}`,
  );
}
if (!firstValid) {
  throw new Error(
    "No UnoRouter key could list models; keys were synced, but the free-model pool cannot be verified. Run the provider diagnostics workflow.",
  );
}
if (!freePrimary) {
  throw new Error(
    "No free chat model is listed for the configured key; Osirus cannot answer without paid credit.",
  );
}
