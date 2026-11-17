import { describe, expect, it } from "vitest";
import { securityTxt } from "../src/app/.well-known/security.txt/route";

// RFC 9116: Contact and Expires are required; Expires under a year ahead.

describe("security.txt", () => {
  it("names a contact, a policy and an expiry under a year ahead", () => {
    const now = new Date("2026-11-17T10:00:00Z");
    const text = securityTxt(now);
    expect(text).toMatch(/^Contact: mailto:\S+@\S+$/m);
    expect(text).toMatch(/^Policy: https:\/\/osirus-ai\.com\/sicherheit$/m);
    expect(text).toMatch(
      /^Canonical: https:\/\/osirus-ai\.com\/\.well-known\/security\.txt$/m,
    );
    const expires = Date.parse(text.match(/^Expires: (.+)$/m)![1]!);
    expect(expires - now.getTime()).toBeGreaterThan(30 * 86_400_000);
    expect(expires - now.getTime()).toBeLessThan(365 * 86_400_000);
  });
});
