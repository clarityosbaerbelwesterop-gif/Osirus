import { beforeEach, describe, expect, it, vi } from "vitest";

// Anonymous API floods: without a session cookie nothing is looked up.

const state = vi.hoisted(() => ({
  cookies: [] as Array<{ name: string; value: string }>,
  outside: false,
  getSession: vi.fn(async () => ({
    data: {
      user: { id: "u1", email: "a@b.c", name: "A", emailVerified: true },
    },
  })),
}));

vi.mock("next/headers", () => ({
  cookies: async () => {
    if (state.outside) throw new Error("outside a request scope");
    return { getAll: () => state.cookies };
  },
}));
vi.mock("@/lib/auth/server", () => ({
  auth: { getSession: state.getSession },
  requireAuthConfiguration: () => undefined,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  cache: <T>(fn: T) => fn,
}));

const { loadAuthUser, mayHaveSession } = await import("@/lib/product/session");

beforeEach(() => {
  state.cookies = [];
  state.outside = false;
  state.getSession.mockClear();
});

describe("session lookup only with a session cookie", () => {
  it("answers anonymous requests without calling the auth service", async () => {
    state.cookies = [{ name: "theme", value: "dark" }];
    expect(await mayHaveSession()).toBe(false);
    expect(await loadAuthUser()).toBeNull();
    expect(state.getSession).not.toHaveBeenCalled();
  });

  it("ignores an empty session cookie", async () => {
    state.cookies = [{ name: "__Secure-neon-auth.session_token", value: "" }];
    expect(await loadAuthUser()).toBeNull();
    expect(state.getSession).not.toHaveBeenCalled();
  });

  it("looks the session up when the cookie is there", async () => {
    state.cookies = [
      { name: "__Secure-neon-auth.session_token", value: "abc.def" },
    ];
    expect(await loadAuthUser()).toMatchObject({ id: "u1" });
    expect(state.getSession).toHaveBeenCalledOnce();
  });

  it("decides as before outside a request scope", async () => {
    state.outside = true;
    expect(await mayHaveSession()).toBe(true);
  });
});
