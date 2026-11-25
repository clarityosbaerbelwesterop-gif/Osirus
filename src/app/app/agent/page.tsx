import { RougeAgentSurface } from "@/components/rouge/rouge-agent-surface";
import { currentSubscription } from "@/lib/billing/store";
import { modelAccessFor } from "@/lib/gateway/access";
import { loadSurfaceThread } from "@/lib/product/surface-thread";
import { requireProductSession } from "@/lib/product/session";

export const dynamic = "force-dynamic";

/** Rouge Agent: autonomous runs with tools, approvals and a reviewer pass. */
export default async function RougeAgentPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string; new?: string; prompt?: string }>;
}) {
  const { identity, user } = await requireProductSession();
  const params = await searchParams;
  const [state, access, subscription] = await Promise.all([
    loadSurfaceThread({
      userId: identity.userId,
      workspaceId: identity.workspaceId,
      surface: "agent",
      session: params.session,
      // A new page visit starts a new task; old tasks open from the sidebar.
      fresh: params.session ? params.new : "1",
    }),
    modelAccessFor({
      userId: identity.userId,
      email: user.email,
      emailVerified: user.emailVerified,
    }),
    currentSubscription(identity.userId).catch(() => null),
  ]);

  return (
    <RougeAgentSurface
      key={`agent:${state.sessionId ?? `new:${params.prompt ?? ""}`}`}
      workspaceName={identity.workspaceName}
      initialSessionId={state.sessionId}
      initialMessages={state.messages}
      initialRunId={state.activeRunId}
      initialSnapshotRunId={state.recentRunId}
      initialPrompt={params.prompt?.slice(0, 8000) ?? null}
      // The Rouge Agent runs on premium models: a paid plan's (owner's
      // decision 2026-11-25). Past tasks stay readable on the free plan.
      planLocked={access.freeOnly ? { trialEligible: !subscription } : null}
    />
  );
}
