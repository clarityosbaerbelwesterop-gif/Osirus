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

/**
 * Opening a surface with no session is a new empty thread. A thread from
 * another surface is not rendered here, even if it was the last one open.
 */
export function openedSurfaceThread<
  T extends { surface: SessionSurface | null; messages: unknown[] },
>(input: { surface: SessionSurface; state: T | null; hasSession: boolean }) {
  if (!input.hasSession) return null;
  if (!input.state || input.state.surface !== input.surface) return null;
  return input.state;
}

export async function loadSurfaceThread(input: {
  userId: string;
  workspaceId: string;
  surface: SessionSurface;
  session?: string;
  fresh?: string;
}) {
  const blank = { ...empty, surface: input.surface };
  if (input.fresh === "1") return blank;
  const hasSession = Boolean(input.session && UUID.test(input.session));
  if (!hasSession) return blank;
  const repository = new RuntimeRepository(input.userId);
  const state = await repository
    .getSessionState(input.session!, input.workspaceId)
    .catch(() => null);
  const opened = openedSurfaceThread({
    surface: input.surface,
    state,
    hasSession: true,
  });
  return opened ?? blank;
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
