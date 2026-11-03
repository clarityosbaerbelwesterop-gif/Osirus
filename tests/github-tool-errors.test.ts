import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { githubErrorText, repositoryAlreadyExists } = await import(
  "../src/lib/connectors/github-tools"
);
const { sliceDeadlineAbort } = await import("../src/lib/arms/base");

describe("GitHub tool errors", () => {
  it("carries GitHub's per-field reason, not only its headline", () => {
    const body = {
      message: "Repository creation failed.",
      errors: [
        {
          resource: "Repository",
          code: "custom",
          field: "name",
          message: "name already exists on this account",
        },
      ],
    };
    expect(githubErrorText(body)).toBe(
      "Repository creation failed.: name already exists on this account",
    );
    expect(repositoryAlreadyExists(422, body)).toBe(true);
    expect(repositoryAlreadyExists(403, body)).toBe(false);
    expect(repositoryAlreadyExists(422, { message: "Validation Failed" })).toBe(false);
  });
});

describe("slice deadlines", () => {
  const aborted = (reason: unknown) => {
    const controller = new AbortController();
    controller.abort(reason);
    return controller.signal;
  };
  it("continues after a budget abort, never after a cancel or pause", () => {
    expect(sliceDeadlineAbort(aborted(new Error("continuation_budget_reached")))).toBe(true);
    expect(sliceDeadlineAbort(aborted(new Error("background_budget")))).toBe(true);
    expect(sliceDeadlineAbort(aborted(new Error("cancel_requested")))).toBe(false);
    expect(sliceDeadlineAbort(aborted(new Error("pause_requested")))).toBe(false);
    expect(sliceDeadlineAbort(aborted(new Error("lease_lost")))).toBe(false);
    expect(sliceDeadlineAbort(new AbortController().signal)).toBe(false);
  });
});
