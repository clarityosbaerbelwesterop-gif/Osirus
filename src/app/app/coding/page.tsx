import { CodingSurface } from "@/components/coding/coding-surface";
import { requireProductSession } from "@/lib/product/session";
import {
  codingSelectionForRun,
  loadSurfaceThread,
} from "@/lib/product/surface-thread";

export const dynamic = "force-dynamic";

export default async function CodingPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string; new?: string }>;
}) {
  const { identity } = await requireProductSession();
  const params = await searchParams;
  const state = await loadSurfaceThread({
    userId: identity.userId,
    workspaceId: identity.workspaceId,
    surface: "coding",
    session: params.session,
    fresh: params.new,
  });
  const selection = await codingSelectionForRun(
    identity.userId,
    state.activeRunId ?? state.recentRunId,
  );
  return (
    <CodingSurface
      key={state.sessionId ?? "new"}
      initialSessionId={state.sessionId}
      initialMessages={state.messages}
      initialRunId={state.activeRunId}
      initialEffort={state.activeRunId && selection ? selection.effort : null}
      initialModel={selection?.model ?? null}
    />
  );
}
