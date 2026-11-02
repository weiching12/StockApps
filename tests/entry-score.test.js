import test from "node:test";
import assert from "node:assert/strict";
import { getSnapshot } from "../shared/indicators.js";
import { ENTRY_WEIGHTS, getQualifiedEntryScore, evaluateCoreConditions, getAtr14, getEntryScore, institutionalScoreBreakdown } from "../shared/entry-score.js";

import { MarketSummaryService } from "../cloudflare/services/market-summary-service.js";
import { AnalysisService } from "../cloudflare/services/analysis-service.js";
import { shardOf } from "../shared/market-codec.js";
import { referenceAdjustedDividendHistory } from "../shared/corporate-actions.js";

test("institutional score explanation uses the same capped components as the model", () => {
  assert.deepEqual(institutionalScoreBreakdown(2934000 / 42052054, 4, 3), {
    ratioScore: 100, ratioContribution: 60, dayContribution: 20,
    categoryContribution: 15, score: 95,
  });
});

function fixture(overrides = {}) {
  const dates = Array.from({ length: 75 }, (_, index) =>
    new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10));
  const bars = dates.map((date, index) => {
    const close = 80 + index * 0.25;
    return { date, open: close - 0.4, high: close + 1, low: close - 1, close,
      volume: 100000, institutions: ["外資", "投信", "自營商"].map((name) =>
        ({ name, buy: 10000, sell: 9000 })) };
  });
  overrides.mutate?.(bars);
  const stock = { symbol: "2330", name: "台積電", priceBasis: "adjusted", history: bars,
    tradingDates: dates };
  return { stock, dates, score: (date = dates.at(-1), options = {}) => {
    const snapshot = getSnapshot(stock, date, { period: 9, kSmooth: 3, dSmooth: 3 });
    return getEntryScore(snapshot, dates.filter((item) => item <= date), date, options);
  } };
}

test("official weights, complete model, fixed categories and score bounds", () => {
  const { score } = fixture();
  const result = score();
  assert.equal(Object.values(ENTRY_WEIGHTS).reduce((sum, value) => sum + value, 0), 100);
  assert.equal(result.modelVersion, "entry-score-v1.2");
  assert.equal(result.strategy, "swing-trend");
  assert.ok(result.totalScore >= 0 && result.totalScore <= 100);
  assert.equal(result.baseScore, Math.round(Object.entries(result.categories).reduce((sum, [key, item]) =>
    sum + item.score * ENTRY_WEIGHTS[key] / 100, 0) * 100) / 100);
  assert.equal(result.categories.trend.score, 100);
  assert.equal(result.categories.institutional.score, 88);
  assert.equal(result.categories.entryRisk.score, 82);
  assert.equal(result.coreConditionsPassed, true);
  assert.equal(result.finalScore, result.baseScore);
  assert.equal(result.passedCount, 5);
  assert.equal(Object.keys(result.categories).length, 5);
});

test("failed core conditions forfeit only their weighted points, with no 60 point cap", () => {
  const pass = Object.fromEntries(Object.keys(ENTRY_WEIGHTS).map((key) => [key, { status: "PASS" }]));
  const fail = (keys) => Object.fromEntries(Object.keys(pass).map((key) =>
    [key, { status: keys.includes(key) ? "FAIL" : "PASS" }]));
  const points = { trend: 25, momentum: 15, priceVolume: 15, institutional: 20, entryRisk: 20 };
  assert.deepEqual(getQualifiedEntryScore(95, pass, points), { finalScore: 95, qualifiedScore: 95 });
  for (const key of Object.keys(points)) {
    const result = getQualifiedEntryScore(95, fail([key]), points);
    assert.equal(result.qualifiedScore, 95 - points[key], `${key} must lose its own contribution`);
    assert.equal(result.finalScore, 95 - points[key]);
  }
  assert.deepEqual(getQualifiedEntryScore(95, fail(["trend"]), points), { finalScore: 70, qualifiedScore: 70 });
  assert.deepEqual(getQualifiedEntryScore(64.57, fail(["momentum"]),
    { trend: 25, momentum: 3, priceVolume: 2.25, institutional: 12.32, entryRisk: 22 }),
  { finalScore: 61.57, qualifiedScore: 61.57 });
  assert.deepEqual(getQualifiedEntryScore(70.5, fail(["trend"]),
    { trend: 18, momentum: 7.5, priceVolume: 6, institutional: 17, entryRisk: 22 }),
  { finalScore: 52.5, qualifiedScore: 52.5 });
  assert.equal(getQualifiedEntryScore(95, { ...pass, trend: { status: "UNKNOWN" } }, points).finalScore, null);
  assert.equal(getQualifiedEntryScore(95, pass, { ...points, trend: null }).finalScore, null);
});

test("five independent core gates report actual values and boundaries", () => {
  const data = { today: { close: 110, ma20: 100, ma60: 90, k: 60, d: 50, changePercent: -0.5 },
    previous: { ma20: 99, ma60: 89, k: 55 }, dayBefore: { k: 50 },
    completeHistory: true, rvol20: 2, institutionNet5: 0, previous10Low: 95, atr14: 2 };
  const good = evaluateCoreConditions(data);
  assert.deepEqual(Object.values(good).map((item) => item.status), ["PASS", "PASS", "PASS", "PASS", "PASS"]);
  assert.equal(good.institutional.data.institutionalNet5, 0);
  assert.equal(evaluateCoreConditions({ ...data, previous: { ...data.previous, ma60: 90 } }).trend.status, "FAIL");
  assert.equal(evaluateCoreConditions({ ...data, today: { ...data.today, k: 40 },
    previous: { ...data.previous, k: 45 } }).momentum.status, "FAIL");
  assert.equal(evaluateCoreConditions({ ...data, today: { ...data.today, changePercent: -0.51 } }).priceVolume.status, "FAIL");
  assert.equal(evaluateCoreConditions({ ...data, institutionNet5: -1 }).institutional.status, "FAIL");
  assert.equal(evaluateCoreConditions({ ...data, today: { ...data.today, close: 110.01 } }).entryRisk.status, "FAIL");
  assert.equal(evaluateCoreConditions({ ...data, institutionNet5: null }).institutional.status, "UNKNOWN");
});

test("Wilder ATR14 starts with 14 true ranges and rejects short history", () => {
  const { stock } = fixture();
  assert.equal(getAtr14(stock.history.slice(0, 14)), null);
  assert.equal(getAtr14(stock.history.slice(0, 15)), 2);
});

test("high RVOL with a price fall does not earn a high price-volume score", () => {
  const { score } = fixture({ mutate: (bars) => {
    const current = bars.at(-1);
    current.close = bars.at(-2).close * 0.97;
    current.open = current.close;
    current.high = current.close + 1;
    current.low = current.close - 1;
    current.volume = 300000;
  } });
  const result = score();
  assert.equal(result.categories.priceVolume.score, 0);
  assert.equal(result.metrics.priceVolume, "價跌量增");
});

test("all nine price-volume states use fixed V1 points including RVOL boundaries", () => {
  const cases = [
    [2, 1.2, "價漲量增", 100], [2, 0.8, "價漲量平", 70], [2, 0.79, "價漲量縮", 45],
    [-2, 1.2, "價跌量增", 0], [-2, 0.8, "價跌量平", 15], [-2, 0.79, "價跌量縮", 30],
    [0.5, 1.2, "量增價滯", 30], [-0.5, 0.8, "量價持平", 45], [0, 0.79, "量縮盤整", 40],
  ];
  for (const [change, ratio, label, points] of cases) {
    const { score } = fixture({ mutate: (bars) => {
      const current = bars.at(-1), previous = bars.at(-2);
      current.close = previous.close * (1 + change / 100);
      current.open = current.close;
      current.high = current.close + 1;
      current.low = current.close - 1;
      current.volume = 100000 * ratio;
    } });
    const result = score();
    assert.equal(result.metrics.priceVolume, label);
    assert.equal(result.categories.priceVolume.score, points);
  }
});

test("KD crossing alone cannot pass core trend conditions", () => {
  const { stock, dates } = fixture();
  const snapshot = getSnapshot(stock, dates.at(-1), { period: 9, kSmooth: 3, dSmooth: 3 });
  const current = snapshot.history.at(-1), previous = snapshot.history.at(-2);
  previous.k = 30; previous.d = 40;
  current.k = 50; current.d = 45;
  current.ma20 = current.close + 2;
  const result = getEntryScore(snapshot, dates, dates.at(-1));
  assert.equal(result.categories.momentum.score, 100);
  assert.equal(result.coreConditionsPassed, false);
  assert.equal(result.categories.trend.creditedContribution, 0);
  assert.equal(result.status, "核心條件不通過");
  assert.equal(result.qualifiedScore, Math.round((result.baseScore - result.categories.trend.contribution) * 100) / 100);
  assert.equal(result.finalScore, result.qualifiedScore);
  assert.ok(result.pendingConditions.some((item) => item.includes("MA20")));
});

test("institution net ratio clamps at plus or minus five percent without treating zero as missing", () => {
  const make = (net) => fixture({ mutate: (bars) => {
    for (const bar of bars.slice(-5)) bar.institutions = [
      { name: "外資", buy: net > 0 ? net : 0, sell: net < 0 ? -net : 0 },
      { name: "投信", buy: 0, sell: 0 }, { name: "自營商", buy: 0, sell: 0 },
    ];
  } }).score();
  assert.equal(make(10000).categories.institutional.score, 90);
  assert.equal(make(-10000).categories.institutional.score, 0);
  assert.equal(make(0).categories.institutional.score, 30);
});

test("trend gate stays separate from total and excessive MA20 deviation blocks it", () => {
  const { score } = fixture({ mutate: (bars) => {
    const current = bars.at(-1);
    current.close = 130;
    current.open = 129;
    current.high = 131;
    current.low = 128;
  } });
  const result = score();
  assert.ok(result.totalScore > 0);
  assert.equal(result.coreConditionsPassed, false);
  assert.equal(result.categories.entryRisk.score < 100, true);
  assert.ok(result.conflictingEvidence.some((item) => item.includes("10%")));
});

test("missing institution day, missing market date and short history never become zero score", () => {
  const missing = fixture({ mutate: (bars) => { bars.at(-2).institutions = []; } });
  assert.equal(missing.score().totalScore, null);
  const short = fixture();
  assert.equal(short.score(short.dates[40]).totalScore, null);
  const gap = fixture({ mutate: (bars) => { bars.splice(60, 1); } });
  assert.equal(gap.score().totalScore, null);
  const coveredGap = gap.score(gap.dates.at(-1), { corporateActions: {
    coveredDates: new Set(gap.dates), eventsBySymbol: new Map(),
  } });
  assert.equal(coveredGap.totalScore, null);
  assert.equal(coveredGap.conflictingEvidence.some((item) => item.includes("未還原價格")), false);
});

test("historical selection excludes future prices and reuses the same model result", () => {
  const { stock, dates, score } = fixture();
  const target = dates[69];
  const before = score(target);
  stock.history.at(-1).close *= 3;
  assert.deepEqual(score(target), before);
  const current = score();
  assert.notDeepEqual(current, before);
  assert.equal(before.asOf, target);
});

test("known unadjusted corporate action rejects score; unverified dates are stated", () => {
  const { stock, dates, score } = fixture();
  stock.priceBasis = "unadjusted";
  const actionDate = dates.at(-3);
  const options = { corporateActions: { coveredDates: new Set(dates.slice(-40)),
    eventsBySymbol: new Map([["2330", new Map([[actionDate, { kind: "息" }]])]]) } };
  const result = score(dates.at(-1), options);
  assert.equal(result.totalScore, null);
  assert.ok(result.missingData.some((item) => item.includes("公司行動")));
  const noEvent = score(dates.at(-1), { corporateActions: { ...options.corporateActions,
    eventsBySymbol: new Map() } });
  assert.ok(noEvent.conflictingEvidence.some((item) => item.includes("未還原價格")));
});

test("verified cash dividend uses official reference price and restores scoring", () => {
  const { stock, dates, score } = fixture();
  const date = dates.at(-30), previousClose = stock.history.at(-31).close;
  const actions = { coveredDates: new Set(dates), eventsBySymbol: new Map([[stock.symbol,
    new Map([[date, { kind: "息", beforeClose: previousClose, reference: previousClose - 2 }]])]]) };
  const raw = stock.history.map((bar) => ({ ...bar }));
  const result = score(dates.at(-1), { priceBasis: "unadjusted", corporateActions: actions });
  assert.ok(Number.isFinite(result.finalScore));
  assert.equal(result.priceBasis, "reference-adjusted");
  assert.ok(result.conflictingEvidence.some((text) => text.includes("除息參考價")));
  assert.deepEqual(stock.history, raw);
  const adjusted = referenceAdjustedDividendHistory(stock.history, actions.eventsBySymbol.get(stock.symbol));
  assert.equal(adjusted.at(-31).close, previousClose * (previousClose - 2) / previousClose);
  assert.equal(adjusted.at(-30).close, stock.history.at(-30).close);
  for (const event of [{ kind: "息", beforeClose: previousClose + 1, reference: previousClose - 2 },
    { kind: "減資", beforeClose: previousClose, reference: previousClose - 2 }]) {
    actions.eventsBySymbol.get(stock.symbol).set(date, event);
    const blocked = score(dates.at(-1), { priceBasis: "unadjusted", corporateActions: actions });
    assert.equal(blocked.finalScore, null);
    assert.ok(blocked.missingData.some((text) => text.includes("公司行動")));
  }
});

test("market Summary API and stock Analysis API return the same score on selected dates", async () => {
  const { stock, dates } = fixture();
  const metadata = { symbol: stock.symbol, name: stock.name, sector: "半導體", market: "上市",
    listedOn: dates[0], priceBasis: "adjusted" };
  const rows = stock.history.map((bar) => [bar.date, bar.open, bar.high, bar.low, bar.close, bar.volume,
    ...bar.institutions.flatMap((item) => [item.buy, item.sell])]);
  const manifest = { asOf: dates.at(-1), dates, generation: "entry-test", stocks: [metadata] };
  const market = { market: async () => manifest,
    stock: async () => ({ asOf: manifest.asOf, stock }),
    shards: async (_generation, indices) => indices.map((index) =>
      ({ generation: manifest.generation, index,
        stocks: index === shardOf(stock.symbol) ? [{ symbol: stock.symbol, history: rows }] : [] })) };
  const settings = { period: 9, kSmooth: 3, dSmooth: 3 };
  const summary = new MarketSummaryService(market);
  const analysis = new AnalysisService(market);
  for (const asOf of [dates[69], dates.at(-1)]) {
    const fromList = (await summary.summary(asOf, settings)).data.stocks[0].entryScore;
    const fromDetail = (await analysis.stock(stock.symbol, { asOf, settings })).data.entryScore;
    assert.equal(fromList.finalScore, fromDetail.finalScore);
    assert.equal(fromList.baseScore, fromDetail.baseScore);
    assert.equal(fromList.qualifiedScore, fromDetail.qualifiedScore);
    assert.equal(fromList.totalScore, fromDetail.totalScore);
    assert.equal(fromList.modelVersion, fromDetail.modelVersion);
    assert.equal(fromList.coreConditionsPassed, fromDetail.coreConditionsPassed);
    assert.equal(fromList.passedCount, fromDetail.passedCount);
    assert.deepEqual(fromList.missingData, fromDetail.missingData);
    // Condition reasons and evidence come only from the per-stock analysis resource.
    assert.equal("coreConditions" in fromList, false);
    assert.equal(Object.keys(fromDetail.coreConditions).length, 5);
    assert.ok(Object.keys(fromDetail.categories).length === 5);
  }
});
