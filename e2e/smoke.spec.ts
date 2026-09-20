import { test, expect } from "@playwright/test";
test("renders ChatHub", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("ChatHub")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
});
test("health is safe", async ({ request }) => {
  const r = await request.get("/api/health");
  expect(r.ok()).toBeTruthy();
  const body = await r.json();
  expect(body.status).toBe("ok");
  expect(JSON.stringify(body)).not.toContain("DATABASE_URL");
});
