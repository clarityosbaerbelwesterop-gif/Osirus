import { describe, expect, it } from "vitest";
import {
  discoverTools,
  mcpInitialize,
  toolFromDiscovery,
} from "../src/lib/tools/mcp";

// Live smoke test against a public, read-only, unauthenticated MCP server
// (DeepWiki). Off by default -- CI must not depend on a third party -- and
// run by hand with OSIRUS_MCP_LIVE_SMOKE=1. It goes through the real outbound
// guard (https only, DNS checked at connect time, no redirects) and calls
// one read-only tool after the fingerprint check. No credentials are used.

const LIVE = process.env.OSIRUS_MCP_LIVE_SMOKE === "1";
const SERVER = {
  id: "deepwiki",
  url: process.env.OSIRUS_MCP_LIVE_URL ?? "https://mcp.deepwiki.com/mcp",
};

describe.skipIf(!LIVE)("live MCP smoke test (public read-only server)", () => {
  it("initializes, lists tools and runs one read-only tool", async () => {
    const info = await mcpInitialize(SERVER);
    expect(info.protocolVersion).toBeTruthy();
    const tools = await discoverTools({ server: SERVER });
    expect(tools.length).toBeGreaterThan(0);
    const structure = tools.find(
      (tool) => tool.remoteName === "read_wiki_structure",
    );
    expect(structure).toBeDefined();
    const definition = toolFromDiscovery({
      tool: structure!,
      server: SERVER,
      arms: ["research"],
    });
    expect(definition).toMatchObject({
      trust: "mcp",
      effect: "external",
      risk: "high",
    });
    const result = (await definition.run(
      { repoName: "modelcontextprotocol/modelcontextprotocol" },
      {
        runId: "live",
        stageId: "live",
        armId: "research",
        organizationId: "live",
        workspaceId: "live",
      },
    )) as { content?: Array<{ type: string; text?: string }> };
    expect(result.content?.[0]?.text?.length ?? 0).toBeGreaterThan(0);
    console.info(
      JSON.stringify({
        server: info.name,
        version: info.version,
        protocol: info.protocolVersion,
        tools: tools.map((tool) => ({
          name: tool.remoteName,
          flagged: tool.flagged,
        })),
        calledTool: structure!.remoteName,
        resultChars: result.content?.[0]?.text?.length ?? 0,
      }),
    );
  }, 60_000);
});
