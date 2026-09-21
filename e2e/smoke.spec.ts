import { expect, test } from "@playwright/test";

test("renders authentication entry point", async ({ page }) => {
  await page.goto("/auth/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with GitHub" }),
  ).toBeVisible();
});

test("health response never exposes secrets", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(["ok", "degraded"]).toContain(body.status);
  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain("DATABASE_URL");
  expect(serialized).not.toContain("UNOROUTER_API_KEY");
  expect(serialized).not.toContain("postgresql://");
});
