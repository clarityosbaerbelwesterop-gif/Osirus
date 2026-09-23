import { expect, test, type Page } from "@playwright/test";
import { mockApis, openSurface, VIEWPORTS, type Surface } from "./support";

// Visual regression for the main surfaces. Baselines are rendered by the CI
// browser (see .github/workflows/visual-baselines.yml) and compared on every
// CI run; the diff images are uploaded as artifacts when a comparison fails.
// Clock-dependent text is hidden by e2e/screenshot.css, not masked, so the
// images keep their real layout.

type Shot = {
  name: string;
  surface: Surface;
  viewport: keyof typeof VIEWPORTS;
  theme: "light" | "dark";
  prepare?: (page: Page) => Promise<void>;
};

const openRunDetails = async (page: Page) => {
  const toggle = page.getByRole("button", { name: "Show run details" });
  if (await toggle.isVisible()) await toggle.click();
};

const SHOTS: Shot[] = [
  {
    name: "chat-empty-desktop",
    surface: "chat-empty",
    viewport: "desktop",
    theme: "light",
  },
  {
    name: "chat-active-run",
    surface: "chat-active",
    viewport: "desktop",
    theme: "dark",
  },
  {
    name: "chat-research-run",
    surface: "chat-research",
    viewport: "desktop",
    theme: "light",
    prepare: async (page) => {
      await openRunDetails(page);
      await page.getByRole("tab", { name: "Knowledge" }).click();
      const sources = page.getByRole("tab", { name: "Sources" });
      if (await sources.count()) await sources.click();
      await expect(
        page.getByText("LanceDB documentation").first(),
      ).toBeVisible();
    },
  },
  {
    name: "coding-workbench",
    surface: "chat-coding",
    viewport: "desktop",
    theme: "dark",
    prepare: async (page) => {
      await openRunDetails(page);
      await page.getByRole("tab", { name: "Build" }).click();
      await page.getByRole("tab", { name: "Diff" }).click();
      await expect(
        page.getByText("return sorted.length % 2 === 0").first(),
      ).toBeVisible();
    },
  },
  {
    name: "approval-card",
    surface: "approvals",
    viewport: "laptop",
    theme: "light",
  },
  {
    name: "connections",
    surface: "connections",
    viewport: "desktop",
    theme: "light",
  },
  { name: "settings", surface: "settings", viewport: "desktop", theme: "dark" },
  {
    name: "automations",
    surface: "automations",
    viewport: "desktop",
    theme: "light",
  },
  {
    name: "tablet-coding",
    surface: "chat-coding",
    viewport: "tablet",
    theme: "light",
  },
  {
    name: "mobile-active-run",
    surface: "chat-active",
    viewport: "phone",
    theme: "light",
  },
  {
    name: "mobile-inbox-dark",
    surface: "inbox",
    viewport: "phone",
    theme: "dark",
  },
];

for (const shot of SHOTS) {
  test(`${shot.name} (${shot.viewport}, ${shot.theme})`, async ({ page }) => {
    await page.setViewportSize(VIEWPORTS[shot.viewport]);
    await page.emulateMedia({
      colorScheme: shot.theme,
      reducedMotion: "reduce",
    });
    await mockApis(page);
    await openSurface(page, shot.surface);
    await shot.prepare?.(page);
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot(`${shot.name}.png`);
  });
}
