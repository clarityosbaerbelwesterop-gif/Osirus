import { describe, expect, it, vi } from "vitest";

// Every sandbox Osirus starts runs in Frankfurt (EU), not the SDK's default
// iad1 (USA): bots' computers, Code workspaces and "Ausführen".

const created = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const events = vi.hoisted(() => [] as string[]);
vi.mock("@vercel/sandbox", () => ({
  Sandbox: {
    create: vi.fn(async (options: Record<string, unknown>) => {
      created.push(options);
      return {
        name: options.name ?? "sbx",
        stop: async () => events.push(`stop:${String(options.name ?? "sbx")}`),
        delete: async () =>
          events.push(`delete:${String(options.name ?? "sbx")}`),
      };
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
    // A throwaway sandbox is never persistent: the API's default is, and
    // every chat code run left an 830 MB snapshot for 30 days.
    expect(created[0]).toMatchObject({
      networkPolicy: "deny-all",
      persistent: false,
    });
    expect(created[0]).not.toHaveProperty("snapshotExpiration");
    expect(created[1]).toMatchObject({
      name: "osirus-pc-test",
      persistent: true,
      networkPolicy: {
        allow: ["pypi.org", "files.pythonhosted.org", "registry.npmjs.org"],
      },
    });
  });

  it("deletes a throwaway sandbox when it stops and keeps a workspace", async () => {
    const driver = new VercelSandboxDriver();
    events.length = 0;
    await (await driver.create({ timeoutMs: 60_000 })).stop();
    await (
      await driver.create({ name: "osirus-pc-keep", persistent: true })
    ).stop();
    expect(events).toEqual(["delete:sbx", "stop:osirus-pc-keep"]);
  });
});
