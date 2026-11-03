// Pure parts of the bot tool step (no server-only imports, unit tested).

export type BotToolRequest = {
  id: string;
  toolId: string;
  /** "server: tool", shown on the card. */
  label: string;
  arguments: Record<string, unknown>;
  /** One line from the planner: why this call helps. */
  reason: string;
  status: "pending" | "running" | "done" | "failed" | "denied";
  /** Fenced, truncated tool output; only when done. */
  result?: string;
  error?: string;
};

export type PlannedCall = {
  toolId: string;
  arguments: Record<string, unknown>;
  reason: string;
};

type CatalogEntry = { id: string; title: string; summary: string };

const DESCRIPTION_CHARS = 240;

/** Short ids the planner answers with: "t1", "t2", ... in catalog order. */
export function toolAlias(index: number) {
  return `t${index + 1}`;
}

/** The planner prompt: the tools by short id, one decision as JSON. */
export function toolPlanMessages(input: {
  botName: string;
  message: string;
  tools: CatalogEntry[];
}) {
  // Short ids, because a model copying a long namespaced id back tends to
  // change it, and a changed id is no tool at all.
  const list = input.tools
    .map(
      (tool, index) =>
        `- ${toolAlias(index)}: ${tool.title} — ${tool.summary.replace(/\s+/g, " ").slice(0, DESCRIPTION_CHARS)}`,
    )
    .join("\n");
  return [
    {
      role: "system" as const,
      content: [
        `You decide whether the bot "${input.botName}" needs one of the person's connected tools to answer their message.`,
        "Use a tool only when the message asks for something only that tool can provide or do (data in that service, an action there). Small talk, opinions, writing and general knowledge need no tool.",
        "Reply with one JSON object and nothing else:",
        '{"tool": "<short id from the list, e.g. t1>" | null, "arguments": { ... }, "reason": "<one short German sentence: what the call does>"}',
        "Arguments must be the tool's own parameters, filled from the message. When a required value is unknown, use null for tool.",
        "Available tools:",
        list,
      ].join("\n"),
    },
    { role: "user" as const, content: input.message.slice(0, 4_000) },
  ];
}

function firstJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/**
 * The planner's decision, or null for "no tool". A tool id that is not in
 * the catalog is null too: the model cannot name a tool into existence.
 */
export function parseToolPlan(
  text: string,
  toolIds: readonly string[],
): PlannedCall | null {
  const value = firstJsonObject(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const named = typeof row.tool === "string" ? row.tool.trim() : "";
  const alias = /^t(\d{1,3})$/i.exec(named);
  const toolId = alias
    ? (toolIds[Number(alias[1]) - 1] ?? "")
    : toolIds.includes(named)
      ? named
      : "";
  if (!toolId) return null;
  const args =
    row.arguments &&
    typeof row.arguments === "object" &&
    !Array.isArray(row.arguments)
      ? (row.arguments as Record<string, unknown>)
      : {};
  if (JSON.stringify(args).length > 8_000) return null;
  const reason =
    typeof row.reason === "string" && row.reason.trim()
      ? row.reason.trim().slice(0, 200)
      : "Werkzeug nutzen, um die Frage zu beantworten.";
  return { toolId, arguments: args, reason };
}

/** A failed call, said so the person understands it. */
export function toolErrorText(error: unknown) {
  const message = error instanceof Error ? error.message : "tool_failed";
  if (message.includes("response_too_large"))
    return "Die Antwort des Werkzeugs war zu groß (über 8 MB). Frag gezielter, etwa nach einem Teil.";
  if (/timeout|aborted/i.test(message))
    return "Das Werkzeug hat nicht rechtzeitig geantwortet.";
  if (message.startsWith("mcp_unauthorized"))
    return "Der MCP-Server hat den Zugang abgelehnt. Prüfe den Token unter Verbindungen.";
  if (message === "invalid_input")
    return "Die Eingabe passte nicht zum Werkzeug.";
  return message.slice(0, 240);
}
