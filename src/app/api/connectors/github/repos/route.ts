import { guardRead, json } from "@/lib/product/api";
import {
  githubListMessage,
  listGrantedRepositories,
} from "@/lib/connectors/github";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Coding only. Chat, agent, and bot do not call this route.
export async function GET() {
  const guard = await guardRead({ route: "github.repos", limit: 30 });
  if (!guard.ok) return guard.response;
  const identity = guard.identity;
  const listed = await listGrantedRepositories(identity);
  if (!listed.ok) {
    return json(
      {
        ok: false,
        error: listed.error,
        message: githubListMessage(listed.error, listed.status),
      },
      listed.error === "not_configured" ? 503 : 409,
    );
  }
  return json({ ok: true, repositories: listed.repositories });
}
