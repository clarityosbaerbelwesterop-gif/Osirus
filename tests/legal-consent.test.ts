import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
  type TestIdentity,
} from "./helpers/pglite";
import {
  LEGAL_VERSIONS,
  consentAllowsUse,
  staleLegalDocuments,
} from "../src/lib/legal/versions";
import {
  DEFAULT_SITE_URL,
  researchUserAgent,
  siteUrl,
} from "../src/lib/research/site-url";

const holder = vi.hoisted(() => ({ db: null as TestDatabase | null }));

vi.mock("../src/lib/db/client", () => ({
  queryAs: (userId: string, text: string, params?: unknown[]) =>
    holder.db!.queryAs(userId, text, params),
  querySystem: (text: string, params?: unknown[]) =>
    holder.db!.querySystem(text, params),
  db: () => {
    throw new Error("tests never reach Neon");
  },
}));

import { consentIsCurrent, recordCurrentConsent } from "../src/lib/legal/store";

let db: TestDatabase;
let alice: TestIdentity;
let bob: TestIdentity;

beforeAll(async () => {
  db = await createTestDatabase();
  holder.db = db;
  alice = await db.seedTenant("Alice");
  bob = await db.seedTenant("Bob");
}, 120000);

afterAll(async () => {
  await db.close();
});

describe("legal consent", () => {
  it("treats a missing or outdated text version as not accepted", () => {
    expect(staleLegalDocuments([])).toEqual(["terms", "eula", "privacy"]);
    expect(
      consentAllowsUse([
        { document: "terms", version: LEGAL_VERSIONS.terms },
        { document: "eula", version: LEGAL_VERSIONS.eula },
        { document: "privacy", version: "1999-01-01" },
      ]),
    ).toBe(false);
  });

  it("stores the current version with a timestamp and hides it from another user", async () => {
    expect(await consentIsCurrent(alice.userId)).toBe(false);
    await recordCurrentConsent(alice.userId);
    expect(await consentIsCurrent(alice.userId)).toBe(true);
    const [row] = await db.queryAs<{
      version: string;
      accepted_at: Date;
    }>(
      alice.userId,
      `select version, accepted_at
         from osirus.legal_acceptances
        where user_id = $1::uuid and document = 'terms'`,
      [alice.userId],
    );
    expect(row?.version).toBe(LEGAL_VERSIONS.terms);
    expect(row?.accepted_at).toBeInstanceOf(Date);
    const stolen = await db.queryAs<{ document: string }>(
      bob.userId,
      "select document from osirus.legal_acceptances",
    );
    expect(stolen).toEqual([]);
    expect(await consentIsCurrent(bob.userId)).toBe(false);
  });
});

describe("research user agent", () => {
  it("uses NEXT_PUBLIC_SITE_URL and never the unrelated host", () => {
    expect(siteUrl({})).toBe(DEFAULT_SITE_URL);
    expect(researchUserAgent({})).toBe(
      `OsirusResearch/1.0 (+${DEFAULT_SITE_URL})`,
    );
    expect(
      researchUserAgent({
        NEXT_PUBLIC_SITE_URL: "https://app.example.test/ignored",
      }),
    ).toBe("OsirusResearch/1.0 (+https://app.example.test)");
    expect(
      siteUrl({
        NEXT_PUBLIC_SITE_URL: "https://osirus.vercel.app",
      }),
    ).toBe(DEFAULT_SITE_URL);
  });
});
