import { z } from "zod";
import { queryAs } from "@/lib/db/client";
import { decryptSecret } from "@/lib/connectors/crypto";
import { githubCredential } from "@/lib/connectors/github";
import { guardWrite, json } from "@/lib/product/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Add a workspace webhook endpoint to a GitHub repository with the
// workspace's GitHub connection. The secret goes from the sealed column to
// GitHub and nowhere else.
const schema = z.object({
  repository: z.string().regex(/^[\w.-]{1,100}\/[\w.-]{1,100}$/),
  url: z.string().url().max(500),
});

const GITHUB_EVENTS: Record<string, string[]> = {
  push: ["push"],
  pull_request: ["pull_request"],
  ci_failure: ["workflow_run", "check_suite"],
  deployment: ["deployment_status"],
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ endpointId: string }> },
) {
  const id = z
    .string()
    .uuid()
    .safeParse((await params).endpointId).data;
  if (!id) return json({ error: "not_found" }, 404);
  const guard = await guardWrite(request, {
    schema,
    route: "webhooks.github",
    limit: 10,
    maxBytes: 2 * 1024,
  });
  if (!guard.ok) return guard.response;
  // The hook must point at this deployment's receiver for this endpoint.
  const expected = `${new URL(request.url).origin}/api/hooks/${id}`;
  if (guard.body.url !== expected)
    return json({ error: "invalid_request" }, 400);
  const [endpoint] = await queryAs<{
    source: string;
    events: string[];
    secret_sealed: string;
  }>(
    guard.identity.userId,
    `select source, events, secret_sealed from osirus.webhook_endpoints
      where id = $1::uuid and workspace_id = $2::uuid`,
    [id, guard.identity.workspaceId],
  ).catch(() => []);
  if (!endpoint || endpoint.source !== "github")
    return json({ error: "not_found" }, 404);
  const token = await githubCredential(guard.identity, "repo:write").catch(
    () => null,
  );
  if (!token) return json({ error: "github_not_connected" }, 409);
  const events = [
    ...new Set(
      (endpoint.events.length
        ? endpoint.events
        : Object.keys(GITHUB_EVENTS)
      ).flatMap((event) => GITHUB_EVENTS[event] ?? []),
    ),
  ];
  const response = await fetch(
    `https://api.github.com/repos/${guard.body.repository}/hooks`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "osirus",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "web",
        active: true,
        events: events.length ? events : ["push"],
        config: {
          url: expected,
          content_type: "json",
          secret: decryptSecret(endpoint.secret_sealed),
          insecure_ssl: "0",
        },
      }),
      signal: AbortSignal.timeout(10_000),
    },
  ).catch(() => null);
  if (!response) return json({ error: "github_unreachable" }, 502);
  if (response.status === 403 || response.status === 404)
    return json({ error: "github_permission" }, 403);
  if (!response.ok) return json({ error: "github_rejected" }, 400);
  return json({ added: true }, 201);
}
