import { describe, expect, it, vi } from "vitest";

// Every sandbox Osirus starts runs in Frankfurt (EU), not the SDK's default
// iad1 (USA): bots' computers, Code workspaces and "Ausführen".

const created = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const events = vi.hoisted(() => [] as string[]);
const found = vi.hoisted(() => ({
  sandbox: null as { persistent: boolean; status: string } | null,
}));
vi.mock("@vercel/sandbox", () => ({
  Sandbox: {
    get: vi.fn(async () => {
      if (!found.sandbox) throw new Error("Status code 404 is not ok");
      return { name: "osirus-pc-r", ...found.sandbox };
    }),
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

const { VercelSandboxDriver, SANDBOX_REGION, reattachVercelSandbox } =
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

  it("reattaches only a throwaway machine that is still running", async () => {
    for (const [sandbox, usable] of [
      [{ persistent: false, status: "running" }, true],
      [{ persistent: false, status: "pending" }, true],
      // Production 2026-11-25: a chat answer had just deleted it.
      [{ persistent: false, status: "stopping" }, false],
      [{ persistent: false, status: "stopped" }, false],
      [{ persistent: false, status: "failed" }, false],
      // An older persistent machine resumes from its snapshot.
      [{ persistent: true, status: "stopped" }, true],
      [null, false],
    ] as const) {
      found.sandbox = sandbox ? { ...sandbox } : null;
      const handle = await reattachVercelSandbox("osirus-pc-r");
      expect(handle !== null, JSON.stringify(sandbox)).toBe(usable);
    }
  });
});
