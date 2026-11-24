import { describe, expect, it } from "vitest";
import { sandboxErrorSummary } from "../src/lib/sandbox/error-summary";

// Operator logs say why a sandbox call failed, never with a credential.

describe("a failed sandbox call in the logs", () => {
  it("names the status, code and message without tokens", () => {
    const error = Object.assign(
      new Error(
        "Forbidden: token eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJvc2lydXMifQ.c2lnbmF0dXJlLXZhbHVl rejected",
      ),
      {
        name: "APIError",
        response: { status: 403 },
        json: { error: { code: "oidc_token_expired" } },
      },
    );
    const summary = sandboxErrorSummary(error);
    expect(summary).toMatchObject({
      name: "APIError",
      status: 403,
      code: "oidc_token_expired",
    });
    expect(JSON.stringify(summary)).not.toContain("eyJhbGci");
  });

  it("keeps the cause and copes with non-errors", () => {
    const error = new Error("Could not get credentials from OIDC context.", {
      cause: new Error("missing x-vercel-oidc-token"),
    });
    expect(sandboxErrorSummary(error).cause).toBe(
      "Error: missing x-vercel-oidc-token",
    );
    expect(sandboxErrorSummary("boom")).toEqual({ name: "string" });
  });
});
