import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/server", () => ({
  auth: {
    middleware: vi.fn((options: { loginUrl: string }) => {
      const handler = () => options;
      return handler;
    }),
  },
}));

describe("auth proxy", () => {
  it("runs the Neon Auth middleware so the OAuth verifier is exchanged", async () => {
    const { auth } = await import("@/lib/auth/server");
    const proxy = await import("@/proxy");
    expect(typeof proxy.default).toBe("function");
    expect(auth.middleware).toHaveBeenCalledWith({ loginUrl: "/auth/sign-in" });
  });

  it("only covers the product surface", async () => {
    const { config } = await import("@/proxy");
    expect(config.matcher).toEqual(["/app", "/app/:path*"]);
    for (const pattern of config.matcher) {
      expect(pattern.startsWith("/app")).toBe(true);
    }
  });
});
