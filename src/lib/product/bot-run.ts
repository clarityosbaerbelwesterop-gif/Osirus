// The bot surface starts the same runtime Chat and Agent already use.
// It does not carry a repository grant and it does not invent a reply.

export function botRuntimeBody(input: {
  objective: string;
  requestId: string;
  sessionId: string | null;
}) {
  return {
    objective: input.objective,
    requestId: input.requestId,
    sessionId: input.sessionId,
    surface: "bot" as const,
  };
}
