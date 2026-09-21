import { randomBytes } from "node:crypto";

const api = "https://api.vercel.com";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured in GitHub Actions`);
  return value;
}

function targetList() {
  const target = process.env.OSIRUS_SYNC_TARGET ?? "both";
  if (target === "preview") return ["preview"];
  if (target === "production") return ["production"];
  if (target === "both") return ["preview", "production"];
  throw new Error("OSIRUS_SYNC_TARGET must be preview, production, or both");
}

function isAllowedPrimaryModel(model) {
  if (model === "grok-4.6") return true;
  const normalized = model.toLowerCase();
  return (
    normalized.includes("opus") &&
    /(?:^|[-_.:/])5(?:$|[-_.:/])/.test(normalized)
  );
}

function environmentTargets(environment) {
  if (Array.isArray(environment.target)) return environment.target;
  return environment.target ? [environment.target] : [];
}

function hasTargets(environments, key, targets) {
  return environments.some((environment) => {
    if (environment.key !== key) return false;
    const configured = environmentTargets(environment);
    return targets.every((target) => configured.includes(target));
  });
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
const neonAuthUrl = required("NEON_AUTH_URL").replace(/\/$/, "");
const unoRouterKeyOne = required("UNOROUTER_API_KEY_1");
const unoRouterKeyTwo = required("UNOROUTER_API_KEY_2");
const unoRouterKeyThree = required("UNOROUTER_API_KEY_3");
const targets = targetList();
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

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl && !hasTargets(existing, "DATABASE_URL", targets)) {
  throw new Error(
    "DATABASE_URL is missing for the selected Vercel target. Configure the existing Vercel–Neon integration or add the GitHub DATABASE_URL secret; do not substitute NEON_API_KEY.",
  );
}

const cookieSecretFromGitHub = process.env.NEON_AUTH_COOKIE_SECRET?.trim();
const rotateCookieSecret =
  process.env.OSIRUS_ROTATE_AUTH_COOKIE_SECRET === "true";
const hasCookieSecret = hasTargets(
  existing,
  "NEON_AUTH_COOKIE_SECRET",
  targets,
);
const hasAnyCookieSecret = existing.some(
  (environment) => environment.key === "NEON_AUTH_COOKIE_SECRET",
);
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
