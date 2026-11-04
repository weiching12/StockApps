import { test, expect } from "@playwright/test";

test("phone research cards keep readiness, gates and status inside each card in both themes", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.locator("#stock-rows .entry-score-button").first()).toBeVisible();
  // Longest labels the cells can show.
  const statuses = ["進場訊號已觸發", "未通過初步門檻", "訊號失效", "資料不足"];
  const nextDays = ["進場候選 · 區間突破", "價格過高 · 回踩恢復", "資料不足"];
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
    for (const width of [320, 360, 390, 430, 520, 700]) {
      await page.setViewportSize({ width, height: 844 });
      const problems = await page.locator("#stock-rows tr[data-symbol]").evaluateAll((rows, [statuses, nextDays]) => {
        const problems = [];
        const inside = (element, outer) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return [...range.getClientRects()].every((rect) => rect.left >= outer.left - 1 && rect.right <= outer.right + 1);
        };
        rows.slice(0, 6).forEach((row, index) => {
          const card = row.getBoundingClientRect();
          const button = row.querySelector(".research-score-button"), chip = row.querySelector(".research-chip"), next = row.querySelector(".research-next");
          button.querySelector("strong").textContent = "100";
          button.querySelector(".research-gate").textContent = "近期放量下跌 等 2 項";
          chip.textContent = statuses[index % statuses.length];
          if (next) next.textContent = nextDays[index % nextDays.length];
          const target = button.getBoundingClientRect();
          if (target.height < 44) problems.push(`${row.dataset.symbol}: touch target ${target.height}`);
          for (const element of [button, chip, next].filter(Boolean))
            if (!inside(element, card)) problems.push(`${row.dataset.symbol}: ${element.className} leaves the card`);
          if (chip.getBoundingClientRect().right > target.left + 1) problems.push(`${row.dataset.symbol}: status overlaps readiness`);
          const code = row.querySelector(".stock-name strong"), name = row.querySelector(".stock-name > span");
          const style = (element) => { const { fontSize, fontWeight, color } = getComputedStyle(element); return `${fontSize} ${fontWeight} ${color}`; };
          if (style(code) !== style(name)) problems.push(`${row.dataset.symbol}: name ${style(name)} differs from code ${style(code)}`);
          const close = row.querySelector(".stock-close").getBoundingClientRect(), change = row.querySelector(".mobile-change").getBoundingClientRect();
          if (Math.abs(close.top + close.height / 2 - (change.top + change.height / 2)) > 2) problems.push(`${row.dataset.symbol}: price and change on separate lines`);
          if (change.right > card.right + 1) problems.push(`${row.dataset.symbol}: change leaves the card`);
          if (row.querySelector(".stock-name").getBoundingClientRect().right > close.left + 1) problems.push(`${row.dataset.symbol}: name overlaps price`);
          if (getComputedStyle(row.querySelector(".price-volume-cell")).display !== "none") problems.push("indicator columns still shown");
          const extras = row.querySelector(".mobile-extras-scroll");
          if (!extras || extras.children.length !== 6) problems.push(`${row.dataset.symbol}: indicator chips missing`);
          else if (extras.getBoundingClientRect().right > card.right + 1) problems.push(`${row.dataset.symbol}: indicator chips leave the card`);
        });
        if (document.documentElement.scrollWidth > innerWidth) problems.push("page overflows");
        return problems;
      }, [statuses, nextDays]);
      expect(problems, `${theme} ${width}px`).toEqual([]);
      if (width === 390) {
        await page.locator(".table-scroll").scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`phone-research-${theme}.png`) });
      }
    }
  }
});
