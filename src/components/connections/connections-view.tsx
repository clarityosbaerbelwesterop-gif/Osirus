import { Cloud, Database, Layers } from "lucide-react";
import type { McpServerView } from "@/lib/connectors/mcp-types";
import { ConnectionCard } from "./connection-card";
import { GithubCard, type GithubCardData } from "./github-card";
import { McpManager } from "./mcp-manager";

const UPCOMING = [
  {
    name: "Neon",
    icon: <Database size={20} />,
    text: "Inspect and branch Postgres databases.",
  },
  {
    name: "Vercel",
    icon: <Cloud size={20} />,
    text: "Preview and promote deployments.",
  },
  {
    name: "Supabase",
    icon: <Layers size={20} />,
    text: "Query tables and manage projects.",
  },
];

export function ConnectionsView({
  github,
  mcp,
}: {
  github: GithubCardData;
  mcp: { servers: McpServerView[]; available: boolean };
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
      <section className="section" aria-labelledby="later-heading">
        <div>
          <h2 className="section-title" id="later-heading">
            Not available yet
          </h2>
          <p className="section-lede">
            These integrations are planned. They cannot be connected today.
          </p>
        </div>
        <div className="conn-grid">
          {UPCOMING.map((item) => (
            <ConnectionCard
              key={item.name}
              icon={item.icon}
              name={item.name}
              stateLabel="Not available"
              stateTone="neutral"
              description={<p className="subtle">{item.text}</p>}
            />
          ))}
        </div>
      </section>
    </>
  );
}
