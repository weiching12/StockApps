import { test, expect } from "@playwright/test";

// The local market has no ETF, so a few listed stocks are presented as ETFs of different categories on the
// way to the page (manifest and summary), one of them without a price that day. Choosing a category must
// change the list right away (a cached list once ignored the choice until something else changed), and each
// chip's count must match what the list shows for it.
const CATEGORIES = ["domestic", "foreign", "leveraged", "leveraged", "other"];

function relabel(value, chosen, unpriced) {
  if (Array.isArray(value)) return value.map((item) => relabel(item, chosen, unpriced));
  if (!value || typeof value !== "object") return value;
  const copy = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, relabel(item, chosen, unpriced)]));
  const index = chosen.indexOf(copy.symbol);
  if (index >= 0 && "name" in copy) {
    Object.assign(copy, { sector: "ETF", assetType: "etf", currency: "TWD", entryResearch: null });
    if ("latest" in copy) copy.etfCategory = CATEGORIES[index];
    if (copy.symbol === unpriced && "latest" in copy) copy.latest = null;
  }
  return copy;
}

test("each ETF category narrows the list at once, and its count matches the list", async ({ page }) => {
  const listed = (await (await page.request.get("/api/v1/stocks?limit=6")).json()).data.map((stock) => stock.symbol);
  const chosen = listed.slice(0, CATEGORIES.length), unpriced = listed[CATEGORIES.length];
  // The unpriced one is a sixth ETF: in 其他 by type, but without a price it is in neither the list nor a count.
  chosen.push(unpriced); CATEGORIES.push("other");
  for (const pattern of ["**/api/v1/market", "**/api/v1/market/summary*"])
    await page.route(pattern, async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: relabel(await response.json(), chosen, unpriced) });
    });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => sessionStorage.setItem("stock-insight-current-page", "market"));
  await page.goto("/");
  await page.locator('[data-market-view-choice="etf"]').first().click();
  const chips = page.locator("#etf-category-chips button");
  await expect(chips).toHaveText(["全部5", "國內股票1", "國外股票1", "槓桿反向2", "其他1"]);
  const rows = page.locator("#stock-rows tr[data-symbol]");
  const expected = { all: chosen.slice(0, 5), domestic: [chosen[0]], foreign: [chosen[1]], leveraged: [chosen[2], chosen[3]], other: [chosen[4]] };
  for (const [key, symbols] of Object.entries(expected)) {
    await page.locator(`#etf-category-chips [data-etf-category="${key}"]`).click();
    await expect(page.locator(`#etf-category-chips [data-etf-category="${key}"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(rows, key).toHaveCount(symbols.length);
    expect((await rows.evaluateAll((nodes) => nodes.map((node) => node.dataset.symbol))).sort(), key).toEqual([...symbols].sort());
    await expect(page.locator("#table-summary"), key).toContainText(`${symbols.length} / ${symbols.length} 檔`);
  }
});
