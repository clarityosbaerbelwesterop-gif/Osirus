# M50 — Screenshots in production runs

Part of the emergency recovery in issue #26.

## Root cause

The in-sandbox browser (`src/lib/computer/script.ts`) saved one PNG per
viewport inside the VM at `.osirus-browser/shots/<viewport>.png`. Only the byte
count (`screenshotBytes`) came back to the run. The images were never read back
out of the sandbox, never stored, and never shown. The verification artifact
listed `screenshot:desktop` as evidence that nobody could open.

When no sandbox was available, the run fell back to an HTTP check and said
nothing about screenshots at all.

## Fix

- `src/lib/computer/screenshots.ts` reads each PNG back over the command
  channel (base64, PNG signature checked, 1.5 MB cap per image) and returns the
  images plus a typed reason for every one it could not get.
- The building arm's QA stage and the `computer.inspect` tool store each image
  as a run artifact (`kind: screenshot`, `image/png`). The model never receives
  the bytes; the tool result only lists which images were saved.
- When a run cannot take pictures (no sandbox, browser failed to start, image
  missing or too large) it stores a `screenshot-unavailable` artifact with the
  reason, so the workbench says so instead of staying silent.
- The run snapshot the workbench polls every two seconds strips image bytes.
  The image is fetched once from
  `GET /api/runtime/[runId]/artifacts/[artifactId]`, which requires a session,
  reads under row-level security, is rate limited, serves only `image/png`, and
  sends `Cache-Control: private, no-store`, `nosniff` and a sandboxed CSP.
- The Artifacts panel shows screenshots as lazy thumbnails with alt text that
  open the full image.

No migration. Artifacts already store JSON content with a content type.

## Pass/fail matrix

| Case                                   | Expected                                      | Covered by              |
| -------------------------------------- | --------------------------------------------- | ----------------------- |
| Sandbox browser takes 3 viewport shots | 3 `screenshot` artifacts, thumbnails in panel | unit test, prod check   |
| Image missing or not a PNG             | `read_failed` reason, no broken image         | unit test               |
| Image over 1.5 MB                      | `too_large` reason                            | unit test               |
| Viewport name with path characters     | ignored                                       | unit test               |
| No sandbox in the run                  | `screenshot-unavailable` note with reason     | unit test, prod check   |
| Artifact write fails                   | run continues, no ref claimed                 | unit test               |
| Snapshot poll                          | no base64 in response                         | code review, prod check |
| Image from another user's run          | 404                                           | RLS, prod check         |

## Production verification (after merge, needs a working login)

1. Sign in on https://osirus.vercel.app and start a build run that serves a page.
2. Open the Artifacts panel. Expect three screenshot thumbnails, or one
   "No screenshots captured" row with the reason.
3. Open a thumbnail. Expect the PNG with `Cache-Control: private, no-store`.
4. Signed out, the image URL returns 401.
