import { ChatHub } from "@/components/chat/chat-hub";
import { RuntimeRepository } from "@/lib/runtime/repository";
import { onboardingSteps } from "@/lib/product/onboarding";
import { firstName, requireProductSession } from "@/lib/product/session";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AppPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string; new?: string }>;
}) {
  const { user, identity } = await requireProductSession();
  const params = await searchParams;
  const repository = new RuntimeRepository(identity.userId);

  const empty = {
    sessionId: null,
    messages: [],
    activeRunId: null,
    recentRunId: null,
  };
  const state =
    params.new === "1"
      ? empty
      : params.session && UUID.test(params.session)
        ? await repository
            .getSessionState(params.session, identity.workspaceId)
            .catch(() => empty)
        : await repository.getRecentWorkspaceState(identity.workspaceId);

  const onboarding = state.sessionId
    ? undefined
    : await onboardingSteps(identity).catch(() => undefined);

  return (
    <ChatHub
      onboarding={onboarding}
      key={state.sessionId ?? "new"}
      firstName={firstName(user)}
      workspaceName={identity.workspaceName}
      initialSessionId={state.sessionId}
      initialMessages={state.messages}
      initialRunId={state.activeRunId}
      initialSnapshotRunId={state.recentRunId}
    />
  );
}
