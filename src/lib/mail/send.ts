import "server-only";
import { env } from "../env";

// Transactional e-mail through Resend's HTTP API. Nothing here is required:
// without RESEND_API_KEY and OSIRUS_MAIL_FROM, sendMail reports "not
// configured" and the caller keeps its own copy (a page, a database row).

export type MailMessage = {
  to: string[];
  subject: string;
  text: string;
  replyTo?: string;
};

export type MailResult =
  | { sent: true; id: string | null }
  | { sent: false; reason: "not_configured" | "rejected" | "unreachable" };

export function mailConfigured() {
  return Boolean(env.RESEND_API_KEY && env.OSIRUS_MAIL_FROM);
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  if (!env.RESEND_API_KEY || !env.OSIRUS_MAIL_FROM)
    return { sent: false, reason: "not_configured" };
  const to = [...new Set(message.to.map((address) => address.trim()))].filter(
    Boolean,
  );
  if (!to.length) return { sent: false, reason: "rejected" };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: env.OSIRUS_MAIL_FROM,
        to,
        subject: message.subject,
        text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { sent: false, reason: "rejected" };
    const body = (await response.json().catch(() => null)) as {
      id?: unknown;
    } | null;
    return { sent: true, id: typeof body?.id === "string" ? body.id : null };
  } catch {
    return { sent: false, reason: "unreachable" };
  }
}
