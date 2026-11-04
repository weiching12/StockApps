import { test, expect } from "@playwright/test";

const seedStyle = (page, moodStyle) => page.addInitScript((style) => {
  const saved = JSON.parse(localStorage.getItem("stock-insight-v1") ?? "{}");
  localStorage.setItem("stock-insight-v1", JSON.stringify({ ...saved, moodStyle: style }));
}, moodStyle);

for (const style of ["gauge", "scale"]) {
  test(`the market mood card fits breadth and one row of institutional facts in the ${style} style`, async ({ page }) => {
    await seedStyle(page, style);
    for (const width of [320, 390, 760, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/");
      const card = page.locator("#market-sentiment");
      await expect(card.locator(".sentiment-date")).toHaveText(/^\d+ 檔上市個股$/);
      await expect(card.locator(".sentiment-score")).toHaveText(/^\d+$/);
      // One compact line: counts at the ends of a thin split bar.
      await expect(card.locator(".sentiment-breadth > span")).toHaveText([/^漲 \d+$/, /^跌 \d+$/]);
      await expect(card.locator(".sentiment-breadth-bar i")).toHaveCount(3);
      await expect(card.locator(".sentiment-breadth-bar")).toHaveAttribute("title", /^上漲 \d+、平盤 \d+、下跌 \d+ 檔$/);
      expect((await card.locator(".sentiment-breadth").boundingBox()).height).toBeLessThan(24);
      await expect(card.locator(".sentiment-arc")).toBeVisible({ visible: style === "gauge" });
      await expect(card.locator(".sentiment-scale")).toBeVisible({ visible: style === "scale" });
      await expect(card.locator('[data-fact="institutions"]')).toHaveText(/^法人淨買賣\s*[+-]?[\d,.]+ 億\s*(連[買賣] \d+ 日|買賣持平)$/);
      await expect(card.locator('[data-fact="inflow"]')).toHaveText(/^法人流入\s*\S+\s*\+[\d,.]+ 億$/);
      await expect(card.locator('[data-fact="outflow"]')).toHaveText(/^法人流出\s*\S+\s*-[\d,.]+ 億$/);
      // The longest values real data can show still stay inside their own cell.
      const layout = await card.locator("button").evaluate((button) => {
        button.querySelector('[data-fact="institutions"] strong').textContent = "-1,245.99 億";
        button.querySelector('[data-fact="institutions"] b').textContent = "連賣 12 日";
        button.querySelector('[data-fact="inflow"] b').textContent = "+1,246 億";
        button.querySelector('[data-fact="outflow"] b').textContent = "-1,246 億";
        const outer = button.getBoundingClientRect(), box = (selector) => button.querySelector(selector).getBoundingClientRect();
        const inside = (element, cell) => { const range = document.createRange(); range.selectNodeContents(element); const rect = range.getBoundingClientRect(); return rect.left >= cell.left - 1 && rect.right <= cell.right + 1; };
        const clipped = [...button.querySelectorAll(".sentiment-fact")].flatMap((cell) => [...cell.querySelectorAll("b")].filter((part) => !inside(part, cell.getBoundingClientRect())).map((part) => part.textContent));
        const tops = [...button.querySelectorAll(".sentiment-fact")].map((cell) => cell.getBoundingClientRect().top);
        return { clipped, oneRow: new Set(tops).size === 1, readoutInside: box(".sentiment-readout").right <= outer.right, breadthLeftOfGauge: box(".sentiment-breadth-bar").right <= box(".sentiment-meter").left,
          scaleAboveBreadth: box(".sentiment-scale").bottom <= box(".sentiment-breadth").top, factsInside: box(".sentiment-facts").bottom <= outer.bottom, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      expect(layout, `${width}px`).toMatchObject({ clipped: [], oneRow: true, readoutInside: true, factsInside: true, overflow: false,
        ...(style === "gauge" ? { breadthLeftOfGauge: true } : { scaleAboveBreadth: true }) });
      if (width <= 390) expect((await card.boundingBox()).height).toBeLessThan(220);
    }
  });
}

test("the gauge needle and scale marker both point at the score", async ({ page }) => {
  await page.goto("/");
  const card = page.locator("#market-sentiment");
  const score = Number(await card.locator(".sentiment-score").textContent());
  const styles = await card.evaluate((node) => ({ needle: node.style.getPropertyValue("--sentiment-needle"), marker: node.style.getPropertyValue("--sentiment-score") }));
  expect(styles.needle).toBe(`${(score - 50) * 1.8}deg`);
  expect(styles.marker).toBe(`${score}%`);
});

test("settings switches the mood style at once and remembers it", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto("/");
  const card = page.locator("#market-sentiment");
  await expect(card.locator(".sentiment-arc")).toBeVisible();
  await page.locator('.sidebar-bottom > [data-dialog="settings"]').click();
  const select = page.locator("#mood-style");
  await expect(select).toHaveValue("gauge");
  await expect(select.locator("option")).toHaveText(["半圓儀表", "橫向刻度"]);
  await select.selectOption("scale");
  await expect(card.locator(".sentiment-scale")).toBeVisible();
  await expect(card.locator(".sentiment-arc")).toBeHidden();
  await page.reload();
  await expect(card.locator(".sentiment-scale")).toBeVisible();
  await page.locator('.sidebar-bottom > [data-dialog="settings"]').click();
  await expect(page.locator("#mood-style")).toHaveValue("scale");
});

test("the market mood card still opens its composition dialog", async ({ page }) => {
  await page.goto("/");
  await page.locator("#market-sentiment button").click();
  await expect(page.locator("#info-dialog .sentiment-components > div")).toHaveCount(5);
  await expect(page.locator("#info-dialog .sentiment-trend polyline").first()).toBeVisible();
});
