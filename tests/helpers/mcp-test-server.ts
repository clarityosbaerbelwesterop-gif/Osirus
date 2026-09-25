import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// A small but real MCP server (Streamable HTTP, JSON-RPC 2.0) for the
// certification tests. It listens on loopback only; the tests reach it
// through the product's MCP client with the outbound guard still checking
// every URL (see mcp-certification.test.ts).

export type TestTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

export type RecordedRequest = {
  method: string;
  authorized: boolean;
  sessionId: string | null;
  params: Record<string, unknown>;
};

export type TestMcpServer = {
  url: string;
  port: number;
  token: string;
  tools: TestTool[];
  requests: RecordedRequest[];
  /** Answer every request with this HTTP status instead (e.g. 503). */
  failWith: number | null;
  /** Replace the tools/list result wholesale (e.g. something malformed). */
  listOverride: unknown;
  /** Page size for tools/list; pagination via nextCursor. */
  pageSize: number;
  /** Answer tools/call as a server-sent event stream. */
  sse: boolean;
  calls: () => RecordedRequest[];
  close: () => Promise<void>;
};

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function startTestMcpServer(
  token: string,
): Promise<TestMcpServer> {
  const state: Omit<TestMcpServer, "url" | "port" | "close" | "calls"> = {
    token,
    tools: [],
    requests: [],
    failWith: null,
    listOverride: undefined,
    pageSize: 100,
    sse: false,
  };
  let sessions = 0;
  const server: Server = createServer(async (request, response) => {
    const raw = await readBody(request);
    let rpc: {
      id?: unknown;
      method?: string;
      params?: Record<string, unknown>;
    } = {};
    try {
      rpc = JSON.parse(raw);
    } catch {
      response.writeHead(400).end();
      return;
    }
    const authorized =
      request.headers.authorization === `Bearer ${state.token}`;
    state.requests.push({
      method: String(rpc.method),
      authorized,
      sessionId:
        (request.headers["mcp-session-id"] as string | undefined) ?? null,
      params: rpc.params ?? {},
    });
    if (state.failWith) {
      response.writeHead(state.failWith).end();
      return;
    }
    if (!authorized) {
      response.writeHead(401, { "content-type": "application/json" }).end("{}");
      return;
    }
    if (rpc.id === undefined) {
      response.writeHead(202).end();
      return;
    }
    const reply = (result: unknown, headers: Record<string, string> = {}) => {
      const payload = JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result });
      if (state.sse && rpc.method === "tools/call") {
        response
          .writeHead(200, { "content-type": "text/event-stream", ...headers })
          .end(`event: message\ndata: ${payload}\n\n`);
        return;
      }
      response
        .writeHead(200, { "content-type": "application/json", ...headers })
        .end(payload);
    };
    switch (rpc.method) {
      case "initialize":
        sessions += 1;
        reply(
          {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "osirus-cert-mcp", version: "1.0.0" },
          },
          { "mcp-session-id": `session-${sessions}` },
        );
        return;
      case "tools/list": {
        if (state.listOverride !== undefined) {
          reply(state.listOverride);
          return;
        }
        const start = Number(rpc.params?.cursor ?? 0) || 0;
        const page = state.tools.slice(start, start + state.pageSize);
        const next = start + state.pageSize;
        reply({
          tools: page,
          ...(next < state.tools.length ? { nextCursor: String(next) } : {}),
        });
        return;
      }
      case "tools/call": {
        const name = String(rpc.params?.name);
        const args = (rpc.params?.arguments ?? {}) as Record<string, unknown>;
        if (name === "fail") {
          reply({
            isError: true,
            content: [{ type: "text", text: "the tool failed on purpose" }],
          });
          return;
        }
        reply({
          content: [{ type: "text", text: `echo:${String(args.text ?? "")}` }],
        });
        return;
      }
      default:
        response.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: rpc.id,
            error: { code: -32601, message: "no" },
          }),
        );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const handle = state as TestMcpServer;
  handle.port = port;
  handle.url = `http://127.0.0.1:${port}`;
  handle.calls = () =>
    state.requests.filter((entry) => entry.method === "tools/call");
  handle.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return handle;
}
