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

test("wide windows switch pages without the blurred snapshot or a blurred sidebar; narrower windows keep the transition", async ({ page }) => {
  const switches = async () => {
    await page.evaluate(() => {
      window.__transitions = 0;
      const start = document.startViewTransition?.bind(document);
      if (start) document.startViewTransition = (update) => { window.__transitions++; return start(update); };
    });
    await page.locator('[data-page="market"]').locator("visible=true").first().click();
    await expect(page.locator('[data-page-panel="market"]').first()).toBeVisible();
    return page.evaluate(() => window.__transitions);
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/glass-preview/);
  expect(await page.locator(".sidebar").evaluate((bar) => getComputedStyle(bar).backdropFilter)).toBe("none");
  expect(await switches()).toBe(0);
  const animation = await page.evaluate(() => document.getAnimations().map((item) => item.animationName));
  expect(animation).not.toContain("glass-frost-in");

  await page.setViewportSize({ width: 800, height: 1000 });
  // The page shown last is remembered for the tab; start this half from home again.
  await page.evaluate(() => sessionStorage.clear());
  await page.goto("/");
  expect(await page.locator(".sidebar").evaluate((bar) => getComputedStyle(bar).backdropFilter)).toContain("blur");
  expect(await switches()).toBe(1);
});
