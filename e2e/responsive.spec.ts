import { expect, test } from "@playwright/test";
import {
  horizontalOverflow,
  mockApis,
  openSurface,
  SURFACES,
  VIEWPORTS,
} from "./support";

// No surface may scroll sideways at the four reference widths, and the
// navigation must stay reachable at each of them.

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`${name} ${viewport.width}px`, () => {
    test.use({ viewport });

    for (const surface of SURFACES) {
      test(`${surface} has no horizontal overflow`, async ({ page }) => {
        await mockApis(page);
        await openSurface(page, surface);
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      });
    }

    test("navigation is reachable", async ({ page }) => {
      await mockApis(page);
      await openSurface(page, "chat-empty");
      if (viewport.width < 1024) {
        await page.getByRole("button", { name: "Open navigation" }).click();
      }
      await expect(
        page.getByRole("link", { name: "Connections" }).first(),
      ).toBeVisible();
    });
  });
}
