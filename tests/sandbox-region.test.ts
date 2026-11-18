import { describe, expect, it, vi } from "vitest";

// Every sandbox Osirus starts runs in Frankfurt (EU), not the SDK's default
// iad1 (USA): bots' computers, Code workspaces and "Ausführen".

const created = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("@vercel/sandbox", () => ({
  Sandbox: {
    create: vi.fn(async (options: Record<string, unknown>) => {
      created.push(options);
      return { name: options.name ?? "sbx" };
    }),
  },
}));

const { VercelSandboxDriver, SANDBOX_REGION } =
  await import("../src/lib/sandbox/vercel");
const { COMPUTER_ALLOWED_DOMAINS } =
  await import("../src/lib/agents/bot-computer-plan");

describe("sandbox region and network", () => {
  it("creates every sandbox in fra1", async () => {
    expect(SANDBOX_REGION).toBe("fra1");
    const driver = new VercelSandboxDriver();
    await driver.create({ timeoutMs: 60_000 });
    await driver.create({
      name: "osirus-pc-test",
      persistent: true,
      allowedDomains: COMPUTER_ALLOWED_DOMAINS,
    });
    expect(created).toHaveLength(2);
    for (const options of created) expect(options.region).toBe("fra1");
    expect(created[0]).toMatchObject({ networkPolicy: "deny-all" });
    expect(created[1]).toMatchObject({
      name: "osirus-pc-test",
      persistent: true,
      networkPolicy: {
        allow: ["pypi.org", "files.pythonhosted.org", "registry.npmjs.org"],
      },
    });
  });
});
