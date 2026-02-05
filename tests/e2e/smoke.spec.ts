import { describe, it } from "vitest";

const isPlaywrightRun = Boolean(process.env.PLAYWRIGHT_TEST || process.env.PLAYWRIGHT);

if (isPlaywrightRun) {
  // Cargamos Playwright solo cuando se ejecuta con su runner.
  const { test, expect } = await import("@playwright/test");

  test.describe("Home", () => {
    test("shows hero and key sections", async ({ page }) => {
      await page.goto("/");

      await expect(
        page.getByRole("heading", {
          level: 1,
          name: /Frontend React \+ Next\.js \+ Phaser/i,
        }),
      ).toBeVisible();

      await expect(page.getByRole("heading", { level: 2, name: /Setup rapido/i })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: /Build & pruebas/i })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: /Flujos clave/i })).toBeVisible();
    });
  });
} else {
  // Placeholder para que Vitest no falle cuando no se ejecuta Playwright.
  describe.skip("Playwright e2e", () => {
    it("Se ejecuta solo con PLAYWRIGHT_TEST=1 npx playwright test", () => {});
  });
}
