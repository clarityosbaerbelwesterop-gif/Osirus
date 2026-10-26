import { RougeAgentSurface } from "@/components/rouge/rouge-agent-surface";
import { loadSurfaceThread } from "@/lib/product/surface-thread";
import { requireProductSession } from "@/lib/product/session";

export const dynamic = "force-dynamic";

/** Rouge Agent: autonomous runs with tools, approvals and a reviewer pass. */
export default async function RougeAgentPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string; new?: string; prompt?: string }>;
}) {
  const { identity } = await requireProductSession();
  const params = await searchParams;
  const state = await loadSurfaceThread({
    userId: identity.userId,
    workspaceId: identity.workspaceId,
    surface: "agent",
    session: params.session,
    // A new page visit starts a new task; old tasks open from the sidebar.
    fresh: params.session ? params.new : "1",
  });

  return (
    <RougeAgentSurface
      key={`agent:${state.sessionId ?? "new"}`}
      workspaceName={identity.workspaceName}
      initialSessionId={state.sessionId}
      initialMessages={state.messages}
      initialRunId={state.activeRunId}
      initialSnapshotRunId={state.recentRunId}
      initialPrompt={params.prompt?.slice(0, 8000) ?? null}
    />
  );
}
