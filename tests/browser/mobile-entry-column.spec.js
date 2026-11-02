import { test, expect } from "@playwright/test";

test("phone research cards keep readiness, gates and status inside each card in both themes", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.locator("#stock-rows .entry-score-button").first()).toBeVisible();
  // Longest labels the cells can show.
  const statuses = ["進場訊號已觸發", "未通過五大門檻", "訊號失效", "資料不足"];
  const nextDays = ["明日進場候選 · 整理區間向上突破", "明日：價格超出容許範圍 · 順勢回踩恢復", "明日：尚無進場計畫"];
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
          button.querySelector(".research-gate").textContent = "門檻 4/5 待確認";
          chip.textContent = statuses[index % statuses.length];
          if (next) next.textContent = nextDays[index % nextDays.length];
          const target = button.getBoundingClientRect();
          if (target.height < 44) problems.push(`${row.dataset.symbol}: touch target ${target.height}`);
          for (const element of [button, chip, next].filter(Boolean))
            if (!inside(element, card)) problems.push(`${row.dataset.symbol}: ${element.className} leaves the card`);
          if (chip.getBoundingClientRect().right > target.left + 1) problems.push(`${row.dataset.symbol}: status overlaps readiness`);
          if (getComputedStyle(row.querySelector(".price-volume-cell")).display !== "none") problems.push("indicator columns still shown");
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
