import { afterEach, describe, expect, it, vi } from "vitest";

// SSRF protection for user-supplied MCP server URLs (Issue #26 §12).
//
// DNS and the HTTP client are replaced at the lowest seam only: node:dns
// answers what each test says, and undici's fetch can be made to return a
// redirect. The guard itself -- URL validation, the connect-time DNS check
// and the redirect refusal -- is the real code.

const dnsAnswers = vi.hoisted(() => ({
  map: new Map<string, Array<string | string[]>>(),
  queried: [] as string[],
}));
const undiciHook = vi.hoisted(() => ({
  respond: null as
    null | ((url: string, init: Record<string, unknown>) => Response),
  calls: [] as Array<{ url: string; redirect: unknown }>,
}));

vi.mock("node:dns", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:dns")>();
  const lookup = (
    hostname: string,
    options: unknown,
    callback: (error: NodeJS.ErrnoException | null, addresses: unknown) => void,
  ) => {
    dnsAnswers.queried.push(hostname);
    const queue = dnsAnswers.map.get(hostname);
    const next = queue?.length
      ? queue.length > 1
        ? queue.shift()!
        : queue[0]!
      : null;
    if (!next) {
      const error = Object.assign(new Error(`ENOTFOUND ${hostname}`), {
        code: "ENOTFOUND",
      });
      return callback(error, []);
    }
    const list = (Array.isArray(next) ? next : [next]).map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    }));
    callback(null, list);
  };
  return { ...real, lookup, default: { ...real, lookup } };
});

vi.mock("undici", async (importOriginal) => {
  const real = await importOriginal<typeof import("undici")>();
  return {
    ...real,
    fetch: (url: URL | string, init: Record<string, unknown>) => {
      undiciHook.calls.push({ url: String(url), redirect: init?.redirect });
      if (undiciHook.respond)
        return Promise.resolve(undiciHook.respond(String(url), init));
      return real.fetch(url as string, init as never);
    },
  };
});

const {
  checkOutboundUrl,
  guardedLookup,
  isPrivateAddress,
  outboundFetch,
  OutboundBlockedError,
} = await import("../src/lib/security/outbound");

afterEach(() => {
  dnsAnswers.map.clear();
  dnsAnswers.queried.length = 0;
  undiciHook.respond = null;
  undiciHook.calls.length = 0;
});

function reasonOf(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    if (error instanceof OutboundBlockedError) return error.reason;
    throw error;
  }
  return "allowed";
}

describe("private and reserved addresses", () => {
  it.each([
    // IPv4: loopback 127/8, private 10/8, 172.16/12, 192.168/16, link-local
    // and cloud metadata 169.254/16, CGNAT, unspecified, multicast, docs.
    "127.0.0.1",
    "127.255.255.254",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "169.254.169.254",
    "169.254.0.1",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "192.0.2.1",
    "198.51.100.7",
    "203.0.113.9",
    // IPv6: loopback, unspecified, unique-local fc00::/7, link-local
    // fe80::/10, site-local, multicast, documentation.
    "::1",
    "::",
    "0:0:0:0:0:0:0:1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "febf::1",
    "fec0::1",
    "ff02::1",
    "2001:db8::1",
    // IPv6 forms that carry an IPv4 address -- the URL parser writes them in
    // hex, which is how they used to slip through.
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "::ffff:0a00:0001",
    "0:0:0:0:0:ffff:c0a8:0101",
    "::7f00:1",
    "::ffff:0:7f00:1",
    "64:ff9b::a9fe:a9fe",
    "2002:7f00:1::",
    "2001:0:4136:e378::1",
    "not-an-ip",
  ])("%s is private", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "172.15.255.255",
    "172.32.0.1",
    "192.169.0.1",
    "2606:4700:4700::1111",
    "::ffff:808:808",
  ])("%s is public", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});

describe("URL validation before any connection", () => {
  it.each([
    ["http://mcp.example.com/mcp", "not_https"],
    ["ftp://mcp.example.com/", "not_https"],
    ["file:///etc/passwd", "not_https"],
    ["https://localhost/mcp", "private_host"],
    ["https://localhost./mcp", "private_host"],
    ["https://api.localhost/mcp", "private_host"],
    ["https://metadata.google.internal/computeMetadata/v1/", "private_host"],
    ["https://router.lan/", "private_host"],
    ["https://127.0.0.1/", "private_address"],
    ["https://127.1/", "private_address"],
    ["https://2130706433/", "private_address"],
    ["https://0x7f000001/", "private_address"],
    ["https://10.0.0.5:8443/", "private_address"],
    ["https://172.20.1.1/", "private_address"],
    ["https://192.168.1.1/", "private_address"],
    ["https://169.254.169.254/latest/meta-data/", "private_address"],
    ["https://[::1]/", "private_address"],
    ["https://[::ffff:127.0.0.1]/", "private_address"],
    ["https://[::ffff:169.254.169.254]/", "private_address"],
    ["https://[fc00::1]/", "private_address"],
    ["https://[fe80::1]/", "private_address"],
    ["https://[64:ff9b::7f00:1]/", "private_address"],
    ["https://user:pass@mcp.example.com/", "credentials_in_url"],
    ["https://mcp.example.com:22/", "port_not_allowed"],
    ["nonsense", "invalid_url"],
  ])("%s → %s", (url, reason) => {
    expect(reasonOf(() => checkOutboundUrl(url))).toBe(reason);
  });

  it("allows public https endpoints, including high ports", () => {
    expect(
      reasonOf(() => checkOutboundUrl("https://mcp.example.com/mcp")),
    ).toBe("allowed");
    expect(
      reasonOf(() => checkOutboundUrl("https://mcp.example.com:8443/mcp")),
    ).toBe("allowed");
    expect(
      reasonOf(() => checkOutboundUrl("https://[2606:4700:4700::1111]/")),
    ).toBe("allowed");
  });

  it("refuses an IP-literal private URL without touching DNS or the network", async () => {
    await expect(
      outboundFetch("https://[::ffff:7f00:1]:8443/mcp"),
    ).rejects.toMatchObject({
      reason: "private_address",
    });
    expect(dnsAnswers.queried).toEqual([]);
    expect(undiciHook.calls).toEqual([]);
  });
});

describe("DNS: checked at connect time (rebinding)", () => {
  const lookup = (hostname: string) =>
    new Promise<{ error: unknown; addresses: unknown }>((resolve) =>
      guardedLookup(hostname, { all: true }, (error, addresses) =>
        resolve({ error, addresses }),
      ),
    );

  it("hands public answers to the socket", async () => {
    dnsAnswers.map.set("public.cert.example", ["93.184.216.34"]);
    const { error, addresses } = await lookup("public.cert.example");
    expect(error).toBeNull();
    expect(addresses).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it.each([
    ["127.0.0.1"],
    ["10.1.2.3"],
    ["169.254.169.254"],
    ["::1"],
    ["fd00::5"],
    ["::ffff:127.0.0.1"],
  ])("refuses a name that resolves to %s", async (address) => {
    dnsAnswers.map.set("inside.cert.example", [address]);
    const { error } = await lookup("inside.cert.example");
    expect(error).toBeInstanceOf(OutboundBlockedError);
    expect((error as InstanceType<typeof OutboundBlockedError>).reason).toBe(
      "private_address",
    );
  });

  it("refuses when any one of several answers is private", async () => {
    dnsAnswers.map.set("mixed.cert.example", [["93.184.216.34", "10.0.0.1"]]);
    expect((await lookup("mixed.cert.example")).error).toBeInstanceOf(
      OutboundBlockedError,
    );
  });

  it("a name that passes URL validation and then rebinds to a private address is refused", async () => {
    // First answer public (what a pre-check would have seen), second private
    // (what the socket would have used). The guard only trusts the second.
    dnsAnswers.map.set("rebind.cert.example", ["93.184.216.34", "127.0.0.1"]);
    expect(
      reasonOf(() => checkOutboundUrl("https://rebind.cert.example/mcp")),
    ).toBe("allowed");
    expect((await lookup("rebind.cert.example")).error).toBeNull();
    const second = await lookup("rebind.cert.example");
    expect(second.error).toBeInstanceOf(OutboundBlockedError);
  });

  it("end to end: the real client refuses the connection and reports it as blocked", async () => {
    dnsAnswers.map.set("metadata.cert.example", ["169.254.169.254"]);
    const attempt = outboundFetch(
      "https://metadata.cert.example/latest/meta-data/",
      { timeoutMs: 5_000 },
    );
    await expect(attempt).rejects.toBeInstanceOf(OutboundBlockedError);
    await expect(attempt).rejects.toMatchObject({ reason: "private_address" });
    expect(dnsAnswers.queried).toContain("metadata.cert.example");
  });
});

describe("redirects are never followed", () => {
  it.each([
    [301, "http://169.254.169.254/latest/meta-data/"],
    [302, "https://127.0.0.1/admin"],
    [307, "https://[::1]/"],
    [308, "https://10.0.0.1/"],
    [302, "https://mcp.example.com/elsewhere"],
  ])("HTTP %s to %s is refused", async (status, location) => {
    undiciHook.respond = () =>
      new Response(null, { status, headers: { location } });
    await expect(
      outboundFetch("https://mcp.example.com/mcp"),
    ).rejects.toMatchObject({
      reason: "redirect_not_followed",
    });
    expect(undiciHook.calls).toEqual([
      { url: "https://mcp.example.com/mcp", redirect: "manual" },
    ]);
  });

  it("caps the response size", async () => {
    undiciHook.respond = () => new Response("x".repeat(2_000), { status: 200 });
    await expect(
      outboundFetch("https://mcp.example.com/mcp", { maxBytes: 1_000 }),
    ).rejects.toMatchObject({
      reason: "response_too_large",
    });
  });
});
