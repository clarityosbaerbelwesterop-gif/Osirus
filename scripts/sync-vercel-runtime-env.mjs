import { randomBytes } from "node:crypto";
import {
  coversTargets,
  hasAnyValue,
  isAllowedPrimaryModel,
  parseTargetList,
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

async function availableModelIds(apiKey) {
  const response = await fetch("https://api.unorouter.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(
      `Unable to verify the configured UnoRouter model (${response.status})`,
    );
  }
  const body = await response.json();
  const models = Array.isArray(body.data) ? body.data : [];
  return new Set(
    models
      .map((model) => (typeof model?.id === "string" ? model.id : null))
      .filter(Boolean),
  );
}

const teamId = required("VERCEL_TEAM_ID");
const projectId = required("VERCEL_PROJECT_ID");
const neonAuthUrl = (
  process.env.NEON_AUTH_URL?.trim() || DEFAULT_NEON_AUTH_URL
).replace(/\/$/, "");
const unoRouterKeyOne = required("UNOROUTER_API_KEY_1");
const unoRouterKeyTwo = required("UNOROUTER_API_KEY_2");
const unoRouterKeyThree = required("UNOROUTER_API_KEY_3");
const targets = parseTargetList(process.env.OSIRUS_SYNC_TARGET);
const syncGitBranch = process.env.OSIRUS_SYNC_GIT_BRANCH?.trim() || undefined;
const primaryModel = (process.env.OSIRUS_PRIMARY_MODEL ?? "grok-4.6").trim();

if (!isAllowedPrimaryModel(primaryModel)) {
  throw new Error(
    "OSIRUS_PRIMARY_MODEL must be Grok 4.6 or an exact UnoRouter-listed Opus 5 model ID",
  );
}

const modelIds = await availableModelIds(unoRouterKeyOne);
if (!modelIds.has(primaryModel)) {
  throw new Error(
    "OSIRUS_PRIMARY_MODEL is not available to the configured UnoRouter key",
  );
}

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
const databaseUrl = process.env.DATABASE_URL?.trim();
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

const cookieSecretFromGitHub = process.env.NEON_AUTH_COOKIE_SECRET?.trim();
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
  {
    key: "UNOROUTER_API_KEY_1",
    value: unoRouterKeyOne,
    type: "sensitive",
  },
  {
    key: "UNOROUTER_API_KEY_2",
    value: unoRouterKeyTwo,
    type: "sensitive",
  },
  {
    key: "UNOROUTER_API_KEY_3",
    value: unoRouterKeyThree,
    type: "sensitive",
  },
  ...["FAST", "STRONG", "CODING", "RESEARCH", "MATH", "VERIFY"].map((role) => ({
    key: `OSIRUS_MODEL_${role}`,
    value: primaryModel,
    type: "plain",
  })),
  ...(primaryModel === "grok-4.6"
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
].map((variable) => ({
  ...variable,
  target: targets,
  comment: "Managed by Osirus GitHub Actions runtime configuration sync",
}));

const upsertQuery = new URLSearchParams({ teamId, upsert: "true" });
await vercelRequest(
  `/v10/projects/${encodeURIComponent(projectId)}/env?${upsertQuery}`,
  {
    method: "POST",
    body: JSON.stringify(variables),
  },
);

console.log(
  `Synchronized ${variables.length} server-only runtime variables to ${targets.join(
    ", ",
  )}.`,
);
console.log(`Validated UnoRouter model: ${primaryModel}.`);
console.log(
  cookieSecret
    ? "Provisioned the Neon Auth cookie secret without printing it."
    : "Preserved the existing Neon Auth cookie secret.",
);
