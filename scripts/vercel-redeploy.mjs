// Redeploy production so synced environment variables take effect: Vercel
// applies environment changes to new deployments only. Rebuilds the latest
// READY production deployment (same commit) and waits until it is live.

const api = "https://api.vercel.com";
const TIMEOUT_MS = 15 * 60_000;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured in GitHub Actions`);
  return value;
}

const token = required("VERCEL_TOKEN");
const projectId = required("VERCEL_PROJECT_ID");
const teamId = process.env.VERCEL_TEAM_ID?.trim();
const scope = teamId ? `teamId=${encodeURIComponent(teamId)}` : "";

async function vercel(path, init = {}) {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(
    `${api}${path}${scope ? separator + scope : ""}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    },
  );
  if (!response.ok) {
    throw new Error(
      `Vercel ${path.split("?")[0]} answered HTTP ${response.status}`,
    );
  }
  return response.json();
}

const { deployments = [] } = await vercel(
  `/v6/deployments?projectId=${encodeURIComponent(projectId)}&target=production&state=READY&limit=1`,
);
const latest = deployments[0];
if (!latest) throw new Error("No READY production deployment to redeploy");

const created = await vercel("/v13/deployments?forceNew=1", {
  method: "POST",
  body: JSON.stringify({
    name: latest.name,
    deploymentId: latest.uid,
    target: "production",
  }),
});
console.log(`Redeploying ${latest.uid} as ${created.id} ...`);

const started = Date.now();
let state = created.readyState;
while (state !== "READY") {
  if (state === "ERROR" || state === "CANCELED") {
    throw new Error(`Production redeploy ${created.id} ended ${state}`);
  }
  if (Date.now() - started > TIMEOUT_MS) {
    throw new Error(`Production redeploy ${created.id} not ready after 15 min`);
  }
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  ({ readyState: state } = await vercel(`/v13/deployments/${created.id}`));
}
console.log(
  `Production is live on the new deployment (https://${created.url}).`,
);
