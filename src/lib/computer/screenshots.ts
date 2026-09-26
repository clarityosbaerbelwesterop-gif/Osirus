import type { SandboxHandle } from "../sandbox/driver";

// Screenshots from the sandbox browser, carried back to the run.
//
// The browser script saves one PNG per viewport inside the sandbox VM. Until
// now only the byte count came back, so a run could say "screenshot:desktop"
// while the user never saw a picture. This reads each file back (base64 over
// the command channel, because SandboxHandle.readFile is text-only), bounds
// its size, and turns it into a run artifact the workbench can show.
//
// Capture that cannot happen is said out loud: every run that looked for
// screenshots and found none gets a typed reason instead of silence.

/** Larger images are dropped with a reason rather than bloating the run. */
export const MAX_SCREENSHOT_BYTES = 1_500_000;

export type CapturedScreenshot = {
  viewport: string;
  mediaType: "image/png";
  /** Base64 PNG. Never logged. */
  data: string;
  bytes: number;
};

export type ScreenshotUnavailableReason =
  "no_browser" | "no_sandbox" | "capture_failed" | "read_failed" | "too_large";

export type ScreenshotCollection = {
  screenshots: CapturedScreenshot[];
  failures: Array<{
    viewport: string | null;
    reason: ScreenshotUnavailableReason;
    detail: string;
  }>;
};

const PNG_SIGNATURE = "iVBORw0KGgo";
const SAFE_NAME = /^[a-z0-9-]{1,32}$/;

export async function collectScreenshots(
  handle: SandboxHandle,
  shotDir: string,
  viewports: Array<{ name: string; screenshotBytes: number }>,
): Promise<ScreenshotCollection> {
  const result: ScreenshotCollection = { screenshots: [], failures: [] };
  for (const viewport of viewports) {
    if (!SAFE_NAME.test(viewport.name)) continue;
    if (viewport.screenshotBytes <= 0) {
      result.failures.push({
        viewport: viewport.name,
        reason: "capture_failed",
        detail: "The browser did not produce an image at this width.",
      });
      continue;
    }
    if (viewport.screenshotBytes > MAX_SCREENSHOT_BYTES) {
      result.failures.push({
        viewport: viewport.name,
        reason: "too_large",
        detail: `The image is ${viewport.screenshotBytes} bytes; the limit is ${MAX_SCREENSHOT_BYTES}.`,
      });
      continue;
    }
    const read = await handle
      .runCommand({
        cmd: "base64",
        args: ["-w", "0", `${shotDir}/${viewport.name}.png`],
        timeoutMs: 15_000,
      })
      .catch(() => null);
    const data = (read?.stdout ?? "").trim();
    if (!read || read.exitCode !== 0 || !data.startsWith(PNG_SIGNATURE)) {
      result.failures.push({
        viewport: viewport.name,
        reason: "read_failed",
        detail: "The image could not be read back from the workspace.",
      });
      continue;
    }
    const bytes = Math.floor((data.length * 3) / 4);
    if (bytes > MAX_SCREENSHOT_BYTES) {
      result.failures.push({
        viewport: viewport.name,
        reason: "too_large",
        detail: `The image is ${bytes} bytes; the limit is ${MAX_SCREENSHOT_BYTES}.`,
      });
      continue;
    }
    result.screenshots.push({
      viewport: viewport.name,
      mediaType: "image/png",
      data,
      bytes,
    });
  }
  return result;
}

type ArtifactWriter = (artifact: {
  kind: string;
  title: string;
  contentType: string;
  content: Record<string, unknown>;
  provenance: Record<string, unknown>;
}) => Promise<unknown>;

/**
 * Store each screenshot as its own run artifact, and one note when none
 * could be captured. Returns the refs a report can cite.
 */
export async function persistScreenshots(input: {
  write: ArtifactWriter;
  url: string;
  collection: ScreenshotCollection;
  producedBy: string;
  stageId?: string | null;
}): Promise<string[]> {
  const refs: string[] = [];
  for (const shot of input.collection.screenshots) {
    const saved = await input
      .write({
        kind: "screenshot",
        title: `Screenshot · ${shot.viewport}`,
        contentType: shot.mediaType,
        content: {
          viewport: shot.viewport,
          url: input.url,
          bytes: shot.bytes,
          data: shot.data,
        },
        provenance: {
          producedBy: input.producedBy,
          stageId: input.stageId ?? null,
        },
      })
      .then(() => true)
      .catch(() => false);
    if (saved) refs.push(`screenshot:${shot.viewport}`);
  }
  if (!input.collection.screenshots.length && input.collection.failures.length)
    await input
      .write({
        kind: "screenshot-unavailable",
        title: "No screenshots captured",
        contentType: "application/json",
        content: {
          url: input.url,
          failures: input.collection.failures.slice(0, 6),
        },
        provenance: {
          producedBy: input.producedBy,
          stageId: input.stageId ?? null,
        },
      })
      .catch(() => undefined);
  return refs;
}

/** The note a run stores when it had no browser to take pictures with. */
export function unavailableCollection(
  reason: ScreenshotUnavailableReason,
  detail: string,
): ScreenshotCollection {
  return {
    screenshots: [],
    failures: [{ viewport: null, reason, detail: detail.slice(0, 240) }],
  };
}
