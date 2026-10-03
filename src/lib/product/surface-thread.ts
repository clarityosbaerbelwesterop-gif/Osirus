import "server-only";
import { codingPermissionFromInput } from "../coding/intent";
import { RuntimeRepository } from "../runtime/repository";
import { codingGrantFromRunInput, type SessionSurface } from "./surfaces";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const empty = {
  sessionId: null as string | null,
  surface: null as SessionSurface | null,
  messages: [] as Array<{
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    createdAt?: string;
    runId?: string | null;
    caption?: string | null;
  }>,
  activeRunId: null as string | null,
  recentRunId: null as string | null,
};

export async function loadSurfaceThread(input: {
  userId: string;
  workspaceId: string;
  surface: SessionSurface;
  session?: string;
  fresh?: string;
}) {
  if (input.fresh === "1") return { ...empty, surface: input.surface };
  const repository = new RuntimeRepository(input.userId);
  if (input.session && UUID.test(input.session)) {
    const state = await repository
      .getSessionState(input.session, input.workspaceId)
      .catch(() => null);
    if (!state || state.surface !== input.surface)
      return { ...empty, surface: input.surface };
    return state;
  }
  return repository.getRecentWorkspaceState(input.workspaceId, input.surface);
}

export async function codingSelectionForRun(
  userId: string,
  runId: string | null,
) {
  if (!runId) return null;
  const repository = new RuntimeRepository(userId);
  const input = await repository.getRunInput(runId).catch(() => null);
  return codingGrantFromRunInput(input);
}

/** Selection plus whether that coding run is paused. No connector secret. */
export async function codingRunControl(userId: string, runId: string | null) {
  if (!runId) return { selection: null, permission: null, paused: false };
  const repository = new RuntimeRepository(userId);
  const [input, run] = await Promise.all([
    repository.getRunInput(runId).catch(() => null),
    repository.getRun(runId).catch(() => null),
  ]);
  return {
    selection: codingGrantFromRunInput(input),
    permission: codingPermissionFromInput(input),
    paused: Boolean(run?.paused_at),
  };
}
