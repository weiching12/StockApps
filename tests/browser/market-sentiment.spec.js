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
      const layout = await card.locator(".sentiment-card").evaluate((button) => {
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
        // Wide cards put either style on the right; only the narrow scale runs above the breadth line.
        ...(style === "gauge" || width >= 760 ? { breadthLeftOfGauge: true } : { scaleAboveBreadth: true }) });
      if (width <= 390) expect((await card.boundingBox()).height).toBeLessThan(220);
    }
  });
}

test("the needle and number sweep up from zero on entry, slowing as they settle", async ({ page }) => {
  // Sampling starts with the page, so the first frames of the sweep are never missed.
  await page.addInitScript(() => {
    window.moodSamples = [];
    const read = (now) => {
      const card = document.querySelector("#market-sentiment");
      const needle = parseFloat(card?.style.getPropertyValue("--sentiment-needle"));
      if (Number.isFinite(needle)) window.moodSamples.push({ now, needle, text: card.querySelector(".sentiment-score").textContent });
      requestAnimationFrame(read);
    };
    requestAnimationFrame(read);
  });
  await page.goto("/");
  await expect(page.locator("#market-sentiment .sentiment-arc")).toBeVisible();
  await page.waitForFunction(() => window.moodSamples.at(-1)?.needle === 0 && window.moodSamples.length > 10);
  const samples = await page.evaluate(() => window.moodSamples);
  const needles = samples.map(({ needle }) => needle), last = samples.at(-1);
  // Demo data settles on a score of 50, the needle pointing straight up.
  expect(last.text).toBe("50");
  expect(last.needle).toBe(0);
  expect(needles[0]).toBeLessThan(-30);
  expect(Number(samples[0].text)).toBeLessThan(35);
  needles.slice(1).forEach((needle, index) => expect(needle).toBeGreaterThanOrEqual(needles[index]));
  const halfway = samples.find(({ needle }) => needle >= needles[0] / 2), settled = samples.find(({ needle }) => needle === 0);
  expect(halfway.now - samples[0].now).toBeLessThan(settled.now - halfway.now);
});

test("returning to the market page replays the sweep, while scrolling away does not", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 });
  await page.goto("/");
  const score = page.locator("#market-sentiment .sentiment-score");
  await expect(score).toHaveText("50");
  await page.locator(".sidebar").getByRole("button", { name: "株研追蹤" }).click();
  await expect(page.locator("#market-sentiment")).toBeHidden();
  await page.addScriptTag({ content: `window.lowest = 100; (function read() { const value = Number(document.querySelector("#market-sentiment .sentiment-score").textContent); if (Number.isFinite(value) && document.querySelector("#market-sentiment").offsetWidth) window.lowest = Math.min(window.lowest, value); requestAnimationFrame(read); })();` });
  await page.locator(".sidebar").getByRole("button", { name: "市場觀察清單" }).click();
  await expect(page.locator("#market-sentiment")).toBeVisible();
  await expect(score).toHaveText("50");
  expect(await page.evaluate(() => window.lowest)).toBeLessThan(30);
  // Scrolling the card off and back leaves the settled score alone.
  await page.evaluate(() => { window.lowest = 100; document.querySelector("#stock-rows tr:last-child").scrollIntoView(); });
  await expect.poll(() => page.locator("#market-sentiment").evaluate((card) => card.getBoundingClientRect().bottom < 0)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.lowest)).toBe(50);
});

test("reduced motion shows the score straight away and the marker agrees", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const card = page.locator("#market-sentiment");
  await expect(card.locator(".sentiment-score")).toHaveText(/^\d+$/);
  const score = Number(await card.locator(".sentiment-score").textContent());
  expect(score).toBe(50);
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

test("the market mood card has no composition page to open", async ({ page }) => {
  await page.goto("/");
  const card = page.locator("#market-sentiment");
  await expect(card.locator(".sentiment-score")).toHaveText(/^\d+$/);
  await expect(card).not.toContainText("查看組成");
  await expect(card.locator("button, [data-dialog]")).toHaveCount(0);
  await card.locator(".sentiment-card").click();
  await expect(page.locator("#info-dialog")).not.toBeVisible();
});

test("on a wide card the larger gauge fills the right side, beside everything else", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto("/");
  await expect(page.locator("#market-sentiment .sentiment-fact").first()).toBeVisible();
  const layout = await page.locator("#market-sentiment .sentiment-card").evaluate((card) => {
    const box = (selector) => card.querySelector(selector).getBoundingClientRect();
    const meter = box(".sentiment-meter");
    return { arcWidth: box(".sentiment-arc").width, leftEnd: Math.max(box(".sentiment-heading").right, box(".sentiment-breadth").right, box(".sentiment-facts").right),
      meterLeft: meter.left, rightGap: card.getBoundingClientRect().right - meter.right, spansFacts: meter.top <= box(".sentiment-heading").top && meter.bottom >= box(".sentiment-facts").bottom };
  });
  expect(layout.arcWidth).toBeGreaterThanOrEqual(160);
  expect(layout.leftEnd).toBeLessThanOrEqual(layout.meterLeft);
  expect(layout.rightGap).toBeLessThan(40);
  expect(layout.spansFacts).toBe(true);
});
