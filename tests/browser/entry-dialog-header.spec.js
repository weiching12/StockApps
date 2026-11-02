import { test, expect } from "@playwright/test";

// The stock identity (sector, name, favorite, strategy date) stays pinned flush with the
// scroller's top edge while the score detail scrolls, on the phone sheet and desktop drawer.
for (const [label, viewport, scroller] of [["phone", { width: 390, height: 844 }, "#info-dialog"],
  ["tablet", { width: 768, height: 900 }, "#info-dialog"], ["desktop", { width: 1280, height: 800 }, "#dialog-content"]]) {
  test(`entry dialog header stays pinned while scrolling on ${label}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.locator("#stock-rows .entry-score-button").first().click();
    await expect(page.locator("#info-dialog .entry-summary")).toBeVisible();
    const header = page.locator("#info-dialog .entry-dialog-header");
    await expect(header.locator("h2")).toBeVisible();
    await expect(header.locator(".entry-dialog-meta")).toContainText("波段順勢進場");
    await page.waitForTimeout(300); // let the desktop drawer finish sliding in
    const layout = await page.locator(scroller).evaluate((node) => {
      node.scrollTop = node.scrollHeight;
      const box = node.getBoundingClientRect(), style = getComputedStyle(node);
      const head = document.querySelector("#info-dialog .entry-dialog-header").getBoundingClientRect();
      const inner = { top: box.top + parseFloat(style.borderTopWidth), left: box.left + parseFloat(style.borderLeftWidth) };
      const covered = document.elementFromPoint(head.left + head.width / 2, head.top + 4)?.closest(".entry-dialog-header");
      return { scrolled: node.scrollTop > 200, top: Math.round(head.top - inner.top), left: Math.round(head.left - inner.left),
        width: Math.round(head.width - node.clientWidth), onTop: Boolean(covered) };
    });
    expect(layout).toEqual({ scrolled: true, top: 0, left: 0, width: 0, onTop: true });
    // The favorite button still works while pinned.
    const favorite = header.locator("[data-favorite]");
    const pressed = await favorite.getAttribute("aria-pressed");
    await favorite.click();
    await expect(favorite).not.toHaveAttribute("aria-pressed", pressed);
  });
}
