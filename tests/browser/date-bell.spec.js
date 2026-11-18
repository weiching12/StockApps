import { test, expect } from "@playwright/test";

test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "home"); } catch { /* about:blank */ }
}));

// The bell only shows in API mode while update notifications are off; demo mode hides it, so it is shown here.
for (const width of [390, 768, 1024, 1280]) {
  test(`the update bell sits beside the trading-day menu, never on its arrow, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 860 });
    await page.goto("/");
    // The trading-day menu and the countdown live on the home page.
    for (const target of ["home"]) {
      await page.locator(`.nav-item[data-page="${target}"]`).first().click();
      const select = page.locator("#trade-date");
      await expect(select).toBeVisible();
      const placed = await page.evaluate(() => {
        const bell = document.querySelector(".date-notification-button"), countdown = document.querySelector("#update-countdown");
        bell.hidden = false;
        countdown.hidden = false;
        countdown.textContent = "預計 20:30 更新 · 00:41:12";
        const s = document.querySelector("#trade-date").getBoundingClientRect(), b = bell.getBoundingClientRect(), c = countdown.getBoundingClientRect();
        const overlaps = (x, y) => x.left < y.right - 0.5 && y.left < x.right - 0.5 && x.top < y.bottom - 0.5 && y.top < x.bottom - 0.5;
        return { bellOnMenu: overlaps(b, s), countdownOnMenu: overlaps(c, s), countdownOnBell: overlaps(c, b),
          onScreen: b.right <= document.documentElement.clientWidth && b.width > 0 };
      });
      expect(placed, `${target} at ${width}px`).toEqual({ bellOnMenu: false, countdownOnMenu: false, countdownOnBell: false, onScreen: true });
    }
  });
}
