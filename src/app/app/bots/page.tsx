import { BotSurface } from "@/components/bot/bot-surface";
import { loadSurfaceThread } from "@/lib/product/surface-thread";
import { requireProductSession } from "@/lib/product/session";

export const dynamic = "force-dynamic";

export default async function BotsPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string; new?: string }>;
}) {
  const { identity } = await requireProductSession();
  const params = await searchParams;
  const state = await loadSurfaceThread({
    userId: identity.userId,
    workspaceId: identity.workspaceId,
    surface: "bot",
    session: params.session,
    fresh: params.new,
  });
  return (
    <BotSurface
      key={`bot:${state.sessionId ?? "new"}`}
      workspaceName={identity.workspaceName}
      initialSessionId={state.sessionId}
      initialMessages={state.messages}
      initialRunId={state.activeRunId}
      initialSnapshotRunId={state.recentRunId}
    />
  );
}
