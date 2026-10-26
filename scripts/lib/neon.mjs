// Neon helpers for the runtime sync: the project's region, a connection
// string for its default branch (never printed), and the matching Vercel
// function region. Pure functions are exported for tests; network calls take
// an injectable fetch.

export const NEON_API = "https://console.neon.tech/api/v2";

/** Neon region -> the nearest Vercel function region. */
const REGION_MAP = {
  "aws-us-east-1": "iad1",
  "aws-us-east-2": "cle1",
  "aws-us-west-2": "pdx1",
  "aws-eu-central-1": "fra1",
  "aws-eu-west-2": "lhr1",
  "aws-ap-southeast-1": "sin1",
  "aws-ap-southeast-2": "syd1",
  "aws-sa-east-1": "gru1",
  "azure-eastus2": "iad1",
  "azure-westus3": "pdx1",
  "azure-gwc": "fra1",
};

export function vercelRegionForNeon(regionId) {
  return REGION_MAP[String(regionId ?? "").trim()] ?? null;
}

/** The Neon region encoded in a Neon host name, e.g. ...eu-central-1.aws.neon.tech. */
export function neonRegionFromUrl(value) {
  let host;
  try {
    host = new URL(String(value ?? "")).hostname;
  } catch {
    return null;
  }
  const match = /\.([a-z]{2}-[a-z]+-\d)\.aws\.neon\.tech$/.exec(host);
  return match ? `aws-${match[1]}` : null;
}

/** Tables the current code reads; a missing one means a migration is missing. */
export const REQUIRED_TABLES = [
  "osirus.users",
  "osirus.workspaces",
  "osirus.sessions",
  "osirus.messages",
  "osirus.runs",
  "osirus.model_calls",
  "osirus.agents",
  "osirus.group_chats",
  "osirus.legal_acceptances",
  "osirus.billing_customers",
  "osirus.billing_subscriptions",
  "osirus.stripe_events",
];

/** The default branch: the one Neon marks default (or primary), else the first. */
export function pickDefaultBranch(branches) {
  const list = Array.isArray(branches) ? branches : [];
  return (
    list.find((branch) => branch?.default === true) ??
    list.find((branch) => branch?.primary === true) ??
    list[0] ??
    null
  );
}

/** neondb when it exists, else the first database. */
export function pickDatabase(databases) {
  const list = Array.isArray(databases) ? databases : [];
  return list.find((db) => db?.name === "neondb") ?? list[0] ?? null;
}

export function missingTables(present, required = REQUIRED_TABLES) {
  const have = new Set(present);
  return required.filter((name) => !have.has(name));
}

async function neonRequest(path, apiKey, fetchImpl) {
  const response = await fetchImpl(`${NEON_API}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!response.ok) {
    // Status only: the body can echo request details.
    throw new Error(
      `Neon API ${path.split("?")[0]} answered HTTP ${response.status}`,
    );
  }
  return response.json();
}

/**
 * The project's region and a pooled connection URI for its default branch,
 * owner role, main database. The URI is a secret: callers must not log it.
 */
export async function resolveNeonProject({
  apiKey,
  projectId,
  fetchImpl = fetch,
}) {
  const id = encodeURIComponent(projectId);
  const { project } = await neonRequest(`/projects/${id}`, apiKey, fetchImpl);
  const { branches } = await neonRequest(
    `/projects/${id}/branches`,
    apiKey,
    fetchImpl,
  );
  const branch = pickDefaultBranch(branches);
  if (!branch) throw new Error("The Neon project has no branch");
  const { databases } = await neonRequest(
    `/projects/${id}/branches/${encodeURIComponent(branch.id)}/databases`,
    apiKey,
    fetchImpl,
  );
  const database = pickDatabase(databases);
  if (!database) throw new Error("The Neon branch has no database");
  const query = new URLSearchParams({
    branch_id: branch.id,
    database_name: database.name,
    role_name: database.owner_name,
    pooled: "true",
  });
  const { uri } = await neonRequest(
    `/projects/${id}/connection_uri?${query}`,
    apiKey,
    fetchImpl,
  );
  if (typeof uri !== "string" || !uri.startsWith("postgres")) {
    throw new Error("Neon did not return a connection URI");
  }
  return {
    projectName: project?.name ?? projectId,
    regionId: project?.region_id ?? null,
    branchName: branch.name ?? branch.id,
    databaseName: database.name,
    uri,
  };
}
