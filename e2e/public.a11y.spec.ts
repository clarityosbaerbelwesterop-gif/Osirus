import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const PAGES = [
  ["/", "Bots, Work und"],
  ["/legal/privacy", "Datenschutzerklärung"],
  ["/legal/terms", "Allgemeine Geschäftsbedingungen"],
  ["/legal/eula", "Endnutzer-Lizenz"],
  ["/legal/cookies", "Cookie-Hinweis"],
  ["/legal/impressum", "Impressum"],
  ["/auth/sign-up", "Konto erstellen"],
  ["/gibt-es-nicht", "Diese Seite gibt es nicht"],
] as const;

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const) {
  for (const [path, heading] of PAGES) {
    test(`${path} (${viewport.name}) has no serious accessibility violations`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(path);
      await expect(page.getByText(heading).first()).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      const blocking = results.violations.filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      );
      if (results.violations.length) {
        await testInfo.attach("axe-violations.json", {
          body: JSON.stringify(results.violations, null, 2),
          contentType: "application/json",
        });
      }
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

test("sign-up buttons stay disabled until both legal boxes are checked", async ({
  page,
}) => {
  await page.goto("/auth/sign-up");
  const create = page.getByRole("button", { name: "Konto erstellen" });
  const github = page.getByRole("button", { name: "Weiter mit GitHub" });
  await expect(create).toBeDisabled();
  await expect(github).toBeDisabled();
  await page.getByLabel(/Ich akzeptiere die AGB/).check();
  await expect(create).toBeDisabled();
  await page.getByLabel(/Datenschutzerklärung/).check();
  await expect(create).toBeEnabled();
  await expect(github).toBeEnabled();
});
