import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppearanceSettings } from "@/components/settings/appearance";
import {
  MemoryConflictList,
  MemoryList,
} from "@/components/settings/memory-list";
import { ModelStatusTable } from "@/components/settings/model-status";
import { AgentBehaviorSettings } from "@/components/settings/agent-behavior";
import { SecurityEventList } from "@/components/settings/security-events";
import { Badge } from "@/components/ui/badge";
import { githubConnectorStatus } from "@/lib/connectors/github";
import { listMcpServers } from "@/lib/connectors/mcp-store";
import { modelStatus } from "@/lib/product/model-status";
import { requireProductSession } from "@/lib/product/session";
import {
  memoryOverview,
  usageSummary,
  workspaceInfo,
} from "@/lib/product/settings";
import { isOrganizationAdmin } from "@/lib/product/shell";
import { loadWorkspacePolicy } from "@/lib/policy/store";
import { listSecurityEvents } from "@/lib/security/events-read";
import { formatCount, formatUsd, humanize } from "@/lib/ui/labels";

export const dynamic = "force-dynamic";

const TITLES: Record<string, string> = {
  workspace: "Workspace",
  connections: "Connections",
  models: "Models",
  memory: "Memory",
  agent: "Agent behavior",
  security: "Security",
  usage: "Usage",
  appearance: "Appearance",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ section: string }>;
}): Promise<Metadata> {
  const { section } = await params;
  return { title: TITLES[section] ?? "Settings" };
}

function Group({
  id,
  title,
  lede,
  children,
}: {
  id: string;
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card settings-group" aria-labelledby={`${id}-heading`}>
      <div>
        <h2 id={`${id}-heading`}>{title}</h2>
        {lede ? <p className="section-lede">{lede}</p> : null}
      </div>
      {children}
    </section>
  );
}

export default async function SettingsSection({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!TITLES[section]) notFound();
  const { identity } = await requireProductSession();

  switch (section) {
    case "workspace": {
      const info = await workspaceInfo(identity);
      return (
        <Group id="workspace" title="Workspace">
          <dl className="settings-rows">
            <div>
              <dt>Name</dt>
              <dd>{info.name}</dd>
            </div>
            <div>
              <dt>Your role</dt>
              <dd>{info.workspaceRole ? humanize(info.workspaceRole) : "—"}</dd>
            </div>
            <div>
              <dt>Organization role</dt>
              <dd>
                {info.organizationRole ? humanize(info.organizationRole) : "—"}
              </dd>
            </div>
            <div>
              <dt>Members</dt>
              <dd className="tabular">{info.members}</dd>
            </div>
            <div>
              <dt>Data isolation</dt>
              <dd>
                Every query runs as you under row-level security. Other
                workspaces cannot read or change anything here.
              </dd>
            </div>
          </dl>
        </Group>
      );
    }
    case "connections": {
      const [github, servers] = await Promise.all([
        githubConnectorStatus(identity).catch(() => null),
        listMcpServers(identity).catch(() => []),
      ]);
      return (
        <Group
          id="connections"
          title="Connections"
          lede="A summary. Manage connections and check their health on the Connections page."
        >
          <dl className="settings-rows">
            <div>
              <dt>GitHub</dt>
              <dd>
                {github?.status === "CONNECTED"
                  ? `Connected as ${github.login}`
                  : github?.status === "NOT_CONFIGURED"
                    ? "Not configured on this deployment"
                    : "Not connected"}
              </dd>
            </div>
            <div>
              <dt>MCP servers</dt>
              <dd className="tabular">
                {servers.length
                  ? `${servers.length} server${servers.length === 1 ? "" : "s"}, ${servers.reduce((sum, server) => sum + server.enabledToolCount, 0)} tools enabled`
                  : "None"}
              </dd>
            </div>
          </dl>
          <div>
            <Link
              className="btn btn-secondary"
              href={"/app/connections" as Route}
            >
              Open Connections
            </Link>
          </div>
        </Group>
      );
    }
    case "models": {
      const admin = await isOrganizationAdmin(identity);
      const roles = await modelStatus(identity, admin);
      return (
        <Group
          id="models"
          title="Models"
          lede="Status from the model calls this workspace made in the last 24 hours. Osirus never switches to a different model when one fails."
        >
          <ModelStatusTable roles={roles} />
        </Group>
      );
    }
    case "memory": {
      const memory = await memoryOverview(identity);
      return (
        <Group
          id="memory"
          title="Memory"
          lede="What Osirus learned from earlier work in this workspace. Verified items inform later runs. Suspected contradictions stay out of retrieval until you resolve them."
        >
          <div className="row row-wrap">
            <Badge>{memory.total} items</Badge>
            <Badge tone="success">{memory.verified} verified</Badge>
            {memory.contradictions ? (
              <Badge tone="warning">{memory.contradictions} need review</Badge>
            ) : null}
          </div>
          {memory.conflictQueue.length ? (
            <>
              <p className="subtle">
                <strong>Contradictions.</strong> These memories disagree on the
                same subject. Osirus excludes them from retrieval until you pick
                the value to keep.
              </p>
              <MemoryConflictList items={memory.conflictQueue} />
            </>
          ) : null}
          {memory.items.length ? (
            <MemoryList items={memory.items} />
          ) : memory.conflictQueue.length ? null : (
            <p className="subtle">Nothing has been remembered yet.</p>
          )}
        </Group>
      );
    }
    case "agent": {
      const policy = await loadWorkspacePolicy(identity);
      return (
        <Group
          id="agent"
          title="Agent behavior"
          lede="What Osirus may do on its own in this workspace, and what always needs your approval."
        >
          <AgentBehaviorSettings policy={policy} />
        </Group>
      );
    }
    case "security": {
      const events = await listSecurityEvents(identity, { limit: 50 });
      return (
        <Group
          id="security"
          title="Security"
          lede="What Osirus's guards stopped or changed. Nothing here needs action unless it says so."
        >
          <div className="row row-wrap">
            <Link
              className="btn btn-secondary btn-sm"
              href={"/app/approvals" as Route}
            >
              Approvals
            </Link>
            <Link
              className="btn btn-secondary btn-sm"
              href={"/app/audit" as Route}
            >
              Audit log
            </Link>
          </div>
          <SecurityEventList events={events} />
        </Group>
      );
    }
    case "usage": {
      const usage = await usageSummary(identity, 30);
      return (
        <Group
          id="usage"
          title="Usage"
          lede="The last 30 days in this workspace."
        >
          <div className="metric-grid">
            <div className="metric">
              <span className="metric-label">Runs</span>
              <span className="metric-value">{formatCount(usage.runs)}</span>
              <span className="metric-note">
                {usage.completedRuns} completed
              </span>
            </div>
            <div className="metric">
              <span className="metric-label">Model calls</span>
              <span className="metric-value">
                {formatCount(usage.modelCalls)}
              </span>
            </div>
            <div className="metric">
              <span className="metric-label">Tokens</span>
              <span className="metric-value">
                {formatCount(usage.inputTokens + usage.outputTokens)}
              </span>
              <span className="metric-note">
                {formatCount(usage.inputTokens)} in ·{" "}
                {formatCount(usage.outputTokens)} out
              </span>
            </div>
            <div className="metric">
              <span className="metric-label">Estimated cost</span>
              <span className="metric-value">{formatUsd(usage.costUsd)}</span>
              <span className="metric-note">As reported by the provider</span>
            </div>
            <div className="metric">
              <span className="metric-label">Tool calls</span>
              <span className="metric-value">
                {formatCount(usage.toolCalls)}
              </span>
            </div>
          </div>
          {usage.byRole.length ? (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Usage by model role</caption>
                <thead>
                  <tr>
                    <th scope="col">Model role</th>
                    <th scope="col" className="num">
                      Calls
                    </th>
                    <th scope="col" className="num">
                      Tokens
                    </th>
                    <th scope="col" className="num">
                      Cost
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {usage.byRole.map((row) => (
                    <tr key={row.role}>
                      <td>{humanize(row.role.toLowerCase())}</td>
                      <td className="num">{formatCount(row.calls)}</td>
                      <td className="num">{formatCount(row.tokens)}</td>
                      <td className="num">{formatUsd(row.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Group>
      );
    }
    case "appearance":
      return (
        <Group id="appearance" title="Appearance">
          <AppearanceSettings />
        </Group>
      );
    default:
      notFound();
  }
}
