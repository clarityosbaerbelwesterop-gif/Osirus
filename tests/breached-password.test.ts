import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  breachCount,
  passwordIsBreached,
} from "@/lib/security/breached-password";

const sha1 = (value: string) =>
  createHash("sha1").update(value).digest("hex").toUpperCase();

function rangeApi(rows: Record<string, number>) {
  return vi.fn(async (...call: [string | URL | Request, RequestInit?]) => {
    const prefix = String(call[0]).split("/").pop()!;
    const body = Object.entries(rows)
      .filter(([hash]) => hash.startsWith(prefix))
      .map(([hash, count]) => `${hash.slice(5)}:${count}`)
      // Padding rows (count 0), as the API adds with Add-Padding.
      .concat(["0000000000000000000000000000000000A:0"])
      .join("\r\n");
    return new Response(body, { status: 200 });
  });
}

describe("breached password check (k-anonymity)", () => {
  it("sends only the first five hash characters and finds a leaked password", async () => {
    const api = rangeApi({ [sha1("password123")]: 251682 });
    expect(await breachCount("password123", api as typeof fetch)).toBe(251682);
    const url = String(api.mock.calls[0]![0]);
    expect(url).toBe(
      `https://api.pwnedpasswords.com/range/${sha1("password123").slice(0, 5)}`,
    );
    expect(url).not.toContain("password123");
    const init = api.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)["Add-Padding"]).toBe(
      "true",
    );
  });

  it("passes a password that is not in the list (padding rows do not count)", async () => {
    const api = rangeApi({ [sha1("password123")]: 3 });
    expect(
      await passwordIsBreached("x7#Lq-unique-Ühorse-91", api as typeof fetch),
    ).toBe(false);
  });

  it("fails open when the service is down or slow", async () => {
    const down = vi.fn(async () => new Response("", { status: 503 }));
    expect(await breachCount("password123", down as typeof fetch)).toBeNull();
    expect(await passwordIsBreached("password123", down as typeof fetch)).toBe(
      false,
    );
    const broken = vi.fn(async () => {
      throw new Error("timeout");
    });
    expect(await breachCount("password123", broken as typeof fetch)).toBeNull();
  });
});
