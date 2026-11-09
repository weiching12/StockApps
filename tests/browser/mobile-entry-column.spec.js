import { test, expect } from "@playwright/test";

// This spec starts on the market list; the app itself opens on the home page.
test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

test("phone market cards keep their one status inside each card in both themes", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.locator("#stock-rows .research-chip").first()).toBeVisible();
  // Longest labels the cells can show.
  const statuses = ["訊號觸發・資料不足", "訊號觸發・不進場", "未通過初步門檻", "明日可進場"];
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
    for (const width of [320, 360, 390, 430, 520, 700]) {
      await page.setViewportSize({ width, height: 844 });
      const problems = await page.locator("#stock-rows tr[data-symbol]").evaluateAll((rows, [statuses]) => {
        const problems = [];
        const inside = (element, outer) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return [...range.getClientRects()].every((rect) => rect.left >= outer.left - 1 && rect.right <= outer.right + 1);
        };
        rows.slice(0, 6).forEach((row, index) => {
          const card = row.getBoundingClientRect();
          const chip = row.querySelector(".research-chip");
          chip.textContent = statuses[index % statuses.length];
          for (const selector of [".entry-cell", ".research-next"]) {
            const hidden = row.querySelector(selector);
            if (hidden && getComputedStyle(hidden).display !== "none") problems.push(`${row.dataset.symbol}: ${selector} still shown`);
          }
          if (!inside(chip, card)) problems.push(`${row.dataset.symbol}: status leaves the card`);
          // The status shares the name's line from 360px and drops below it on narrower phones.
          const status = chip.getBoundingClientRect(), stockName = row.querySelector(".stock-name").getBoundingClientRect();
          const middle = (rect) => rect.top + rect.height / 2;
          if (innerWidth >= 360 && Math.abs(middle(status) - middle(stockName)) > 12) problems.push(`${row.dataset.symbol}: status is not on the name's line`);
          if (status.left < stockName.right - 1 && status.top < stockName.bottom - 1) problems.push(`${row.dataset.symbol}: status overlaps the name`);
          const code = row.querySelector(".stock-name strong"), name = row.querySelector(".stock-name > span");
          const style = (element) => { const { fontSize, fontWeight, color } = getComputedStyle(element); return `${fontSize} ${fontWeight} ${color}`; };
          if (style(code) !== style(name)) problems.push(`${row.dataset.symbol}: name ${style(name)} differs from code ${style(code)}`);
          const close = row.querySelector(".stock-close").getBoundingClientRect(), change = row.querySelector(".mobile-change").getBoundingClientRect();
          if (Math.abs(close.top + close.height / 2 - (change.top + change.height / 2)) > 2) problems.push(`${row.dataset.symbol}: price and change on separate lines`);
          if (change.right > card.right + 1) problems.push(`${row.dataset.symbol}: change leaves the card`);
          // The price line sits under the code and name, starting at the same left edge.
          if (close.top < stockName.bottom - 1) problems.push(`${row.dataset.symbol}: price is not below the name`);
          if (Math.abs(close.left - stockName.left) > 1) problems.push(`${row.dataset.symbol}: price and name not left aligned`);
          if (innerWidth >= 360 && change.right > status.left + 1) problems.push(`${row.dataset.symbol}: price overlaps the status`);
          if (getComputedStyle(row.querySelector(".price-volume-cell")).display !== "none") problems.push("indicator columns still shown");
          const extras = row.querySelector(".mobile-extras-scroll");
          if (!extras || extras.children.length !== 6) problems.push(`${row.dataset.symbol}: indicator chips missing`);
          else if (extras.getBoundingClientRect().right > card.right + 1) problems.push(`${row.dataset.symbol}: indicator chips leave the card`);
        });
        if (document.documentElement.scrollWidth > innerWidth) problems.push("page overflows");
        return problems;
      }, [statuses]);
      expect(problems, `${theme} ${width}px`).toEqual([]);
      if (width === 390) {
        await page.locator(".table-scroll").scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`phone-research-${theme}.png`) });
      }
    }
  }
});
