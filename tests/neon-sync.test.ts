import { describe, expect, it } from "vitest";
import {
  missingTables,
  neonRegionFromUrl,
  pickDatabase,
  pickDefaultBranch,
  REQUIRED_TABLES,
  resolveNeonProject,
  vercelRegionForNeon,
} from "../scripts/lib/neon.mjs";

describe("neon region mapping", () => {
  it("maps Neon regions to the nearest Vercel function region", () => {
    expect(vercelRegionForNeon("aws-eu-central-1")).toBe("fra1");
    expect(vercelRegionForNeon("aws-us-east-1")).toBe("iad1");
    expect(vercelRegionForNeon("mars-1")).toBeNull();
    expect(vercelRegionForNeon(undefined)).toBeNull();
  });

  it("reads the region from a Neon host name", () => {
    expect(
      neonRegionFromUrl(
        "postgresql://u:p@ep-x-pooler.c-6.eu-central-1.aws.neon.tech/neondb",
      ),
    ).toBe("aws-eu-central-1");
    expect(
      neonRegionFromUrl(
        "https://ep-icy-shadow-b2ea2wve.neonauth.c-6.eu-central-1.aws.neon.tech/neondb/auth",
      ),
    ).toBe("aws-eu-central-1");
    expect(neonRegionFromUrl("postgres://localhost/db")).toBeNull();
    expect(neonRegionFromUrl("not a url")).toBeNull();
  });

  it("pins vercel.json to the Neon region of this project", async () => {
    const { readFileSync } = await import("node:fs");
    const config = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(config.regions).toEqual([vercelRegionForNeon("aws-eu-central-1")]);
  });
});

describe("neon project selection", () => {
  it("prefers the default branch, then primary, then the first", () => {
    expect(
      pickDefaultBranch([{ id: "a" }, { id: "b", default: true }])?.id,
    ).toBe("b");
    expect(
      pickDefaultBranch([{ id: "a" }, { id: "b", primary: true }])?.id,
    ).toBe("b");
    expect(pickDefaultBranch([{ id: "a" }])?.id).toBe("a");
    expect(pickDefaultBranch(null)).toBeNull();
  });

  it("prefers neondb", () => {
    expect(pickDatabase([{ name: "x" }, { name: "neondb" }])?.name).toBe(
      "neondb",
    );
    expect(pickDatabase([{ name: "x" }])?.name).toBe("x");
    expect(pickDatabase([])).toBeNull();
  });

  it("lists required tables that are absent", () => {
    expect(missingTables(REQUIRED_TABLES)).toEqual([]);
    expect(
      missingTables(
        REQUIRED_TABLES.filter((t) => t !== "osirus.stripe_events"),
      ),
    ).toEqual(["osirus.stripe_events"]);
  });
});

describe("resolveNeonProject", () => {
  const responses: Record<string, unknown> = {
    "/projects/p1": {
      project: { name: "osirus", region_id: "aws-eu-central-1" },
    },
    "/projects/p1/branches": {
      branches: [
        { id: "br-dev", name: "dev" },
        { id: "br-prod", name: "production", default: true },
      ],
    },
    "/projects/p1/branches/br-prod/databases": {
      databases: [{ name: "neondb", owner_name: "neondb_owner" }],
    },
    "/projects/p1/connection_uri": {
      uri: "postgresql://neondb_owner:secret@host/neondb",
    },
  };

  function fakeFetch(seen: string[]) {
    return (async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname.replace("/api/v2", "");
      seen.push(new URL(url).pathname + new URL(url).search);
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer k",
      );
      const body = responses[path];
      return new Response(JSON.stringify(body ?? {}), {
        status: body ? 200 : 404,
      });
    }) as unknown as typeof fetch;
  }

  it("resolves region, default branch, database and a pooled URI", async () => {
    const seen: string[] = [];
    const result = await resolveNeonProject({
      apiKey: "k",
      projectId: "p1",
      fetchImpl: fakeFetch(seen),
    });
    expect(result).toEqual({
      projectName: "osirus",
      regionId: "aws-eu-central-1",
      branchName: "production",
      databaseName: "neondb",
      uri: "postgresql://neondb_owner:secret@host/neondb",
    });
    const uriCall = seen.find((s) => s.includes("connection_uri"));
    expect(uriCall).toContain("branch_id=br-prod");
    expect(uriCall).toContain("role_name=neondb_owner");
    expect(uriCall).toContain("pooled=true");
  });

  it("reports the HTTP status without the response body", async () => {
    await expect(
      resolveNeonProject({
        apiKey: "k",
        projectId: "missing",
        fetchImpl: fakeFetch([]),
      }),
    ).rejects.toThrow("Neon API /projects/missing answered HTTP 404");
  });
});
