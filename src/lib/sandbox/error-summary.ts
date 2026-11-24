// What an operator log may say about a failed sandbox call: the error's
// name, the API status and code, and a short message with anything that
// looks like a credential removed. Production 2026-11-20..24: /api/chat/run
// logged only "Error", so a week of failed code runs had no visible cause.

const SECRETISH =
  /(eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,}|(?:bearer|token|key|secret|password)[=:\s]+\S+|[A-Za-z0-9_-]{32,})/gi;

export type SandboxErrorSummary = {
  name: string;
  status?: number;
  code?: string;
  message?: string;
  cause?: string;
};

export function sandboxErrorSummary(error: unknown): SandboxErrorSummary {
  if (!(error instanceof Error)) return { name: typeof error };
  const response = (error as { response?: { status?: unknown } }).response;
  const json = (error as { json?: unknown }).json;
  const code =
    json && typeof json === "object"
      ? ((json as { error?: { code?: unknown }; code?: unknown }).error?.code ??
        (json as { code?: unknown }).code)
      : undefined;
  const cause = (error as { cause?: unknown }).cause;
  return {
    name: error.name,
    ...(typeof response?.status === "number"
      ? { status: response.status }
      : {}),
    ...(typeof code === "string" ? { code: code.slice(0, 60) } : {}),
    message: error.message.replace(SECRETISH, "[redacted]").slice(0, 200),
    ...(cause instanceof Error
      ? {
          cause: `${cause.name}: ${cause.message.replace(SECRETISH, "[redacted]").slice(0, 120)}`,
        }
      : {}),
  };
}
