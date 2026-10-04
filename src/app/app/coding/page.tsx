import { CodingSurface } from "@/components/coding/coding-surface";
import { requireProductSession } from "@/lib/product/session";
import {
  codingRunControl,
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
  const control = await codingRunControl(
    identity.userId,
    state.activeRunId ?? state.recentRunId,
  );
  const selection = control.selection;
  return (
    <CodingSurface
      key={`coding:${state.sessionId ?? "new"}`}
      initialSessionId={state.sessionId}
      initialMessages={state.messages}
      initialRunId={state.activeRunId}
      initialEffort={state.activeRunId && selection ? selection.effort : null}
      initialEffortChosen={Boolean(
        state.activeRunId && selection?.effortChosen,
      )}
      initialPaused={Boolean(state.activeRunId && control.paused)}
      initialModel={selection?.model ?? null}
      initialPermission={
        control.permission === "accept-edits" ? "accept-edits" : "ask"
      }
    />
  );
}
