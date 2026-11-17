import "server-only";
import { env } from "../env";

// Transactional e-mail. Two transports, both optional:
// - SMTP_URL (preferred): SMTP over implicit TLS, e.g. Zoho Mail EU, so
//   addresses and contents stay with an EU processor.
// - RESEND_API_KEY: Resend's HTTP API.
// Without either (or without OSIRUS_MAIL_FROM), sendMail reports "not
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

/**
 * The SMTP endpoint, or null when unset or unsafe. Only smtps:// (TLS from
 * the first byte) is accepted: a plain smtp:// URL could send the password
 * and the message in clear text if STARTTLS were stripped.
 */
export function smtpEndpoint(url = env.SMTP_URL) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "smtps:") return null;
    if (!parsed.hostname || !parsed.username || !parsed.password) return null;
    return {
      host: parsed.hostname,
      port: Number(parsed.port || 465),
      user: decodeURIComponent(parsed.username),
      pass: decodeURIComponent(parsed.password),
    };
  } catch {
    return null;
  }
}

export function mailConfigured() {
  return Boolean(
    env.OSIRUS_MAIL_FROM && (smtpEndpoint() || env.RESEND_API_KEY),
  );
}

function recipients(message: MailMessage) {
  return [...new Set(message.to.map((address) => address.trim()))].filter(
    Boolean,
  );
}

async function sendSmtp(
  endpoint: NonNullable<ReturnType<typeof smtpEndpoint>>,
  from: string,
  to: string[],
  message: MailMessage,
): Promise<MailResult> {
  const { createTransport } = await import("nodemailer");
  const transport = createTransport({
    host: endpoint.host,
    port: endpoint.port,
    secure: true,
    auth: { user: endpoint.user, pass: endpoint.pass },
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    // Messages are plain text built by our code; nothing may pull in local
    // files or URLs, whatever ends up in a field.
    disableFileAccess: true,
    disableUrlAccess: true,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  try {
    const info = await transport.sendMail({
      from,
      to,
      subject: message.subject,
      text: message.text,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    });
    if (info.rejected.length && !info.accepted.length)
      return { sent: false, reason: "rejected" };
    return { sent: true, id: info.messageId ?? null };
  } catch (error) {
    const code = (error as { responseCode?: number; code?: string } | null)
      ?.responseCode;
    const kind = (error as { code?: string } | null)?.code;
    // 5xx and failed logins are answers from the server; everything else
    // (DNS, TCP, TLS, timeouts) means it was not reached.
    if ((code && code >= 500) || kind === "EAUTH" || kind === "EENVELOPE")
      return { sent: false, reason: "rejected" };
    return { sent: false, reason: "unreachable" };
  } finally {
    transport.close();
  }
}

async function sendResend(
  key: string,
  from: string,
  to: string[],
  message: MailMessage,
): Promise<MailResult> {
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
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

export async function sendMail(message: MailMessage): Promise<MailResult> {
  const from = env.OSIRUS_MAIL_FROM;
  const smtp = smtpEndpoint();
  if (!from || (!smtp && !env.RESEND_API_KEY))
    return { sent: false, reason: "not_configured" };
  const to = recipients(message);
  if (!to.length) return { sent: false, reason: "rejected" };
  if (smtp) return sendSmtp(smtp, from, to, message);
  return sendResend(env.RESEND_API_KEY!, from, to, message);
}
