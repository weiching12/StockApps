import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyStock, defaultSubIndustry } from "../shared/custom-sectors.js";
import { SUB_INDUSTRIES } from "../shared/custom-sector-data.js";
import { MarketService } from "../cloudflare/services/market-service.js";
import { sectorMatches } from "../shared/sectors.js";
import { sectorFilterOptions, visibleSectors } from "../src/ui/sectors.js";

const source = JSON.parse(readFileSync("data/custom-sectors/custom_sectors.json", "utf8"));

test("the app's table matches the taxonomy data, every company once", () => {
  const generated = SUB_INDUSTRIES.flatMap(([, , codes]) => codes.split(" "));
  assert.equal(SUB_INDUSTRIES.length, 92);
  assert.equal(new Set(SUB_INDUSTRIES.map(([group]) => group)).size, 16);
  assert.equal(new Set(generated).size, generated.length);
  assert.deepEqual([...generated].sort(), Object.keys(source.companies).sort());
  for (const [symbol, company] of Object.entries(source.companies)) {
    const { sector, sectorGroup, twseSector } = classifyStock({ symbol, sector: "半導體業" });
    assert.deepEqual([sector, sectorGroup, twseSector], [company.subIndustry, company.sector, "半導體業"], symbol);
  }
});

test("a company outside the taxonomy falls back on its official industry and never fails", () => {
  assert.deepEqual(classifyStock({ symbol: "9999", sector: "半導體業" }),
    { symbol: "9999", sector: "IC設計", sectorGroup: "半導體", twseSector: "半導體業" });
  const unknown = classifyStock({ symbol: "9998", sector: "新產業別" });
  assert.equal(unknown.sector, "其他");
  assert.equal(unknown.sectorGroup, "綜合與其他");
  assert.equal(unknown.twseSector, "新產業別");
});

test("every official industry's default is a real sub-industry", () => {
  const subs = new Set(SUB_INDUSTRIES.map(([, sub]) => sub));
  const official = readFileSync("cloudflare/adapters/twse.js", "utf8").match(/const sectors = \{([\s\S]*?)\};/)[1];
  for (const [, name] of official.matchAll(/"\d+": "([^"]+)"/g)) {
    assert.ok(subs.has(defaultSubIndustry(name)), name);
    if (name !== "其他") assert.notEqual(defaultSubIndustry(name), "其他", `${name} has no default`);
  }
});

test("the ranking collapses to ten rows and the filter groups sub-industries under their sector", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({ name: String(index) }));
  assert.equal(visibleSectors(rows, false).length, 10);
  assert.equal(visibleSectors(rows, true).length, 12);
  const esc = (text) => text;
  const html = sectorFilterOptions(["2330", "2454", "0050", "9100"].map((symbol) => symbol === "0050"
    ? { symbol, sector: "ETF", assetType: "etf" } : classifyStock({ symbol, sector: "半導體業" })), esc);
  assert.match(html, /^<option value="all">全部產業<\/option><option value="ETF">ETF<\/option>/);
  const group = html.match(/<optgroup label="半導體">(.*?)<\/optgroup>/)[1];
  assert.match(group, /^<option value="半導體">全部半導體<\/option>/);
  assert.match(group, /<option value="IC設計">IC設計<\/option>/);
  assert.match(group, /<option value="晶圓代工">晶圓代工<\/option>/);
});

test("ETFs stay outside the taxonomy", () => {
  const etf = { symbol: "0050", sector: "ETF", assetType: "etf" };
  assert.equal(classifyStock(etf), etf);
});

test("the market service serves the taxonomy without touching the published manifest", async () => {
  const stocks = [{ symbol: "2330", name: "台積電", sector: "半導體業" }, { symbol: "0050", name: "元大台灣50", sector: "ETF", assetType: "etf" }];
  const manifest = { asOf: "2026-11-04", stocks };
  const service = new MarketService({ manifest: async () => manifest });
  const { stocks: [tsmc, etf] } = await service.market();
  assert.deepEqual([tsmc.sector, tsmc.sectorGroup, tsmc.twseSector], ["晶圓代工", "半導體", "半導體業"]);
  assert.equal(etf.sector, "ETF");
  assert.equal(stocks[0].sector, "半導體業");
  assert.ok(!sectorMatches(tsmc, "半導體"), "broader sectors are not a lookup name");
  for (const name of ["晶圓代工", "半導體業"]) {
    assert.ok(sectorMatches(tsmc, name), name);
    assert.deepEqual((await service.stocks({ offset: 0, limit: 5, sector: name })).data.map(({ symbol }) => symbol), ["2330"]);
  }
});
