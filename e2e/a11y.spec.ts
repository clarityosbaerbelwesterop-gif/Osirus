import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mockApis, openSurface, SURFACES, VIEWPORTS } from "./support";

// Automated accessibility audit (axe, WCAG 2.2 A/AA rules) of every fixture
// surface in both themes. Serious and critical violations fail the build;
// moderate and minor ones are attached to the report for review.

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

for (const theme of ["light", "dark"] as const) {
  for (const surface of SURFACES) {
    test(`${surface} (${theme}) has no serious accessibility violations`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(VIEWPORTS.desktop);
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await mockApis(page);
      await openSurface(page, surface);
      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      const blocking = results.violations.filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      );
      if (results.violations.length)
        await testInfo.attach("axe-violations.json", {
          body: JSON.stringify(results.violations, null, 2),
          contentType: "application/json",
        });
      expect(
        blocking.map(
          (violation) =>
            `${violation.id}: ${violation.help} (${violation.nodes
              .slice(0, 3)
              .map((node) => node.target.join(" "))
              .join(" | ")})`,
        ),
      ).toEqual([]);
    });
  }
}

test("phone layout with navigation open has no serious violations", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORTS.phone);
  await mockApis(page);
  await openSurface(page, "chat-active");
  await page.getByRole("button", { name: "Open navigation" }).click();
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => v.id),
  ).toEqual([]);
});
