import { test, expect } from "@playwright/test";

// A first visit has no saved preference, so it gets the default glass style.
test.use({ storageState: { cookies: [], origins: [] } });

const openSettings = async (page) => {
  await page.locator('[data-dialog="settings"]').locator("visible=true").first().click();
  await expect(page.locator("#dialog-heading")).toHaveText("設定");
};

test("glass is the default style and settings switch to classic and back", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/glass-preview/);
  await openSettings(page);
  await expect(page.locator("#ui-style")).toHaveValue("glass");
  await page.locator("#ui-style").selectOption("classic");
  await expect(page.locator("html")).not.toHaveClass(/glass-preview/);
  await page.reload();
  await expect(page.locator("html")).not.toHaveClass(/glass-preview/);
  await openSettings(page);
  await expect(page.locator("#ui-style")).toHaveValue("classic");
  await page.locator("#ui-style").selectOption("glass");
  await expect(page.locator("html")).toHaveClass(/glass-preview/);
});

test("reduce effects removes motion and blur and survives a reload", async ({ page }) => {
  await page.goto("/");
  await openSettings(page);
  await expect(page.locator("#reduce-effects")).not.toBeChecked();
  await page.locator("#reduce-effects").check();
  await expect(page.locator("html")).toHaveAttribute("data-effects", "reduced");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-effects", "reduced");
  // Still glass, but the frosted bar and the page transition are off.
  await expect(page.locator("html")).toHaveClass(/glass-preview/);
  expect(await page.locator(".sidebar").evaluate((bar) => getComputedStyle(bar).backdropFilter)).toBe("none");
  await page.locator('[data-page="market"]').locator("visible=true").first().click();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await openSettings(page);
  await page.locator("#reduce-effects").uncheck();
  await expect(page.locator("html")).not.toHaveAttribute("data-effects", "reduced");
});

test("the URL can force either style for comparison", async ({ page }) => {
  await page.goto("/?glass=0");
  await expect(page.locator("html")).not.toHaveClass(/glass-preview/);
  await page.goto("/?glass=1");
  await expect(page.locator("html")).toHaveClass(/glass-preview/);
});
