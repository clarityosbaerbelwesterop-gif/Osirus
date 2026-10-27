import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentsChat } from "@/components/agents-chat/agents-chat";
import { BotsHub } from "@/components/bots/bots-hub";
import { GroupRoom } from "@/components/bots/group-room";
import { HistoryBrowser } from "@/components/bots/history-browser";
import { RougeAgentSurface } from "@/components/rouge/rouge-agent-surface";
import { ChatHub } from "@/components/chat/chat-hub";
import { WorkStudio } from "@/components/work/work-studio";
import { CodingSurface } from "@/components/coding/coding-surface";
import { AppShell } from "@/components/shell/app-shell";
import { ApprovalList } from "@/components/approvals/approval-list";
import { AutomationList } from "@/components/automations/automation-list";
import { ConnectionsView } from "@/components/connections/connections-view";
import { InboxView } from "@/components/inbox/inbox-view";
import { IntelligenceLab } from "@/components/intelligence/lab";
import { AgentBehaviorSettings } from "@/components/settings/agent-behavior";
import { AppearanceSettings } from "@/components/settings/appearance";
import { ModelStatusTable } from "@/components/settings/model-status";
import { SettingsNav } from "@/components/settings/settings-nav";
import { PageFrame } from "@/components/shell/page-frame";
import { resolvePolicy } from "@/lib/policy/model";
import { approvalView } from "@/lib/ui/approval-view";
import { recommendWork } from "@/lib/work/recommend";
import { fixturesEnabled } from "@/lib/ui/fixtures-flag";
import {
  ago,
  approvalsFixture,
  automationsFixture,
  codingRunFixture,
  connectionsFixture,
  inboxFixture,
  intelligenceLabFixture,
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
        workspaceName={shell.workspaceName}
        initialSessionId={snapshot?.run.sessionId ?? null}
        initialMessages={snapshot?.messages ?? []}
        initialRunId={null}
        initialSnapshotRunId={null}
        initialSnapshot={snapshot}
        screenshotLayout={snapshot?.run.status === "waiting_for_approval"}
      />
    </AppShell>
  );

  const bots = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Ada",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Research-Bot",
    },
  ];

  switch (surface) {
    case "agents-empty":
      return (
        <AppShell data={shell}>
          <AgentsChat initialThread={null} bots={bots} greetingName="Bärbel" />
        </AppShell>
      );
    case "rouge-empty":
      return (
        <AppShell data={shell}>
          <RougeAgentSurface
            workspaceName={shell.workspaceName}
            initialSessionId={null}
            initialMessages={[]}
            initialRunId={null}
            initialSnapshotRunId={null}
          />
        </AppShell>
      );
    case "agents-thread":
      return (
        <AppShell data={shell}>
          <AgentsChat
            initialThread={{
              sessionId: "33333333-3333-4333-8333-333333333333",
              title: "Postgres Job-Queue migrieren",
              messages: [
                {
                  id: "m1",
                  role: "user",
                  content:
                    "Wie migriere ich eine Postgres Job-Queue von Polling auf LISTEN/NOTIFY, ohne Jobs zu verlieren?",
                },
                {
                  id: "m2",
                  role: "assistant",
                  reasoning:
                    "Polling und Notify parallel betreiben, dann umschalten. Rückweg muss jederzeit möglich sein.",
                  content:
                    "**Kurz:** Beide Wege parallel betreiben, dann umschalten. Jeder Schritt ist umkehrbar.\n\n1. **Trigger anlegen**, der bei `INSERT` ein `NOTIFY jobs` sendet.\n2. **Worker hören zu** und pollen weiter alle 30 s als Sicherheitsnetz.\n3. **Polling-Intervall erhöhen**, sobald die Latenz stabil ist.\n\n```sql\ncreate function notify_job() returns trigger as $$\nbegin\n  perform pg_notify('jobs', new.id::text);\n  return new;\nend $$ language plpgsql;\n```\n\n| Schritt | Risiko | Rückweg |\n| --- | --- | --- |\n| Trigger | gering | `drop trigger` |\n| Listener | gering | Polling bleibt aktiv |",
                },
              ],
            }}
            bots={bots}
            greetingName="Bärbel"
          />
        </AppShell>
      );
    case "work":
      return (
        <AppShell data={shell}>
          <PageFrame
            title="Work"
            lede="Zuerst die Aufgabe. Danach empfiehlt Osirus Modell, Prüfer und Subagents."
          >
            <WorkStudio
              initialRecommendation={recommendWork(
                "Erkläre MVCC in einem Satz.",
              )}
            />
          </PageFrame>
        </AppShell>
      );
    case "agents":
      return (
        <AppShell data={shell}>
          <PageFrame
            title="Bots"
            lede="Dein Team aus Spezialisten. Jeder Bot hat seinen eigenen Raum."
          >
            <BotsHub
              bots={[
                {
                  id: bots[0].id,
                  name: "Ada",
                  status: "active",
                  role: "Software Engineer",
                  tier: "top",
                },
                {
                  id: bots[1].id,
                  name: "Bea",
                  status: "active",
                  role: "Research Analyst",
                  tier: "top",
                },
              ]}
              groups={[
                {
                  id: "44444444-4444-4444-8444-444444444444",
                  title: "Launch-Team",
                  updatedAt: ago(3_600_000),
                  members: [
                    { id: bots[0].id, name: "Ada" },
                    { id: bots[1].id, name: "Bea" },
                  ],
                  messageCount: 3,
                  last: {
                    role: "agent",
                    agentId: bots[1].id,
                    content: "Drei Wettbewerber, eine klare Lücke.",
                  },
                },
              ]}
            />
          </PageFrame>
        </AppShell>
      );
    case "agents-room":
      return (
        <AppShell data={shell}>
          <AgentsChat
            initialThread={null}
            bots={bots}
            greetingName="Bärbel"
            room={{
              bot: bots[0],
              role: "Software Engineer",
              conversations: [
                {
                  id: "55555555-5555-4555-8555-555555555555",
                  title: "Code-Review für den Checkout",
                  updatedAt: ago(7_200_000),
                },
              ],
            }}
          />
        </AppShell>
      );
    case "agents-group":
      return (
        <AppShell data={shell}>
          <GroupRoom
            group={{
              id: "44444444-4444-4444-8444-444444444444",
              title: "Launch-Team",
              members: [
                { id: bots[0].id, name: "Ada" },
                { id: bots[1].id, name: "Bea" },
              ],
            }}
            initialMessages={[
              {
                id: "g1",
                role: "user",
                agentId: null,
                content: "@Bea wer sind unsere Wettbewerber?",
                status: "stored",
                createdAt: ago(600_000),
              },
              {
                id: "g2",
                role: "agent",
                agentId: bots[1].id,
                content: "Drei Wettbewerber, eine klare Lücke: **Freigaben**.",
                status: "completed",
                createdAt: ago(590_000),
              },
            ]}
          />
        </AppShell>
      );
    case "history":
      return (
        <AppShell data={shell}>
          <PageFrame
            title="Verlauf"
            lede="Alles, was du mit Osirus besprochen hast."
          >
            <HistoryBrowser
              entries={[
                {
                  id: "h1",
                  title: "Postgres Job-Queue migrieren",
                  updatedAt: ago(300_000),
                  kind: "chat",
                  href: "/app?session=h1",
                  seeds: [],
                  detail: null,
                },
                {
                  id: "h2",
                  title: "Code-Review für den Checkout",
                  updatedAt: ago(7_200_000),
                  kind: "bot",
                  href: `/app/agents/${bots[0].id}?session=h2`,
                  seeds: [bots[0].id],
                  detail: "Ada",
                },
                {
                  id: "44444444-4444-4444-8444-444444444444",
                  title: "Launch-Team",
                  updatedAt: ago(90_000_000),
                  kind: "group",
                  href: "/app/agents/groups/44444444-4444-4444-8444-444444444444",
                  seeds: [bots[0].id, bots[1].id],
                  detail: "Ada, Bea",
                },
                {
                  id: "h4",
                  title: "Release-Notes schreiben",
                  updatedAt: ago(400_000_000),
                  kind: "rouge",
                  href: "/app/agent?session=h4",
                  seeds: [],
                  detail: null,
                },
              ]}
            />
          </PageFrame>
        </AppShell>
      );
    case "chat-empty":
      return chat(null);
    case "chat-active":
      return chat(codingRunFixture("active"));
    case "chat-coding":
      return chat(codingRunFixture("done"));
    case "coding":
      return (
        <AppShell data={shell}>
          <CodingSurface
            initialSessionId={null}
            initialMessages={[]}
            initialRunId={null}
            initialEffort={null}
            initialModel={null}
          />
        </AppShell>
      );
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
            <ConnectionsView
              github={data.github}
              mcp={data.mcp}
              platforms={data.platforms}
              webhooks={data.webhooks}
            />
          </PageFrame>
        </AppShell>
      );
    }
    case "tour":
      return (
        <AppShell data={{ ...shell, tour: { open: true } }}>
          <PageFrame title="Agents">
            <p>Willkommen.</p>
          </PageFrame>
        </AppShell>
      );
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
                <section
                  className="card settings-group"
                  aria-labelledby="appearance-heading"
                >
                  <div>
                    <h2 id="appearance-heading">Appearance</h2>
                  </div>
                  <AppearanceSettings />
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
    case "intelligence":
      return (
        <AppShell data={shell}>
          <PageFrame
            title="Intelligence Lab"
            lede="The Foundry: what it measured, what it is testing, what it kept and why. Internal; customers never see it."
          >
            <IntelligenceLab view={intelligenceLabFixture()} canRunNow />
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
