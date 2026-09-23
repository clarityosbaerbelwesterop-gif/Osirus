import { expect, test, type Page } from "@playwright/test";
import { mockApis, openSurface, VIEWPORTS } from "./support";

// Keyboard use of the shell: skip link, visible focus, the composer's
// Enter / Shift+Enter contract, tabs with arrow keys, the window-splitter and
// dismissing the run-details sheet with Escape.

const focusIndicator = (page: Page) =>
  page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) return null;
    // The composer and the search field draw their ring around the whole
    // box (:focus-within) rather than on the bare input.
    const target = element.closest(".composer, .sidebar-search") ?? element;
    const style = getComputedStyle(target);
    return {
      outline: style.outlineStyle !== "none" && style.outlineWidth !== "0px",
      shadow: style.boxShadow !== "none",
    };
  });

test.use({ viewport: VIEWPORTS.desktop });

test("skip link is first and moves focus to the main content", async ({
  page,
}) => {
  await mockApis(page);
  // The empty chat focuses its composer on load; start from a page that
  // leaves focus where the browser puts it.
  await openSurface(page, "connections");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});

test("every tab stop in the shell shows a focus indicator", async ({
  page,
}) => {
  await mockApis(page);
  await openSurface(page, "chat-coding");
  for (let index = 0; index < 18; index += 1) {
    await page.keyboard.press("Tab");
    const indicator = await focusIndicator(page);
    if (!indicator) continue;
    const name = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement;
      return (
        element.getAttribute("aria-label") ??
        (element.innerText.slice(0, 40) || element.outerHTML.slice(0, 80))
      );
    });
    expect(
      indicator.outline || indicator.shadow,
      `focus indicator on "${name}"`,
    ).toBe(true);
  }
});

test("composer: Enter sends, Shift+Enter adds a line", async ({ page }) => {
  await mockApis(page);
  await page.route("**/api/runtime", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: 'data: {"kind":"error","message":"stopped by test"}\n\n',
    }),
  );
  await openSurface(page, "chat-empty");
  const composer = page.getByRole("textbox", { name: "Message Osirus" });
  await composer.click();
  await composer.pressSequentially("First line");
  await page.keyboard.press("Shift+Enter");
  await composer.pressSequentially("second line");
  await expect(composer).toHaveValue("First line\nsecond line");
  const request = page.waitForRequest("**/api/runtime");
  await page.keyboard.press("Enter");
  const sent = (await request).postDataJSON() as { objective: string };
  expect(sent.objective).toBe("First line\nsecond line");
});

test("workbench tabs follow arrow keys and the splitter resizes", async ({
  page,
}) => {
  await mockApis(page);
  await openSurface(page, "chat-coding");
  const toggle = page.getByRole("button", { name: "Show run details" });
  if (await toggle.isVisible()) await toggle.click();
  const groups = page.getByRole("tablist", { name: "Workbench sections" });
  const first = groups.getByRole("tab").first();
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(groups.getByRole("tab").nth(1)).toBeFocused();

  const splitter = page.getByRole("separator", { name: "Resize run details" });
  const before = Number(await splitter.getAttribute("aria-valuenow"));
  await splitter.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(splitter).toHaveAttribute("aria-valuenow", String(before + 24));
  await page.keyboard.press("End");
  await expect(splitter).toHaveAttribute("aria-valuenow", "340");
});

test("run details sheet closes with Escape and returns focus", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORTS.tablet);
  await mockApis(page);
  await openSurface(page, "chat-coding");
  const toggle = page.getByRole("button", { name: "Show run details" });
  await toggle.click();
  const sheet = page.getByRole("dialog", { name: "Run details" });
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(toggle).toBeFocused();
});
