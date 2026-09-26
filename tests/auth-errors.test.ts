import { describe, expect, it, vi } from "vitest";
import { oauthErrorMessage } from "../src/lib/auth/oauth-errors";

const session = vi.hoisted(() => ({ user: null as { id: string } | null }));
const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
);

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/server", () => ({
  authConfigured: true,
  auth: { getSession: vi.fn(async () => ({ data: { user: session.user } })) },
}));

describe("GitHub sign-in errors", () => {
  it("explains the codes a failed OAuth round trip returns", () => {
    expect(oauthErrorMessage("access_denied")).toBe(
      "GitHub sign-in was cancelled.",
    );
    expect(oauthErrorMessage("state_mismatch")).toMatch(/expired/);
    expect(oauthErrorMessage("please_restart_the_process")).toMatch(/expired/);
    expect(oauthErrorMessage("email_not_found")).toMatch(/verified email/);
    expect(oauthErrorMessage(["account_not_linked"])).toMatch(/already exists/);
  });

  it("names an unknown code but never echoes arbitrary text", () => {
    expect(oauthErrorMessage("something_new")).toBe(
      "GitHub sign-in did not complete. Please try again. (something_new)",
    );
    expect(oauthErrorMessage("<script>alert(1)</script>")).toBe(
      "GitHub sign-in did not complete. Please try again.",
    );
    expect(oauthErrorMessage(null)).toBeNull();
    expect(oauthErrorMessage("")).toBeNull();
  });

  it("shows the error on the sign-in page instead of looping silently", async () => {
    const { default: SignInPage } =
      await import("../src/app/auth/sign-in/page");
    session.user = { id: "u1" };
    const element = (await SignInPage({
      searchParams: Promise.resolve({ error: "state_mismatch" }),
    })) as { props: { oauthError: string | null } };
    // Even with a session, an error is shown rather than hidden by a redirect.
    expect(element.props.oauthError).toMatch(/expired/);
  });

  it("sends someone already signed in straight to the workspace", async () => {
    const { default: SignInPage } =
      await import("../src/app/auth/sign-in/page");
    session.user = { id: "u1" };
    await expect(
      SignInPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("redirect:/app");
    session.user = null;
    const element = (await SignInPage({
      searchParams: Promise.resolve({}),
    })) as { props: { oauthError: string | null } };
    expect(element.props.oauthError).toBeNull();
  });
});
