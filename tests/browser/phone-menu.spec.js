import { test, expect } from "@playwright/test";

// This spec starts on the market list; the app itself opens on the home page.
test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

test.use({ viewport: { width: 390, height: 844 } });

test("phone bar keeps the brand and moves guides and settings into one menu", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".sidebar .brand")).toBeVisible();
  await expect(page.locator('.sidebar nav [data-dialog="methodology"]')).toBeHidden();
  await expect(page.locator('.sidebar-bottom > [data-dialog="settings"]')).toBeHidden();
  const toggle = page.getByRole("button", { name: "更多選單" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  const menu = page.getByRole("menu", { name: "更多選單" });
  await expect(menu.getByRole("menuitem")).toHaveText(["指標說明", "資料說明", "設定"]);
  await expect(menu.getByRole("menuitem", { name: "指標說明" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "資料說明" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await menu.getByRole("menuitem", { name: "設定" }).click();
  await expect(page.locator("#info-dialog")).toBeVisible();
  await expect(page.locator("#dialog-heading")).toHaveText("設定");
  await expect(menu).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("desktop sidebar keeps guides and settings without the menu", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(page.locator('.sidebar nav [data-dialog="methodology"]')).toBeVisible();
  await expect(page.locator('.sidebar-bottom > [data-dialog="settings"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "更多選單" })).toBeHidden();
});
