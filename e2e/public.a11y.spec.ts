import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const PAGES = [
  ["/", "Dein KI-Team mit"],
  ["/legal/privacy", "Datenschutzerklärung"],
  ["/legal/terms", "Allgemeine Geschäftsbedingungen"],
  ["/legal/eula", "Endnutzer-Lizenz"],
  ["/legal/cookies", "Cookie-Hinweis"],
  ["/legal/impressum", "Impressum"],
  ["/auth/sign-up", "Konto erstellen"],
  ["/kuendigen", "Verträge hier kündigen"],
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

test("the cancellation button is on the landing page and leads to a page without sign-in", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Verträge hier kündigen" }).click();
  await expect(page).toHaveURL(/\/kuendigen$/);
  await expect(
    page.getByRole("heading", { name: "Verträge hier kündigen" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Jetzt kündigen" }),
  ).toBeVisible();
});

test("cancelling shows the declaration with date, time and reference to save", async ({
  page,
}) => {
  let sent: Record<string, unknown> | null = null;
  await page.route("**/api/kuendigen", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        reference: "K-20261029-E2E001",
        receivedAt: "2026-10-29T13:05:33.000Z",
        outcome:
          "Deine Kündigung wirkt zum nächstmöglichen Zeitpunkt. Das genaue Vertragsende bestätigen wir dir per E-Mail an erika@example.com.",
        text: "Bestätigung deiner Kündigung\n\nEingang: 29. Oktober 2026 um 14:05:33 Uhr (Ortszeit Berlin)\nVorgangsnummer: K-20261029-E2E001\n",
        mailSent: true,
      }),
    });
  });
  await page.goto("/kuendigen");
  const submit = page.getByRole("button", { name: "Jetzt kündigen" });
  // Native validation keeps an empty declaration on the page.
  await submit.click();
  await expect(page).toHaveURL(/\/kuendigen$/);
  expect(sent).toBeNull();

  await page.getByLabel("Vor- und Nachname").fill("Erika Mustermann");
  await page.getByLabel(/E-Mail-Adresse/).fill("erika@example.com");
  await page.getByLabel(/Außerordentliche/).check();
  await expect(page.getByLabel("Kündigungsgrund")).toBeVisible();
  await page.getByLabel("Kündigungsgrund").fill("Dienst nicht nutzbar");
  await page.getByLabel("Zu einem bestimmten Datum").check();
  await page.getByLabel("Gewünschtes Vertragsende").fill("2099-12-31");
  await submit.click();

  await expect(
    page.getByRole("heading", { name: "Deine Kündigung ist eingegangen" }),
  ).toBeFocused();
  await expect(page.getByText("K-20261029-E2E001").first()).toBeVisible();
  await expect(
    page.getByText("29. Oktober 2026 um 14:05:33 Uhr").first(),
  ).toBeVisible();
  expect(sent).toMatchObject({
    name: "Erika Mustermann",
    email: "erika@example.com",
    contract: "subscription",
    kind: "extraordinary",
    reason: "Dienst nicht nutzbar",
    timing: "date",
    requestedEnd: "2099-12-31",
  });

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Bestätigung speichern" }).click();
  expect((await download).suggestedFilename()).toBe(
    "Kuendigung-K-20261029-E2E001.txt",
  );
  await expect(
    page.getByRole("button", { name: "Drucken oder als PDF sichern" }),
  ).toBeVisible();
});

test("a failed cancellation keeps the form and names the e-mail fallback", async ({
  page,
}) => {
  await page.route("**/api/kuendigen", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "not_stored" }),
    }),
  );
  await page.goto("/kuendigen");
  await page.getByLabel("Vor- und Nachname").fill("Erika Mustermann");
  await page.getByLabel(/E-Mail-Adresse/).fill("erika@example.com");
  await page.getByRole("button", { name: "Jetzt kündigen" }).click();
  await expect(page.locator("#cancel-error")).toContainText("per E-Mail an");
  await expect(
    page.getByRole("button", { name: "Jetzt kündigen" }),
  ).toBeEnabled();
});
