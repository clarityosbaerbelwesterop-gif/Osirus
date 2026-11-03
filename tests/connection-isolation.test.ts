import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A person who connects GitHub (or Vercel, Neon, Supabase, an MCP server)
// works with their own credential and nobody else's. The app never falls back
// to the operator's tokens from the environment: credentials come only from
// the person's own workspace installation, behind forced row-level security.

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? files(path)
      : /\.(ts|tsx)$/.test(name)
        ? [path]
        : [];
  });
}

const OWNER_TOKENS =
  /process\.env\.(GITHUB_TOKEN|GH_TOKEN|GITHUB_PAT|NEON_API_KEY|SUPABASE_ACCESS_TOKEN|CLOUDFLARE_API_TOKEN|RENDER_API_KEY)\b|env\.(GITHUB_TOKEN|GH_TOKEN|NEON_API_KEY)\b/;

describe("connection isolation", () => {
  it("no product code reads an operator token from the environment", () => {
    const offenders = files("src").filter((path) =>
      OWNER_TOKENS.test(readFileSync(path, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("the Vercel token is read only in CI mode, never by the deployed app", () => {
    const sandbox = readFileSync("src/lib/sandbox/index.ts", "utf8");
    const reads = sandbox
      .split("\n")
      .filter((line) => line.includes("process.env.VERCEL_TOKEN"));
    expect(reads).toHaveLength(1);
    expect(sandbox).toContain(
      'process.env.OSIRUS_SANDBOX_CREDENTIALS !== "ci"',
    );
  });

  it("GitHub credentials are looked up by the caller's own workspace", () => {
    const github = readFileSync("src/lib/connectors/github.ts", "utf8");
    expect(github).toContain(
      "where i.organization_id = $1 and i.workspace_id = $2",
    );
    expect(github).toContain("queryAs<InstallationRow>(\n    identity.userId,");
  });
});
