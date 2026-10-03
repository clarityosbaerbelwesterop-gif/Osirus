import { ChatHub } from "@/components/chat/chat-hub";
import { loadSurfaceThread } from "@/lib/product/surface-thread";
import { requireProductSession } from "@/lib/product/session";

export const dynamic = "force-dynamic";

export default async function AgentPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string; new?: string }>;
}) {
  const { identity } = await requireProductSession();
  const params = await searchParams;
  const state = await loadSurfaceThread({
    userId: identity.userId,
    workspaceId: identity.workspaceId,
    surface: "agent",
    session: params.session,
    fresh: params.new,
  });

  return (
    <ChatHub
      kind="agent"
      key={state.sessionId ?? "new"}
      workspaceName={identity.workspaceName}
      initialSessionId={state.sessionId}
      initialMessages={state.messages}
      initialRunId={state.activeRunId}
      initialSnapshotRunId={state.recentRunId}
    />
  );
}
