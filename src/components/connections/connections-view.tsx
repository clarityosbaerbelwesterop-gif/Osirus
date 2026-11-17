import type { McpServerView } from "@/lib/connectors/mcp-types";
import { GithubCard, type GithubCardData } from "./github-card";
import { McpManager } from "./mcp-manager";
import { PlatformCard, type PlatformCardData } from "./platform-card";
import { WebhooksCard, type WebhookEndpointData } from "./webhooks-card";

export function ConnectionsView({
  github,
  mcp,
  platforms = [],
  webhooks = { endpoints: [], available: false },
}: {
  github: GithubCardData;
  mcp: { servers: McpServerView[]; available: boolean };
  platforms?: PlatformCardData[];
  webhooks?: { endpoints: WebhookEndpointData[]; available: boolean };
}) {
  return (
    <>
      <section className="section" aria-labelledby="code-heading">
        <h2 className="section-title" id="code-heading">
          Code
        </h2>
        <GithubCard data={github} />
      </section>
      <section className="section" aria-labelledby="mcp-heading">
        <div>
          <h2 className="section-title" id="mcp-heading">
            MCP-Server
          </h2>
          <p className="section-lede">
            Werkzeuge von Servern, die du hinzufügst. Du entscheidest, welche
            Werkzeuge Osirus nutzen darf, und es fragt vor jedem Aufruf.
          </p>
        </div>
        <McpManager servers={mcp.servers} available={mcp.available} />
      </section>
      <section className="section" aria-labelledby="platforms-heading">
        <div>
          <h2 className="section-title" id="platforms-heading">
            Plattformen
          </h2>
          <p className="section-lede">
            Lesezugriff auf dein Hosting und deine Datenbanken, über ein Token,
            das du hinzufügst. Osirus listet auf, was dort ist; es deployt
            nichts und ändert nichts auf diesen Plattformen.
          </p>
        </div>
        <div className="conn-grid">
          {platforms.map((platform) => (
            <PlatformCard key={platform.id} data={platform} />
          ))}
        </div>
      </section>
      <section className="section" aria-labelledby="webhooks-heading">
        <div>
          <h2 className="section-title" id="webhooks-heading">
            Webhooks
          </h2>
          <p className="section-lede">
            Signierte Ereignisse von GitHub, Vercel oder deinen eigenen
            Systemen, die Automationen starten: ein Push, ein fehlgeschlagener
            CI-Lauf, ein Deployment, ein Datenbank-Ereignis. Unsignierte oder
            wiederholte Zustellungen werden abgelehnt.
          </p>
        </div>
        <WebhooksCard
          endpoints={webhooks.endpoints}
          available={webhooks.available}
          githubWritable={github.scopes.includes("repo:write")}
        />
      </section>
    </>
  );
}
