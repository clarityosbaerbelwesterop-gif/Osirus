import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("GitHub sign-in is covered by the server consent gate", () => {
  it("returns new GitHub accounts to /app and does not treat a click as consent", () => {
    const button = source("src/components/auth/github-sign-in-button.tsx");
    const form = source("src/app/auth/sign-in/sign-in-form.tsx");
    expect(form).toContain("<GitHubSignInButton />");
    expect(button).toContain('callbackURL: "/app"');
    expect(button).not.toContain("legal_acceptances");
    expect(button).not.toContain("acceptLegal");
    expect(form).not.toContain("acceptTerms");
  });

  it("blocks /app until consent rows exist for the current text versions", () => {
    const layout = source("src/app/app/layout.tsx");
    const consent = layout.indexOf("consentIsCurrent");
    const bootstrap = layout.indexOf("requireProductSession");
    const shell = layout.indexOf("<AppShell");
    expect(consent).toBeGreaterThan(-1);
    expect(bootstrap).toBeGreaterThan(consent);
    expect(shell).toBeGreaterThan(bootstrap);
    expect(layout).toContain('redirect("/consent")');
    expect(layout).toContain("ensureOsirusUser");
    const email = source("src/app/auth/sign-in/actions.ts");
    expect(email).toContain('redirect("/app")');
  });
});
