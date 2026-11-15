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
import { ProviderStatusTable } from "@/components/settings/provider-status";
import { isOwnerEmail } from "@/lib/gateway/access";
import { listGatewayModels } from "@/lib/gateway/models";
import { PROVIDER_IDS, providerLabel } from "@/lib/gateway/providers";
import { AgentBehaviorSettings } from "@/components/settings/agent-behavior";
import { SecurityEventList } from "@/components/settings/security-events";
import { PrivacyControls } from "@/components/settings/privacy-controls";
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
  workspace: "Arbeitsbereich",
  connections: "Verbindungen",
  models: "Modelle",
  memory: "Gedächtnis",
  agent: "Agentenverhalten",
  security: "Sicherheit",
  privacy: "Datenschutz",
  usage: "Verbrauch",
  appearance: "Darstellung",
};

const ROLE_LABEL: Record<string, string> = {
  owner: "Inhaber",
  admin: "Admin",
  member: "Mitglied",
  editor: "Bearbeiter",
  viewer: "Betrachter",
};

const roleLabel = (role: string) => ROLE_LABEL[role] ?? humanize(role);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ section: string }>;
}): Promise<Metadata> {
  const { section } = await params;
  return { title: TITLES[section] ?? "Einstellungen" };
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
  const { identity, user } = await requireProductSession();

  switch (section) {
    case "workspace": {
      const info = await workspaceInfo(identity);
      return (
        <Group id="workspace" title="Arbeitsbereich">
          <dl className="settings-rows">
            <div>
              <dt>Name</dt>
              <dd>{info.name}</dd>
            </div>
            <div>
              <dt>Deine Rolle</dt>
              <dd>
                {info.workspaceRole ? roleLabel(info.workspaceRole) : "—"}
              </dd>
            </div>
            <div>
              <dt>Rolle in der Organisation</dt>
              <dd>
                {info.organizationRole ? roleLabel(info.organizationRole) : "—"}
              </dd>
            </div>
            <div>
              <dt>Mitglieder</dt>
              <dd className="tabular">{info.members}</dd>
            </div>
            <div>
              <dt>Datentrennung</dt>
              <dd>
                Jede Abfrage läuft unter Row-Level-Security in deinem Namen.
                Andere Arbeitsbereiche können hier nichts lesen oder ändern.
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
          title="Verbindungen"
          lede="Eine Übersicht. Verbindungen verwaltest und prüfst du auf der Seite Verbindungen."
        >
          <dl className="settings-rows">
            <div>
              <dt>GitHub</dt>
              <dd>
                {github?.status === "CONNECTED"
                  ? `Verbunden als ${github.login}`
                  : github?.status === "NOT_CONFIGURED"
                    ? "In dieser Installation nicht eingerichtet"
                    : "Nicht verbunden"}
              </dd>
            </div>
            <div>
              <dt>MCP-Server</dt>
              <dd className="tabular">
                {servers.length
                  ? `${servers.length} Server, ${servers.reduce((sum, server) => sum + server.enabledToolCount, 0)} Werkzeuge aktiviert`
                  : "Keine"}
              </dd>
            </div>
          </dl>
          <div>
            <Link
              className="btn btn-secondary"
              href={"/app/connections" as Route}
            >
              Verbindungen öffnen
            </Link>
          </div>
        </Group>
      );
    }
    case "models": {
      // Which services run the models is operator knowledge: only owner
      // sign-ins (OSIRUS_OWNER_EMAILS) see providers, keys and model ids.
      if (!isOwnerEmail(user.email, user.emailVerified)) {
        return (
          <Group
            id="models"
            title="Modelle"
            lede="Osirus wählt für Agents, Bots und den Rouge Agent automatisch das passende Modell: nach Schwierigkeit und Umfang der Aufgabe und nach der Rolle eines Bots. In Code wählst du das Modell selbst."
          >
            <p className="subtle">
              Deinen Verbrauch siehst du unter Verbrauch und in der
              Seitenleiste.
            </p>
          </Group>
        );
      }
      const admin = await isOrganizationAdmin(identity);
      const [roles, listing] = await Promise.all([
        modelStatus(identity, admin),
        listGatewayModels(),
      ]);
      const ENV_VARS: Record<string, string> = {
        openrouter: "OPENROUTER_API_KEY",
        nvidia: "NVIDIA_API_KEY",
        unorouter: "UNOROUTER_API_KEY_1",
        lightning: "LIGHTNING_AI_API_KEY",
        bytez: "BYTEZ_API_KEY",
      };
      const providerRows = PROVIDER_IDS.map((id) => {
        const status = listing.providers.find((provider) => provider.id === id);
        return {
          id,
          label: providerLabel(id),
          envVar: ENV_VARS[id],
          configured: Boolean(status),
          ok: Boolean(status?.ok),
          models: status?.models ?? 0,
        };
      });
      return (
        <>
          <Group
            id="providers"
            title="Anbieter"
            lede={`${listing.models.length} Chat-Modelle von allen Anbietern, deren Key in dieser Umgebung gesetzt ist. Ein Anbieter ohne Key erscheint nirgends im Produkt.`}
          >
            <ProviderStatusTable rows={providerRows} />
          </Group>
          <Group
            id="models"
            title="Modellrollen"
            lede="Status aus den Modellaufrufen dieses Arbeitsbereichs in den letzten 24 Stunden. Osirus wechselt nicht zu einem anderen Modell, wenn eines ausfällt."
          >
            <ModelStatusTable roles={roles} />
          </Group>
        </>
      );
    }
    case "memory": {
      const memory = await memoryOverview(identity);
      return (
        <Group
          id="memory"
          title="Gedächtnis"
          lede="Was Osirus aus früherer Arbeit in diesem Arbeitsbereich gelernt hat. Geprüfte Einträge fließen in spätere Läufe ein. Vermutete Widersprüche bleiben aus der Suche ausgeschlossen, bis du sie auflöst."
        >
          <div className="row row-wrap">
            <Badge>{memory.total} Einträge</Badge>
            <Badge tone="success">{memory.verified} geprüft</Badge>
            {memory.contradictions ? (
              <Badge tone="warning">{memory.contradictions} zu prüfen</Badge>
            ) : null}
          </div>
          {memory.conflictQueue.length ? (
            <>
              <p className="subtle">
                <strong>Widersprüche.</strong> Diese Einträge widersprechen sich
                beim selben Thema. Osirus schließt sie aus der Suche aus, bis du
                den Wert wählst, der bleiben soll.
              </p>
              <MemoryConflictList items={memory.conflictQueue} />
            </>
          ) : null}
          {memory.items.length ? (
            <MemoryList items={memory.items} />
          ) : memory.conflictQueue.length ? null : (
            <p className="subtle">Bisher ist nichts gespeichert.</p>
          )}
        </Group>
      );
    }
    case "agent": {
      const policy = await loadWorkspacePolicy(identity);
      return (
        <Group
          id="agent"
          title="Agentenverhalten"
          lede="Was Osirus in diesem Arbeitsbereich selbst tun darf und was immer deine Freigabe braucht."
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
          title="Sicherheit"
          lede="Was die Schutzmechanismen von Osirus gestoppt oder geändert haben. Hier musst du nur handeln, wenn es dasteht."
        >
          <div className="row row-wrap">
            <Link
              className="btn btn-secondary btn-sm"
              href={"/app/approvals" as Route}
            >
              Freigaben
            </Link>
            <Link
              className="btn btn-secondary btn-sm"
              href={"/app/audit" as Route}
            >
              Audit-Log
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
          title="Verbrauch"
          lede="Die letzten 30 Tage in diesem Arbeitsbereich."
        >
          <div className="metric-grid">
            <div className="metric">
              <span className="metric-label">Läufe</span>
              <span className="metric-value">{formatCount(usage.runs)}</span>
              <span className="metric-note">
                {usage.completedRuns} abgeschlossen
              </span>
            </div>
            <div className="metric">
              <span className="metric-label">Modellaufrufe</span>
              <span className="metric-value">
                {formatCount(usage.modelCalls)}
              </span>
            </div>
            <div className="metric">
              <span className="metric-label">Geschätzte Kosten</span>
              <span className="metric-value">{formatUsd(usage.costUsd)}</span>
              <span className="metric-note">Laut Anbieter</span>
            </div>
            <div className="metric">
              <span className="metric-label">Werkzeugaufrufe</span>
              <span className="metric-value">
                {formatCount(usage.toolCalls)}
              </span>
            </div>
          </div>
          {usage.byRole.length ? (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">
                  Verbrauch nach Modellrolle
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Modellrolle</th>
                    <th scope="col" className="num">
                      Aufrufe
                    </th>
                    <th scope="col" className="num">
                      Kosten
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {usage.byRole.map((row) => (
                    <tr key={row.role}>
                      <td>{humanize(row.role.toLowerCase())}</td>
                      <td className="num">{formatCount(row.calls)}</td>
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
    case "privacy":
      return (
        <Group
          id="privacy"
          title="Datenschutz"
          lede="Deine Rechte nach DSGVO, ohne Formular und ohne Wartezeit."
        >
          <PrivacyControls />
          <p className="muted">
            Details:{" "}
            <Link href={"/legal/privacy" as Route}>Datenschutzerklärung</Link>
          </p>
        </Group>
      );
    case "appearance":
      return (
        <Group id="appearance" title="Darstellung">
          <AppearanceSettings />
        </Group>
      );
    default:
      notFound();
  }
}
