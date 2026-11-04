import { test, expect } from "@playwright/test";

const rows = (page) => page.locator("#stock-rows tr[data-symbol]");
const chip = (page, value) => page.locator(`[data-research-chip="${value}"]`);

test("phone filters are search, one sideways chip row, then industry and sort", async ({ page }) => {
  for (const width of [320, 390, 700]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expect(rows(page).first()).toBeVisible();
    await expect(page.locator("#market-research-filter")).toBeHidden();
    const box = (selector) => page.locator(selector).boundingBox();
    const [search, tabs, sector, sort] = await Promise.all(["#stock-search", ".filter-tabs", "#sector-filter", "#market-sort"].map(box));
    expect(search.y, `${width}: search first`).toBeLessThan(tabs.y);
    expect(tabs.y + tabs.height, `${width}: chips above menus`).toBeLessThanOrEqual(sector.y + 1);
    expect(Math.abs(sector.y - sort.y), `${width}: menus share a row`).toBeLessThan(2);
    const layout = await page.locator(".filter-tabs").evaluate((row) => ({
      scrolls: row.scrollWidth > row.clientWidth,
      oneLine: new Set([...row.querySelectorAll("button")].map((button) => Math.round(button.getBoundingClientRect().top))).size === 1,
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
    }));
    expect(layout, `${width}px`).toEqual({ scrolls: true, oneLine: true, pageOverflow: false });
  }
});

test("phone chips filter, combine with a scope, toggle off and clear with 全部", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(rows(page).first()).toBeVisible();
  const total = await page.locator("#table-summary").textContent();
  const passed = chip(page, "gatePass");
  await passed.click();
  await expect(passed).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#market-research-filter")).toHaveValue("gatePass");
  await expect(page.locator("#table-summary")).not.toHaveText(total);
  const only = await page.locator("#table-summary").textContent();
  for (const row of await rows(page).all()) await expect(row.locator(".research-gate")).toHaveText("初步門檻通過");
  // A scope chip and a research chip apply together.
  await page.locator('[data-view="favorites"]').click();
  await expect(passed).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-view="favorites"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#table-summary")).not.toHaveText(only);
  // Tapping an active chip clears only that chip.
  await page.locator('[data-view="favorites"]').click();
  await expect(page.locator('[data-view="all"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#table-summary")).toHaveText(only);
  // 全部 is not highlighted while a research chip narrows the list, and clears it.
  const allChip = page.locator('[data-view="all"]');
  await expect(allChip).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await allChip.click();
  await expect(passed).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#market-research-filter")).toHaveValue("all");
  await expect(page.locator("#table-summary")).toHaveText(total);
  await expect(allChip).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  // Only one research chip applies at a time, matching the desktop menu.
  await chip(page, "score60").click();
  await chip(page, "gatePass").click();
  await expect(chip(page, "score60")).toHaveAttribute("aria-pressed", "false");
  await expect(passed).toHaveAttribute("aria-pressed", "true");
});

test("desktop keeps its tabs and menu, and a menu choice cannot move the tab indicator", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(rows(page).first()).toBeVisible();
  await expect(page.locator(".filter-chip-research").first()).toBeHidden();
  await expect(page.locator("#market-research-filter")).toBeVisible();
  const above = page.locator('[data-view="above"]');
  await page.locator("#market-research-filter").selectOption("gatePass");
  await above.click();
  await expect(chip(page, "gatePass")).toHaveAttribute("aria-pressed", "true");
  const aligned = await page.locator(".filter-tabs").evaluate((group) => {
    const target = group.querySelector('[data-view="above"]').getBoundingClientRect();
    return Math.abs(parseFloat(group.style.getPropertyValue("--segment-width")) - target.width) < 1;
  });
  expect(aligned).toBe(true);
  // Desktop tabs stay a single choice: re-clicking does not clear, and 全部 keeps the menu.
  await above.click();
  await expect(above).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-view="all"]').click();
  await expect(page.locator("#market-research-filter")).toHaveValue("gatePass");
});
