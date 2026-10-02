import { afterEach, describe, expect, it, vi } from "vitest";

// RT2-02 regression: the research fetcher checks a URL's DNS answer when the
// URL is read (assertPublicUrl, node:dns/promises) and again when the socket
// is opened (guardedLookup on the undici dispatcher, node:dns). A name that
// answers a public address at check time and a private one at connect time
// -- the rebinding window -- must be refused.
//
// DNS is replaced at the lowest seam, per layer; the URL validation, the
// redirect policy, the dispatcher and its lookup hook are the real code.
// No socket is ever opened: the guard fires before connect().

const checkTimeDns = vi.hoisted(() => ({
  map: new Map<string, string[]>(),
  queried: [] as string[],
}));
const connectTimeDns = vi.hoisted(() => ({
  map: new Map<string, string[]>(),
  queried: [] as string[],
}));

vi.mock("node:dns/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:dns/promises")>();
  const lookup = async (hostname: string, options?: { all?: boolean }) => {
    checkTimeDns.queried.push(hostname);
    const queue = checkTimeDns.map.get(hostname);
    const next = queue?.length
      ? queue.length > 1
        ? queue.shift()!
        : queue[0]!
      : null;
    if (!next)
      throw Object.assign(new Error(`ENOTFOUND ${hostname}`), {
        code: "ENOTFOUND",
      });
    const list = [next].map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    }));
    return options?.all ? list : list[0];
  };
  return { ...real, lookup, default: { ...real, lookup } };
});

vi.mock("node:dns", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:dns")>();
  const lookup = (
    hostname: string,
    _options: unknown,
    callback: (error: NodeJS.ErrnoException | null, addresses: unknown) => void,
  ) => {
    connectTimeDns.queried.push(hostname);
    const queue = connectTimeDns.map.get(hostname);
    const next = queue?.length
      ? queue.length > 1
        ? queue.shift()!
        : queue[0]!
      : null;
    if (!next) {
      return callback(
        Object.assign(new Error(`ENOTFOUND ${hostname}`), {
          code: "ENOTFOUND",
        }),
        [],
      );
    }
    callback(
      null,
      [next].map((address) => ({
        address,
        family: address.includes(":") ? 6 : 4,
      })),
    );
  };
  return { ...real, lookup, default: { ...real, lookup } };
});

const { FetchRefused, safeFetch } = await import("../src/lib/research/fetch");

afterEach(() => {
  checkTimeDns.map.clear();
  checkTimeDns.queried.length = 0;
  connectTimeDns.map.clear();
  connectTimeDns.queried.length = 0;
});

describe("research fetch: DNS rebinding (RT2-02)", () => {
  it("refuses when the answer flips from public at check time to private at connect time", async () => {
    // What assertPublicUrl sees, what the socket would have used.
    checkTimeDns.map.set("rebind.research.example", ["93.184.216.34"]);
    connectTimeDns.map.set("rebind.research.example", ["127.0.0.1"]);

    const attempt = safeFetch("https://rebind.research.example/page");
    await expect(attempt).rejects.toBeInstanceOf(FetchRefused);
    await expect(attempt).rejects.toThrow("fetch_refused:private_address");
    // Both layers really resolved the name; the refusal came from the
    // connect-time lookup, not the pre-check.
    expect(checkTimeDns.queried).toEqual(["rebind.research.example"]);
    expect(connectTimeDns.queried).toContain("rebind.research.example");
  });

  it("still guards plain http the same way (http stays allowed, the destination is what is checked)", async () => {
    checkTimeDns.map.set("rebind.research.example", ["93.184.216.34"]);
    connectTimeDns.map.set("rebind.research.example", ["169.254.169.254"]);

    await expect(
      safeFetch("http://rebind.research.example/page"),
    ).rejects.toThrow("fetch_refused:private_address");
    expect(connectTimeDns.queried).toContain("rebind.research.example");
  });

  it("refuses at check time without opening a connection when the first answer is already private", async () => {
    checkTimeDns.map.set("rebind.research.example", ["10.0.0.8"]);

    await expect(
      safeFetch("https://rebind.research.example/page"),
    ).rejects.toThrow("fetch_refused:private_address");
    expect(connectTimeDns.queried).toEqual([]);
  });
});
