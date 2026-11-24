import { beforeEach, describe, expect, it, vi } from "vitest";

// Every auth endpoint that sends an e-mail or checks a secret is limited
// per address and per network, also when called directly (not through the
// forms): otherwise anyone could send our verification mails to any
// address in a loop.

const state = vi.hoisted(() => ({
  allowed: true,
  checks: [] as Array<{ route: string; email: string }>,
  handled: [] as string[],
}));

vi.mock("@/app/auth/rate", () => ({
  authAttemptAllowed: async (input: { route: string; email: string }) => {
    state.checks.push({ route: input.route, email: input.email });
    return state.allowed;
  },
}));

vi.mock("@/lib/auth/server", () => ({
  requireAuthConfiguration: () => undefined,
  auth: {
    handler: () => ({
      GET: async () => new Response("ok"),
      POST: async (request: Request) => {
        state.handled.push(new URL(request.url).pathname);
        return new Response("ok");
      },
    }),
  },
}));

beforeEach(() => {
  state.allowed = true;
  state.checks = [];
  state.handled = [];
});

async function post(path: string, body: unknown) {
  const { POST } = await import("../src/app/api/auth/[...path]/route");
  return POST(
    new Request(`https://osirus-ai.com/api/auth/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ path: path.split("/") }) },
  );
}

describe("auth endpoints under attack", () => {
  it("stops repeated verification mails to one address", async () => {
    state.allowed = false;
    const response = await post("send-verification-email", {
      email: "Opfer@example.com",
    });
    expect(response.status).toBe(429);
    expect(state.handled).toEqual([]);
    expect(state.checks).toEqual([
      { route: "auth.verify-mail", email: "Opfer@example.com" },
    ]);
  });

  it("limits every mail-sending and secret-checking path", async () => {
    for (const path of [
      "sign-in/email",
      "sign-up/email",
      "request-password-reset",
      "forget-password",
      "send-verification-email",
      "change-email",
      "sign-in/magic-link",
      "email-otp/send-verification-otp",
      "reset-password",
      "change-password",
    ]) {
      state.checks = [];
      await post(path, { email: "a@example.com" });
      expect(state.checks, path).toHaveLength(1);
    }
  });

  it("counts a new address for change-email and passes others through", async () => {
    await post("change-email", { newEmail: "neu@example.com" });
    expect(state.checks.at(-1)?.email).toBe("neu@example.com");
    state.checks = [];
    const response = await post("sign-out", {});
    expect(response.status).toBe(200);
    expect(state.checks).toEqual([]);
    expect(state.handled).toContain("/api/auth/sign-out");
  });
});
