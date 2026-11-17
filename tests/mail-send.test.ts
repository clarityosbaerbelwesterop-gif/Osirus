import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  transportOptions: [] as Record<string, unknown>[],
  sent: [] as Record<string, unknown>[],
  outcome: null as null | (() => unknown),
  closed: 0,
}));

vi.mock("@/lib/env", () => ({
  get env() {
    return state.env;
  },
}));

vi.mock("nodemailer", () => ({
  createTransport: (options: Record<string, unknown>) => {
    state.transportOptions.push(options);
    return {
      sendMail: async (mail: Record<string, unknown>) => {
        state.sent.push(mail);
        if (state.outcome) return state.outcome();
        return {
          messageId: "<m1@osirus-ai.com>",
          accepted: mail.to,
          rejected: [],
        };
      },
      close: () => {
        state.closed += 1;
      },
    };
  },
}));

const { sendMail, mailConfigured, smtpEndpoint } =
  await import("@/lib/mail/send");

const SMTP = "smtps://kuendigung%40osirus-ai.com:app%2Fpass@smtp.zoho.eu:465";
const message = {
  to: ["kunde@example.com", " kunde@example.com "],
  subject: "Kündigungsbestätigung",
  text: "Deine Kündigung ist eingegangen.",
};

beforeEach(() => {
  state.env = {};
  state.transportOptions.length = 0;
  state.sent.length = 0;
  state.outcome = null;
  state.closed = 0;
  vi.unstubAllGlobals();
});

describe("SMTP endpoint", () => {
  it("accepts only smtps:// with credentials and decodes them", () => {
    expect(smtpEndpoint(SMTP)).toEqual({
      host: "smtp.zoho.eu",
      port: 465,
      user: "kuendigung@osirus-ai.com",
      pass: "app/pass",
    });
    // Plain SMTP could leak the password if STARTTLS were stripped.
    expect(smtpEndpoint("smtp://u:p@smtp.zoho.eu:587")).toBeNull();
    expect(smtpEndpoint("smtps://smtp.zoho.eu:465")).toBeNull();
    expect(smtpEndpoint("not a url")).toBeNull();
    expect(smtpEndpoint(undefined)).toBeNull();
  });
});

describe("sendMail over SMTP", () => {
  it("is not configured without a sender or a transport", async () => {
    state.env = { SMTP_URL: SMTP };
    expect(mailConfigured()).toBe(false);
    state.env = { OSIRUS_MAIL_FROM: "Osirus <kuendigung@osirus-ai.com>" };
    expect(mailConfigured()).toBe(false);
    expect(await sendMail(message)).toEqual({
      sent: false,
      reason: "not_configured",
    });
    // A plain smtp:// URL counts as not configured, never as a clear-text send.
    state.env = {
      OSIRUS_MAIL_FROM: "Osirus <kuendigung@osirus-ai.com>",
      SMTP_URL: "smtp://u:p@smtp.zoho.eu:587",
    };
    expect(mailConfigured()).toBe(false);
    expect(state.transportOptions).toHaveLength(0);
  });

  it("sends plain text over verified TLS with file and URL access off", async () => {
    state.env = {
      OSIRUS_MAIL_FROM: "Osirus <kuendigung@osirus-ai.com>",
      SMTP_URL: SMTP,
    };
    expect(mailConfigured()).toBe(true);
    const result = await sendMail(message);
    expect(result).toEqual({ sent: true, id: "<m1@osirus-ai.com>" });
    expect(state.transportOptions[0]).toMatchObject({
      host: "smtp.zoho.eu",
      port: 465,
      secure: true,
      auth: { user: "kuendigung@osirus-ai.com", pass: "app/pass" },
      tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    expect(state.sent[0]).toEqual({
      from: "Osirus <kuendigung@osirus-ai.com>",
      to: ["kunde@example.com"],
      subject: "Kündigungsbestätigung",
      text: "Deine Kündigung ist eingegangen.",
    });
    expect(state.closed).toBe(1);
  });

  it("prefers SMTP over Resend when both are set", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    state.env = {
      OSIRUS_MAIL_FROM: "Osirus <kuendigung@osirus-ai.com>",
      SMTP_URL: SMTP,
      RESEND_API_KEY: "re_test",
    };
    await sendMail(message);
    expect(state.sent).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("tells a refusal from an unreachable server and always closes", async () => {
    state.env = {
      OSIRUS_MAIL_FROM: "Osirus <kuendigung@osirus-ai.com>",
      SMTP_URL: SMTP,
    };
    state.outcome = () => {
      throw Object.assign(new Error("auth"), { code: "EAUTH" });
    };
    expect(await sendMail(message)).toEqual({
      sent: false,
      reason: "rejected",
    });
    state.outcome = () => {
      throw Object.assign(new Error("553"), { responseCode: 553 });
    };
    expect(await sendMail(message)).toEqual({
      sent: false,
      reason: "rejected",
    });
    state.outcome = () => {
      throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    };
    expect(await sendMail(message)).toEqual({
      sent: false,
      reason: "unreachable",
    });
    state.outcome = () => ({
      messageId: "x",
      accepted: [],
      rejected: ["kunde@example.com"],
    });
    expect(await sendMail(message)).toEqual({
      sent: false,
      reason: "rejected",
    });
    expect(state.closed).toBe(4);
  });

  it("refuses an empty recipient list without connecting", async () => {
    state.env = {
      OSIRUS_MAIL_FROM: "Osirus <kuendigung@osirus-ai.com>",
      SMTP_URL: SMTP,
    };
    expect(await sendMail({ ...message, to: [" "] })).toEqual({
      sent: false,
      reason: "rejected",
    });
    expect(state.transportOptions).toHaveLength(0);
  });
});

describe("sendMail over Resend", () => {
  it("still works when only Resend is configured", async () => {
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ id: "r1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    state.env = {
      OSIRUS_MAIL_FROM: "Osirus <kuendigung@osirus-ai.com>",
      RESEND_API_KEY: "re_test",
    };
    expect(await sendMail(message)).toEqual({ sent: true, id: "r1" });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
