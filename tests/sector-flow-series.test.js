import test from "node:test";
import assert from "node:assert/strict";
import { getSnapshot } from "../shared/indicators.js";
import { DIVERGENCE_MIN_PERCENT, getFlowStreak, getRunDivergence, getSectorDetail, getSectorFlowSeries, getSectorPriceSeries } from "../shared/sectors.js";

const dates = Array.from({ length: 25 }, (_, index) => `2026-09-${String(index + 1).padStart(2, "0")}`);
const rows = (nets) => ["外資", "投信", "自營商"].map((name, index) => ({ name,
  buy: Math.max(0, nets[index]), sell: Math.max(0, -nets[index]) }));
// Every session each stock's three institutions net `nets` shares at a close of 20.
const makeStock = (symbol, nets, { missing = null } = {}) => getSnapshot({ symbol, name: symbol, sector: "測試", tradingDates: dates,
  history: dates.filter((_, index) => index !== missing).map((date) => ({ date, open: 20, high: 21, low: 19, close: 20, volume: 1000, institutions: rows(nets) })),
}, dates.at(-1));

test("the flow series accumulates each institution's daily net amount over the last 20 sessions", () => {
  const flow = getSectorFlowSeries([makeStock("2001", [10, 5, 0]), makeStock("2002", [-4, 5, -1])], dates);
  assert.deepEqual(flow.dates, dates.slice(-20));
  assert.deepEqual([flow.available, flow.expected], [2, 2]);
  // 外資 +10 and -4 shares at 20 per session: +120 a day.
  assert.deepEqual(flow.lines.外資.slice(0, 3), [120, 240, 360]);
  assert.equal(flow.lines.外資.at(-1), 120 * 20);
  assert.equal(flow.lines.投信.at(-1), 200 * 20);
  assert.equal(flow.lines.自營商.at(-1), -20 * 20);
  assert.equal(flow.lines.total.at(-1), flow.lines.外資.at(-1) + flow.lines.投信.at(-1) + flow.lines.自營商.at(-1));
});

test("its last point equals the 20-day totals of the detail it comes with", () => {
  const stocks = [makeStock("2001", [10, 5, 0]), makeStock("2002", [-4, 5, -1])];
  const detail = getSectorDetail(stocks, "測試", { tradingDates: dates, asOf: dates.at(-1) });
  assert.equal(detail.flow.lines.total.at(-1), detail.periods["20"].estimate.amount);
  for (const name of ["外資", "投信", "自營商"])
    assert.equal(detail.flow.lines[name].at(-1), detail.periods["20"].institutions[name].amount, name);
});

test("a stock missing any of the 20 sessions stays out instead of counting as zero", () => {
  const whole = makeStock("2001", [10, 0, 0]), gap = makeStock("2002", [100, 0, 0], { missing: 10 });
  const flow = getSectorFlowSeries([whole, gap], dates);
  assert.deepEqual([flow.available, flow.expected], [1, 2]);
  assert.equal(flow.lines.外資.at(-1), 200 * 20);
  assert.equal(getSectorFlowSeries([gap], dates), null);
});

test("fewer than 20 sessions give no series", () => {
  assert.equal(getSectorFlowSeries([makeStock("2001", [1, 1, 1])], dates.slice(0, 19)), null);
});

test("the series keeps each session's own amount beside the running total", () => {
  const flow = getSectorFlowSeries([makeStock("2001", [10, -5, 0])], dates);
  assert.deepEqual(flow.daily.外資.slice(0, 2), [200, 200]);
  assert.deepEqual(flow.daily.投信.slice(0, 2), [-100, -100]);
  assert.equal(flow.daily.自營商.at(-1), 0);
});

test("a streak counts the latest run of one direction and says where it turned", () => {
  const days = ["d1", "d2", "d3", "d4", "d5"];
  assert.deepEqual(getFlowStreak([5, -1, -2, -3, -4], days), { direction: -1, length: 4, since: "d2", capped: false, turned: true });
  assert.deepEqual(getFlowStreak([0, 0, 3, 3, 3], days), { direction: 1, length: 3, since: "d3", capped: false, turned: false });
  assert.deepEqual(getFlowStreak([2, 2, 2, 2, 2], days), { direction: 1, length: 5, since: "d1", capped: true, turned: false });
  assert.deepEqual(getFlowStreak([4, 4, 4, 4, -1], days), { direction: -1, length: 1, since: "d5", capped: false, turned: true });
  assert.deepEqual(getFlowStreak([4, 4, 4, 4, 0], days), { direction: 0, length: 0, since: null, capped: false, turned: false });
});

test("the sector price line averages each stock's change from the close before the window", () => {
  const rising = getSnapshot({ symbol: "3001", name: "3001", sector: "測試", tradingDates: dates,
    history: dates.map((date, index) => ({ date, open: 1, high: 1, low: 1, close: 100 + index, volume: 1000, institutions: rows([0, 0, 0]) })) }, dates.at(-1));
  const flat = makeStock("3002", [0, 0, 0]);
  const price = getSectorPriceSeries([rising, flat], dates);
  assert.deepEqual(price.dates, dates.slice(-20));
  assert.equal(price.base, dates.at(-21));
  // Rising from 104 to 124 is +19.23%; the flat stock adds 0; the average halves it.
  assert.ok(Math.abs(price.returns.at(-1) - (124 / 104 - 1) * 100 / 2) < 1e-9);
  assert.equal(price.available, 2);
  const gap = makeStock("3003", [0, 0, 0], { missing: 4 });
  assert.equal(getSectorPriceSeries([gap], dates), null);
  assert.equal(getSectorPriceSeries([flat], dates.slice(0, 20)), null);
});

test("a run diverges only when it goes against the sector's price over the run's own sessions", () => {
  const days = ["d1", "d2", "d3", "d4", "d5"];
  const price = (returns) => ({ dates: days, returns });
  const selling = getFlowStreak([2, 2, -1, -1, -1], days);
  const buying = getFlowStreak([-2, -2, 1, 1, 1], days);
  // Selling since d3 while the price climbs from +1% (d2) to +4%: about +2.97% across the run.
  assert.ok(Math.abs(getRunDivergence(selling, days, price([0, 1, 2, 3, 4])).change - (1.04 / 1.01 - 1) * 100) < 1e-9);
  // Buying while it falls diverges too; selling into a falling price, or buying into a rising one, agrees.
  assert.ok(getRunDivergence(buying, days, price([0, 1, 0, -1, -2])).change < 0);
  assert.equal(getRunDivergence(selling, days, price([0, 1, 0, -1, -2])), null);
  assert.equal(getRunDivergence(buying, days, price([0, 1, 2, 3, 4])), null);
  // The price before the run does not count: it rose before d3 but fell across d3-d5.
  assert.equal(getRunDivergence(selling, days, price([5, 6, 6, 5, 4])), null);
  // A move under the threshold is noise.
  const flat = DIVERGENCE_MIN_PERCENT / 2;
  assert.equal(getRunDivergence(selling, days, price([0, 0, 0, flat, flat])), null);
});

test("a run measured from the window's start uses the whole price change, and unmatched sessions give none", () => {
  const days = ["d1", "d2", "d3"];
  const capped = getFlowStreak([-1, -1, -1], days);
  assert.ok(Math.abs(getRunDivergence(capped, days, { dates: days, returns: [1, 2, 3] }).change - 3) < 1e-9);
  assert.equal(getRunDivergence(capped, days, null), null);
  assert.equal(getRunDivergence(capped, days, { dates: ["d1", "d2", "dx"], returns: [1, 2, 3] }), null);
  assert.equal(getRunDivergence(getFlowStreak([1, 0, 0], days), days, { dates: days, returns: [1, 2, 3] }), null);
});
