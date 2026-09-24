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
            MCP servers
          </h2>
          <p className="section-lede">
            Tools from servers you add. You decide which tools Osirus may use,
            and it asks before every call.
          </p>
        </div>
        <McpManager servers={mcp.servers} available={mcp.available} />
      </section>
      <section className="section" aria-labelledby="platforms-heading">
        <div>
          <h2 className="section-title" id="platforms-heading">
            Platforms
          </h2>
          <p className="section-lede">
            Read-only access to your hosting and databases, by a token you add.
            Osirus lists what is there; it does not deploy or change anything on
            these platforms.
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
            Signed events from GitHub, Vercel or your own systems that start
            automations: a push, a failed CI run, a deployment, a database
            event. Unsigned or replayed deliveries are refused.
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
