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
      await expect(card.locator('[data-fact="flows"] .sentiment-row-label')).toHaveText("資金流向");
      await expect(card.locator('[data-fact="flows"] .sentiment-chip')).toHaveText([/^\S+ \+[\d,.]+ 億$/, /^\S+ -[\d,.]+ 億$/]);
      // The longest values real data can show still stay inside their own cell.
      const layout = await card.evaluate((button) => {
        button.querySelector('[data-fact="institutions"] strong').textContent = "-1,246 億";
        button.querySelector('[data-fact="institutions"] small').textContent = "連賣 12 日";
        const [inflow, outflow] = button.querySelectorAll('[data-fact="flows"] .sentiment-chip');
        inflow.innerHTML = '<i></i>ASIC設計服務與矽智財 <b>+1,246 億</b>';
        outflow.querySelector("b").textContent = "-1,246 億";
        const outer = button.getBoundingClientRect(), box = (selector) => button.querySelector(selector).getBoundingClientRect();
        const inside = (element, cell) => { const range = document.createRange(); range.selectNodeContents(element); const rect = range.getBoundingClientRect(); return rect.left >= cell.left - 1 && rect.right <= cell.right + 1; };
        const clipped = [...button.querySelectorAll(".sentiment-row")].flatMap((cell) => [...cell.querySelectorAll("strong, small, .sentiment-chip")].filter((part) => !inside(part, cell.getBoundingClientRect())).map((part) => part.textContent));
        // The amounts line up across the three cells.
        // Every row starts with its label at the same left edge.
        const tops = [...button.querySelectorAll(".sentiment-row-label")].map((label) => Math.round(label.getBoundingClientRect().left));
        return { clipped, oneRow: new Set(tops).size === 1, readoutInside: box(".sentiment-readout").right <= outer.right, breadthLeftOfGauge: box(".sentiment-breadth-bar").right <= box(".sentiment-meter").left,
          scaleAboveBreadth: box(".sentiment-scale").bottom <= box(".sentiment-breadth").top, factsInside: box(".sentiment-facts").bottom <= outer.bottom, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      expect(layout, `${width}px`).toMatchObject({ clipped: [], oneRow: true, readoutInside: true, factsInside: true, overflow: false,
        // Wide cards put either style on the right; only the narrow scale runs above the breadth line.
        // Wide screens stack the mood card's score above its line; narrow ones keep them side by side.
        ...(width >= 760 ? {} : style === "gauge" ? { breadthLeftOfGauge: true } : { scaleAboveBreadth: true }) });
      // Injected above: the longest sub-industry name wraps, the tallest a phone card gets.
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

test("returning to the home page replays the sweep, while scrolling away does not", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 });
  await page.goto("/");
  const score = page.locator("#market-sentiment .sentiment-score");
  await expect(score).toHaveText("50");
  await page.locator('.sidebar [data-page="favorites"]').click();
  await expect(page.locator("#market-sentiment")).toBeHidden();
  await page.addScriptTag({ content: `window.lowest = 100; (function read() { const value = Number(document.querySelector("#market-sentiment .sentiment-score").textContent); if (Number.isFinite(value) && document.querySelector("#market-sentiment").offsetWidth) window.lowest = Math.min(window.lowest, value); requestAnimationFrame(read); })();` });
  await page.locator('.sidebar [data-page="home"]').click();
  await expect(page.locator("#market-sentiment")).toBeVisible();
  await expect(score).toHaveText("50");
  expect(await page.evaluate(() => window.lowest)).toBeLessThan(30);
  // Scrolling the card off and back leaves the settled score alone.
  await page.evaluate(() => { window.lowest = 100; document.querySelector(".page-footer").style.marginTop = "2000px"; document.querySelector(".page-footer").scrollIntoView(); });
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
  await expect(card.locator("[data-dialog]")).toHaveCount(0);
  await card.locator(".sentiment-card").click();
  await expect(page.locator("#info-dialog")).not.toBeVisible();
});

test("the home page pairs the mood card on the left with the day's summary on the right, stacked on phones", async ({ page }) => {
  for (const [width, sideBySide] of [[1280, true], [900, true], [390, false]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.locator("#market-sentiment .sentiment-row").first()).toBeVisible();
    const layout = await page.locator("#market-sentiment").evaluate((section) => {
      const box = (selector) => section.querySelector(selector).getBoundingClientRect();
      const mood = box(".sentiment-card"), summary = box(".sentiment-summary");
      return { sideBySide: mood.right <= summary.left && Math.abs(mood.top - summary.top) < 1,
        stacked: summary.top >= mood.bottom, sameHeight: Math.abs(mood.height - summary.height) < 1,
        moodHolds: [".sentiment-heading", ".sentiment-meter", ".sentiment-breadth"].every((part) => section.querySelector(".sentiment-card").contains(section.querySelector(part))),
        summaryHolds: [".sentiment-facts", ".sentiment-unusual"].every((part) => section.querySelector(".sentiment-summary").contains(section.querySelector(part))),
        title: section.querySelector(".sentiment-summary h2").textContent, arcWidth: box(".sentiment-arc").width };
    });
    expect(layout.moodHolds && layout.summaryHolds, `${width}px`).toBe(true);
    expect(layout.title).toBe("今日盤後彙整");
    if (sideBySide) {
      expect(layout.sideBySide, `${width}px`).toBe(true);
      expect(layout.sameHeight, `${width}px`).toBe(true);
      expect(layout.arcWidth).toBeGreaterThanOrEqual(160);
    } else expect(layout.stacked, `${width}px`).toBe(true);
  }
});

test("unusual institutions show on the home card and open the stock", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const row = page.locator('#market-sentiment [data-fact="unusual"]');
  await expect(row.locator(".sentiment-row-label")).toHaveText("大戶異常");
  await expect(row.locator(".sentiment-row-label")).toHaveAttribute("title", /近 20 個交易日每日平均金額 2 倍以上/);
  const chips = row.locator(".sentiment-chip");
  if (!await chips.count()) {
    await expect(row.locator(".sentiment-row-none")).toHaveText("今日沒有明顯異常");
    return;
  }
  await expect(chips.first()).toHaveText(/^\S+ [+-][\d,.]+ 億平常 [\d,.]+ 倍$/);
  const symbol = await chips.first().getAttribute("data-entry-score");
  await chips.first().click();
  await expect(page.locator("#info-dialog #dialog-heading")).toContainText(symbol);
});

test("a flow pill opens that sub-industry's stocks", async ({ page }) => {
  await page.goto("/");
  const pill = page.locator('#market-sentiment [data-fact="flows"] .sentiment-chip').first();
  const name = await pill.getAttribute("data-sector-open");
  await pill.click();
  await expect(page.locator("#sector-dialog")).toBeVisible();
  await expect(page.locator("#sector-dialog-heading")).toHaveText(name);
});

test("quiet buying lists unusual buying the price did not follow", async ({ page }) => {
  await page.goto("/");
  const row = page.locator('#market-sentiment [data-fact="quiet-buying"]');
  await expect(row.locator(".sentiment-row-label")).toHaveText("買超未漲");
  await expect(row.locator(".sentiment-row-label")).toHaveAttribute("title", /股價收平或下跌/);
  const chips = row.locator(".sentiment-chip");
  const count = await chips.count();
  expect(count).toBeLessThanOrEqual(3);
  if (!count) return expect(row.locator(".sentiment-row-none")).toHaveText("今日沒有符合的個股");
  for (const chip of await chips.all()) await expect(chip).toHaveText(/^\S+ \+[\d,.]+ 億股價 (-[\d.]+|0\.00)%$/);
});
