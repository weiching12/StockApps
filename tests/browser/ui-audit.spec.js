import { test, expect } from "@playwright/test";
import { demoProvider } from "../../src/data.js";

// This spec starts on the market list; the app itself opens on the home page.
test.beforeEach(({ page }) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem("stock-insight-current-page")) sessionStorage.setItem("stock-insight-current-page", "market"); } catch { /* about:blank */ }
}));

async function loadMarket(page, count = 150, initialCount = 30) {
  await page.route("**/src/provider.js*", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `import { demoProvider } from "/src/data.js";
      export async function loadMarketSummary() { throw new Error("API loading is unavailable in this demo fixture"); }
      export async function loadDataset() {
        const data = await demoProvider.load();
        data.stocks = Array.from({ length: ${count} }, (_, index) => {
          const stock = structuredClone(data.stocks[index % data.stocks.length]);
          return { ...stock, symbol: String(1000 + index), name: "測試股票" + index };
        });
        return data;
      }`,
  }));
  await page.goto("/");
  if (initialCount) await expect(page.locator("#stock-rows tr")).toHaveCount(initialCount);
}

test("market batches remain reachable and reset correctly after a large filtered list", async ({ page }) => {
  await loadMarket(page);
  for (const count of [60, 90, 120, 150]) {
    await page.locator("#table-load-trigger").scrollIntoViewIfNeeded();
    await expect(page.locator("#stock-rows tr")).toHaveCount(count);
  }
  await expect(page.locator("#table-load-trigger")).toBeHidden();
});

test("batch loading fills a tall viewport until the trigger moves below it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 5000 });
  await loadMarket(page, 150, null);
  await expect.poll(() => page.locator("#stock-rows tr").count()).toBeGreaterThan(30);
  await expect.poll(() => page.locator("#table-load-trigger").evaluate((node) =>
    node.hidden || node.getBoundingClientRect().top > window.innerHeight)).toBe(true);
});

test("phone filter labels fit inside every button", async ({ page }) => {
  await page.goto("/");
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const clipped = await page.locator(".filter-tabs button").evaluateAll((buttons) => buttons.flatMap((button) => {
      const range = document.createRange();
      range.selectNodeContents(button);
      const text = range.getBoundingClientRect(), rect = button.getBoundingClientRect();
      return text.left < rect.left || text.right > rect.right ? [button.textContent] : [];
    }));
    expect(clipped, `Filter text at ${width}px`).toEqual([]);
  }
});

test("market filters and empty results keep page and column widths stable with native scrollbars", async ({ playwright }, testInfo) => {
  // Playwright normally hides classic scrollbars, masking their 15px layout shift.
  const browser = await playwright.chromium.launch({
    ...testInfo.project.use.launchOptions,
    ignoreDefaultArgs: ["--hide-scrollbars"],
  });
  const page = await browser.newPage({ baseURL: testInfo.project.use.baseURL, reducedMotion: "reduce" });
  await page.addInitScript(() => sessionStorage.setItem("stock-insight-current-page", "market"));
  const measure = () => page.evaluate(() => {
    const bounds = element => {
      const rect = element.getBoundingClientRect();
      return [rect.left, rect.width];
    };
    return {
      areas: ["#main", ".stocks-panel", ".table-toolbar", ".filter-tabs", ".table-scroll table"].map(selector => bounds(document.querySelector(selector))),
      columns: [...document.querySelectorAll('.table-scroll thead th')].map(bounds),
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  try {
    await page.goto("/");
    for (const width of [320, 360, 390, 520, 600, 700, 701, 768, 900, 1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator('[data-view="all"]').click();
      const original = await measure();
      if (width > 700) {
        const widths = await page.locator(".table-scroll").evaluate((table) => ({
          stock: table.querySelector(".stock-column").getBoundingClientRect().width,
          signal: table.querySelector(".signal-column").getBoundingClientRect().width,
        }));
        expect(widths.signal, 'Technical descriptions need their minimum readable width').toBeGreaterThanOrEqual(220);
      }
      const check = async state => {
        const current = await measure();
        expect(current.overflow, `${width}px / ${state}: page overflow`).toBe(false);
        for (const key of ["areas", "columns"])
          for (let index = 0; index < current[key].length; index++)
            for (let axis = 0; axis < 2; axis++)
              expect(Math.abs(current[key][index][axis] - original[key][index][axis]), `${width}px / ${state}: ${key}[${index}]`).toBeLessThanOrEqual(0.5);
      };
      for (const view of ["oversold", "favorites", "above", "below", "all"]) {
        await page.locator(`[data-view="${view}"]`).click();
        await check(view);
      }
      await page.locator('[data-view="favorites"]').click();
      await page.evaluate(() => document.querySelectorAll('#stock-rows [data-favorite][aria-pressed="true"]').forEach((star) => star.click()));
      await expect(page.locator('#table-empty')).toBeVisible();
      await check('empty results');
      await page.locator('[data-view="all"]').click();
      await check('restored results');
    }
  } finally { await browser.close(); }
});

test("market prices and long names fit their cells on phones and desktops", async ({ page }) => {
  await page.route("**/src/provider.js*", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `import { demoProvider } from "/src/data.js";
      export async function loadMarketSummary() { throw new Error("API loading is unavailable in this demo fixture"); }
      export async function loadDataset() {
        const data = await demoProvider.load();
        for (const stock of data.stocks) {
          stock.name = "長名稱測試個股123ABC";
          stock.sector = "電腦及週邊設備業";
          for (const bar of stock.history)
            for (const key of ["open", "high", "low", "close"]) bar[key] *= 12;
        }
        return data;
      }`,
  }));
  await page.goto("/");
  for (const width of [320, 390, 700, 701, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const errors = await page.locator("#stock-rows .price-cell").evaluateAll((cells) => cells.flatMap((cell) => {
      const rect = cell.getBoundingClientRect();
      return [...cell.querySelectorAll(".stock-close, .mobile-change")].flatMap((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.width && (bounds.left < rect.left || bounds.right > rect.right)
          ? [cell.closest("tr").dataset.symbol + ": price spills outside cell"] : [];
      });
    }));
    expect(errors, `Price cell at ${width}px`).toEqual([]);
    const names = await page.locator('#stock-rows .stock-name').evaluateAll(elements => elements
      .filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.textContent));
    expect(names, `Stock names at ${width}px`).toEqual([]);
  }
});

test("phone sector identity stays compact while amounts and percentages align for every period", async ({ page }) => {
  await page.route("**/src/provider.js*", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `import { demoProvider } from "/src/data.js";
      export async function loadMarketSummary() { throw new Error("API loading is unavailable in this demo fixture"); }
      export async function loadDataset() {
        const data = await demoProvider.load();
        data.stocks.forEach((stock, index) => {
          stock.sector = ["電腦及週邊設備業", "電子零組件業", "半導體業"][index % 3];
          for (const bar of stock.history) for (const institution of bar.institutions) {
            institution.buy *= 100; institution.sell *= 100;
          }
        });
        return data;
      }`,
  }));
  await page.goto("/");
  await page.locator('[data-page="market"]').first().click();
  await page.locator('[data-market-view-choice="sectors"]').click();
  // 產業 (activity) omits the TOP1 line; 買超 keeps it between the name and the breadth.
  for (const sort of ["activity-desc", "net-desc"]) for (const width of [320, 360, 390, 700]) {
    await page.locator(`[data-sector-sort="${sort}"]`).click();
    await page.setViewportSize({ width, height: 844 });
    for (const period of ["day", "5", "20"]) {
      await page.locator(`[data-sector-window="${period}"]`).click();
      const issues = await page.locator("#sector-grid .sector-card").evaluateAll((cards, sort) => cards.flatMap((card) => {
        const name = card.querySelector(".sector-identity h3").getBoundingClientRect();
        const title = card.querySelector(".sector-title").getBoundingClientRect();
        const identity = card.querySelector(".sector-identity");
        const leader = card.querySelector(".sector-identity p");
        const note = leader ? leader.getBoundingClientRect() : name;
        const breadth = card.querySelector(".sector-breadth").getBoundingClientRect();
        const amount = card.querySelector(".sector-total strong");
        const change = card.querySelector(".sector-change");
        const textBounds = (element) => {
          const range = document.createRange(); range.selectNodeContents(element);
          return range.getBoundingClientRect();
        };
        const lots = textBounds(amount), percentage = textBounds(change), bounds = card.getBoundingClientRect();
        return [
          sort === "activity-desc" && leader && "產業 ordering still shows the TOP1 line",
          sort !== "activity-desc" && !leader && "net ordering lost the TOP1 line",
          leader && (note.top - title.bottom < 0 || note.top - title.bottom > 6) && "TOP1 does not follow the industry name compactly",
          // The breadth sits beside the name, wrapping right under it only when a long name fills the line.
          (breadth.bottom <= name.top || breadth.top - name.bottom > 4) && "breadth does not sit beside or right under the industry name",
          card.querySelector("[data-sector-lots]") && "the ranking still shows lots",
          identity.scrollWidth > identity.clientWidth + 1 && "industry information extends outside its column",
          Math.abs(lots.right - percentage.right) > 1 && "amount and percentage do not share the right edge",
          lots.left < name.right && "amount overlaps the sector name",
          lots.right > bounds.right && "amount extends outside the card",
        ].filter(Boolean).map((issue) => `${card.dataset.sectorName}: ${issue}`);
      }), sort);
      expect(issues, `Sector numbers at ${width}px / ${period} / ${sort}`).toEqual([]);
    }
  }
});

test("sector estimated billions follow each selected period's daily prices and net shares", async ({ page }) => {
  const data = await demoProvider.load();
  await page.goto("/");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-page="market"]').first().click();
  await page.locator('[data-market-view-choice="sectors"]').click();
  const sector = data.stocks[0].sector;
  const stocks = data.stocks.filter((stock) => stock.sector === sector);
  const estimate = page.locator(`[data-sector-name="${sector}"] [data-sector-amount]`);
  for (const [period, days] of [["day", 1], ["5", 5], ["20", 20]]) {
    const dates = data.dates.slice(-days);
    const total = stocks.reduce((sum, stock) => sum + stock.history.filter((bar) => dates.includes(bar.date))
      .reduce((value, bar) => value + bar.institutions.reduce((net, item) => net + item.buy - item.sell, 0) * bar.close, 0), 0);
    const billions = total / 100000000;
    await page.locator(`[data-sector-window="${period}"]`).click();
    await expect(estimate).toHaveText(`${billions > 0 ? "+" : ""}${billions.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 億`);
    await expect(estimate).toHaveCSS("font-size", "14px");
  }
  await expect(page.locator(".sector-note")).toHaveCount(0);
});

test("the phone list draws only the rows in view and reaches every stock", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await loadMarket(page, 150, 0);
  const table = page.locator(".table-scroll");
  await expect(page.locator("#stock-rows tr[data-symbol]").first()).toBeVisible();
  await expect(page.locator("#table-summary")).toContainText("150 / 150");
  const drawn = await page.locator("#stock-rows tr").count();
  expect(drawn).toBeLessThan(30);
  const check = () => table.evaluate((scroller) => {
    const rows = [...scroller.querySelectorAll("#stock-rows tr")].map((row) => row.getBoundingClientRect());
    return { rows: rows.length, gaps: rows.slice(1).filter((rect, index) => Math.abs(rect.top - rows[index].bottom) > 1).length,
      pageScroll: window.scrollY };
  });
  for (const top of [2000, 6000, 999999]) {
    await table.evaluate((scroller, value) => { scroller.scrollTop = value; }, top);
    await page.waitForTimeout(100);
    const state = await check();
    expect(state.rows).toBeLessThan(30);
    expect(state.gaps).toBe(0);
    expect(state.pageScroll).toBe(0);
  }
  await expect(page.locator('#stock-rows tr[data-symbol="1149"]')).toBeVisible();
  await page.locator('#stock-rows tr[data-symbol="1149"] .stock-name').click();
  await expect(page.locator("#dialog-heading")).toContainText("1149");
});
