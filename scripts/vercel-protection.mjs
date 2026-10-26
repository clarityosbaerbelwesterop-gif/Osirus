// Is production reachable for the public, and for Stripe? Reports the
// project's Deployment Protection settings and probes the public URL
// anonymously (a page, the health check, an unsigned webhook delivery).
// With OSIRUS_PUBLIC_PRODUCTION=true, protection that covers production is
// narrowed to preview deployments, the Vercel default.

const api = "https://api.vercel.com";
const token = process.env.VERCEL_TOKEN?.trim();
const projectId = process.env.VERCEL_PROJECT_ID?.trim();
const teamId = process.env.VERCEL_TEAM_ID?.trim();
if (!token || !projectId)
  throw new Error("VERCEL_TOKEN and VERCEL_PROJECT_ID are required");
const publicUrl =
  process.env.OSIRUS_PUBLIC_URL?.trim() || "https://osirus-ai.vercel.app";
const scope = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";

async function vercel(path, init = {}) {
  const response = await fetch(`${api}${path}${scope}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok)
    throw new Error(`Vercel ${path} answered HTTP ${response.status}`);
  return response.json();
}

const project = await vercel(`/v9/projects/${encodeURIComponent(projectId)}`);
const sso = project.ssoProtection ?? null;
const password = project.passwordProtection ?? null;
console.log(
  `Vercel Authentication: ${sso ? sso.deploymentType : "off"}; password protection: ${password ? password.deploymentType : "off"}; trusted IPs: ${project.trustedIps ? project.trustedIps.deploymentType : "off"}`,
);

async function probe(label, path, init) {
  const response = await fetch(new URL(path, publicUrl), {
    redirect: "manual",
    ...init,
  }).catch((error) => ({ status: `network error ${error.message}` }));
  const status = response.status;
  const challenge =
    typeof response.headers?.get === "function"
      ? [
          response.headers.get("www-authenticate") ? "www-authenticate" : "",
          response.headers.get("x-vercel-mitigated") ?? "",
          response.headers.get("location")?.includes("vercel.com/sso")
            ? "sso-redirect"
            : "",
        ]
          .filter(Boolean)
          .join(",")
      : "";
  console.log(`${label}: HTTP ${status}${challenge ? ` (${challenge})` : ""}`);
  return status;
}

await probe("Public page /", "/");
await probe("Health /api/health", "/api/health");
const webhook = await probe("Unsigned webhook POST", "/api/billing/webhook", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
});

const coversProduction = (setting) =>
  setting && setting.deploymentType !== "preview";
if (process.env.OSIRUS_PUBLIC_PRODUCTION === "true") {
  const body = {};
  if (coversProduction(sso)) body.ssoProtection = { deploymentType: "preview" };
  if (coversProduction(password)) body.passwordProtection = null;
  if (Object.keys(body).length) {
    await vercel(`/v9/projects/${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    console.log(
      `Narrowed protection to previews: ${Object.keys(body).join(", ")}`,
    );
    await probe("Unsigned webhook POST (after)", "/api/billing/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } else {
    console.log("Nothing to change: production is not protected.");
  }
} else if (webhook === 401 || webhook === 403) {
  console.log(
    "::warning::Production rejects anonymous requests: Stripe webhooks and visitors are blocked.",
  );
}
