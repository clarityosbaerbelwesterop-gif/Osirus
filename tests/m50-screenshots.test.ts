import { describe, expect, it } from "vitest";
import {
  collectScreenshots,
  MAX_SCREENSHOT_BYTES,
  persistScreenshots,
  unavailableCollection,
} from "../src/lib/computer/screenshots";
import type { SandboxHandle } from "../src/lib/sandbox/driver";

// A 1x1 transparent PNG, base64.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function fakeHandle(files: Record<string, string>) {
  const calls: Array<{ cmd: string; args?: string[] }> = [];
  const handle = {
    runCommand: async (input: { cmd: string; args?: string[] }) => {
      calls.push(input);
      const path = input.args?.at(-1) ?? "";
      const data = files[path];
      return data === undefined
        ? { exitCode: 1, stdout: "", stderr: "No such file" }
        : { exitCode: 0, stdout: data, stderr: "" };
    },
  } as unknown as SandboxHandle;
  return { handle, calls };
}

describe("M50 run screenshots", () => {
  it("reads each viewport image back out of the sandbox", async () => {
    const { handle, calls } = fakeHandle({
      "shots/desktop.png": PNG,
      "shots/phone.png": `${PNG}\n`,
    });
    const result = await collectScreenshots(handle, "shots", [
      { name: "desktop", screenshotBytes: 68 },
      { name: "phone", screenshotBytes: 68 },
    ]);
    expect(result.failures).toEqual([]);
    expect(result.screenshots.map((shot) => shot.viewport)).toEqual([
      "desktop",
      "phone",
    ]);
    expect(result.screenshots[1]?.data).toBe(PNG);
    expect(calls[0]).toMatchObject({
      cmd: "base64",
      args: ["-w", "0", "shots/desktop.png"],
    });
  });

  it("says why an image is missing instead of skipping it", async () => {
    const { handle } = fakeHandle({ "shots/tablet.png": "not a png" });
    const result = await collectScreenshots(handle, "shots", [
      { name: "desktop", screenshotBytes: 0 },
      { name: "tablet", screenshotBytes: 40 },
      { name: "phone", screenshotBytes: MAX_SCREENSHOT_BYTES + 1 },
      { name: "../etc", screenshotBytes: 40 },
    ]);
    expect(result.screenshots).toEqual([]);
    expect(result.failures.map((failure) => failure.reason)).toEqual([
      "capture_failed",
      "read_failed",
      "too_large",
    ]);
  });

  it("stores one artifact per image and never puts bytes in refs", async () => {
    const written: Array<Record<string, unknown>> = [];
    const refs = await persistScreenshots({
      url: "https://preview.example/",
      producedBy: "building.qa_preview",
      collection: {
        screenshots: [
          { viewport: "desktop", mediaType: "image/png", data: PNG, bytes: 68 },
        ],
        failures: [],
      },
      write: async (artifact) => {
        written.push(artifact);
      },
    });
    expect(refs).toEqual(["screenshot:desktop"]);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      kind: "screenshot",
      contentType: "image/png",
      title: "Screenshot · desktop",
    });
  });

  it("records an honest note when the run had no browser", async () => {
    const written: Array<Record<string, unknown>> = [];
    const refs = await persistScreenshots({
      url: "https://preview.example/",
      producedBy: "building.qa_preview",
      collection: unavailableCollection(
        "no_sandbox",
        "No sandbox workspace with a browser was available.",
      ),
      write: async (artifact) => {
        written.push(artifact);
      },
    });
    expect(refs).toEqual([]);
    expect(written[0]).toMatchObject({
      kind: "screenshot-unavailable",
      contentType: "application/json",
    });
    expect(JSON.stringify(written[0])).toContain("no_sandbox");
  });

  it("keeps a failed artifact write from failing the run", async () => {
    const refs = await persistScreenshots({
      url: "https://preview.example/",
      producedBy: "coding.computer_inspect",
      collection: {
        screenshots: [
          { viewport: "phone", mediaType: "image/png", data: PNG, bytes: 68 },
        ],
        failures: [],
      },
      write: async () => {
        throw new Error("db down");
      },
    });
    expect(refs).toEqual([]);
  });
});
