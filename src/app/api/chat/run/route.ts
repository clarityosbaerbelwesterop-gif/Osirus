import { z } from "zod";
import {
  MAX_CODE_CHARS,
  runnableLanguage,
  runSnippet,
} from "@/lib/chat/run-code";
import { guardWrite, json } from "@/lib/product/api";
import { resolveSandbox } from "@/lib/sandbox";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({
  language: z.string().min(1).max(20),
  code: z.string().min(1).max(MAX_CODE_CHARS),
});

/**
 * Runs one code block from a chat answer in a fresh sandbox without network
 * access (src/lib/chat/run-code.ts) and returns its output. Six runs a
 * minute per person: a run costs a sandbox.
 */
export async function POST(request: Request) {
  const guard = await guardWrite(request, {
    schema,
    route: "chat.run",
    limit: 6,
    maxBytes: MAX_CODE_CHARS * 4 + 1024,
  });
  if (!guard.ok) return guard.response;
  const language = runnableLanguage(guard.body.language);
  if (!language)
    return json(
      {
        error: "unsupported_language",
        message: "Ausführen geht für Python, JavaScript und TypeScript.",
      },
      400,
    );
  const driver = await resolveSandbox();
  if (!driver.availability().configured)
    return json(
      {
        error: "sandbox_unavailable",
        message: "Die Sandbox ist gerade nicht verfügbar.",
      },
      503,
    );
  try {
    const outcome = await runSnippet({
      driver,
      language,
      code: guard.body.code,
      signal: request.signal,
    });
    return json({ ok: true, language, ...outcome });
  } catch (error) {
    if (request.signal.aborted) return json({ error: "cancelled" }, 499);
    console.error(
      "chat.run failed",
      error instanceof Error ? error.name : "unknown",
    );
    return json(
      {
        error: "run_failed",
        message:
          "Der Code konnte nicht ausgeführt werden. Bitte erneut versuchen.",
      },
      502,
    );
  }
}
