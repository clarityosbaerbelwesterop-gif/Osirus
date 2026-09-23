import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChatHub } from "@/components/chat/chat-hub";
import { AppShell } from "@/components/shell/app-shell";
import { ApprovalList } from "@/components/approvals/approval-list";
import { AutomationList } from "@/components/automations/automation-list";
import { ConnectionsView } from "@/components/connections/connections-view";
import { InboxView } from "@/components/inbox/inbox-view";
import { AgentBehaviorSettings } from "@/components/settings/agent-behavior";
import { ModelStatusTable } from "@/components/settings/model-status";
import { SettingsNav } from "@/components/settings/settings-nav";
import { PageFrame } from "@/components/shell/page-frame";
import { resolvePolicy } from "@/lib/policy/model";
import { approvalView } from "@/lib/ui/approval-view";
import { fixturesEnabled } from "@/lib/ui/fixtures-flag";
import {
  approvalsFixture,
  automationsFixture,
  codingRunFixture,
  connectionsFixture,
  inboxFixture,
  modelStatusFixture,
  researchRunFixture,
  shellFixture,
} from "../fixtures";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "UI fixture",
  robots: { index: false },
};

export default async function FixturePage({
  params,
}: {
  params: Promise<{ surface: string }>;
}) {
  if (!fixturesEnabled()) notFound();
  const { surface } = await params;
  const shell = shellFixture();
  const chat = (snapshot: ReturnType<typeof codingRunFixture> | null) => (
    <AppShell data={shell}>
      <ChatHub
        firstName="Bärbel"
        workspaceName={shell.workspaceName}
        initialSessionId={snapshot?.run.sessionId ?? null}
        initialMessages={snapshot?.messages ?? []}
        initialRunId={null}
        initialSnapshotRunId={null}
        initialSnapshot={snapshot}
      />
    </AppShell>
  );

  switch (surface) {
    case "chat-empty":
      return chat(null);
    case "chat-active":
      return chat(codingRunFixture("active"));
    case "chat-coding":
      return chat(codingRunFixture("done"));
    case "chat-research":
      return chat(researchRunFixture());
    case "connections": {
      const data = connectionsFixture();
      return (
        <AppShell data={shell}>
          <PageFrame
            title="Connections"
            lede="What Osirus can reach on your behalf, and whether each connection works right now."
          >
            <ConnectionsView github={data.github} mcp={data.mcp} />
          </PageFrame>
        </AppShell>
      );
    }
    case "settings":
      return (
        <AppShell data={shell}>
          <PageFrame title="Settings">
            <div className="settings">
              <SettingsNav />
              <div className="settings-body">
                <section
                  className="card settings-group"
                  aria-labelledby="agent-heading"
                >
                  <div>
                    <h2 id="agent-heading">Agent behavior</h2>
                    <p className="section-lede">
                      What Osirus may do on its own in this workspace, and what
                      always needs your approval.
                    </p>
                  </div>
                  <AgentBehaviorSettings policy={resolvePolicy("balanced")} />
                </section>
                <section
                  className="card settings-group"
                  aria-labelledby="models-heading"
                >
                  <div>
                    <h2 id="models-heading">Models</h2>
                    <p className="section-lede">
                      Status from the model calls this workspace made in the
                      last 24 hours. Osirus never switches to a different model
                      when one fails.
                    </p>
                  </div>
                  <ModelStatusTable roles={modelStatusFixture()} />
                </section>
              </div>
            </div>
          </PageFrame>
        </AppShell>
      );
    case "approvals":
      return (
        <AppShell data={shell}>
          <PageFrame
            title="Approvals"
            lede="Every action Osirus asked you to decide, with what it would do and where. Each approval covers one exact call."
          >
            <ApprovalList
              items={approvalsFixture().map((item) => ({
                view: approvalView(item.row),
                runId: item.row.run_id,
                sessionId: item.sessionId,
                objective: item.objective,
              }))}
            />
          </PageFrame>
        </AppShell>
      );
    case "inbox":
      return (
        <AppShell data={shell}>
          <PageFrame
            title="Inbox"
            lede="Only what needs you or finished while you were away."
          >
            <InboxView
              items={inboxFixture()}
              unreadIds={["i2", "i3"]}
              emptyTitle="Nothing needs you right now."
            />
          </PageFrame>
        </AppShell>
      );
    case "automations":
      return (
        <AppShell data={shell}>
          <PageFrame
            title="Automations"
            lede="Objectives that run on their own: on a schedule or when something happens."
          >
            <AutomationList automations={automationsFixture()} />
          </PageFrame>
        </AppShell>
      );
    default:
      notFound();
  }
}
