import test from "node:test";
import assert from "node:assert/strict";
import { getInstitutionTurn } from "../shared/institution-turn.js";
import { getSnapshot } from "../shared/indicators.js";

const dates = Array.from({ length: 70 }, (_, index) => `2026-08-${String(index + 1).padStart(3, "0")}`);
const lots = (shares) => [{ name: "外資", buy: Math.max(shares, 0), sell: Math.max(-shares, 0) }, { name: "投信", buy: 0, sell: 0 }, { name: "自營商", buy: 0, sell: 0 }];

// Taiwan Glass around 2026-11-06: a long climb, a two-day sell-off with heavy institutional selling,
// then the institutions buy back while the close sits under the 60-day average.
function history({ todayNet = 4_440_000, sells = [-27_200_000, -36_800_000], todayClose = 57.8, volume = 87_000_000 } = {}) {
  return dates.map((date, index) => {
    const last = index === dates.length - 1, sellAt = dates.length - 1 - sells.length;
    const close = last ? todayClose : index >= sellAt ? 60.1 : index >= dates.length - 8 ? 66 : 55 + index * 0.12;
    const net = last ? todayNet : index >= sellAt ? sells[index - sellAt] : 1_000_000;
    return { date, open: close, high: close, low: close, close, volume: last ? volume : 20_000_000, institutions: lots(net) };
  });
}
const turnOf = (bars) => getSnapshot({ symbol: "1802", history: bars, tradingDates: dates }, dates.at(-1)).institutionTurn;

test("a buy after a selling run below the 60-day average and a 5-day fall is marked", () => {
  const turn = turnOf(history());
  assert.equal(turn.sellSessions, 2);
  assert.equal(turn.amount, Math.round(4_440_000 * 57.8));
  assert.equal(turn.soldAmount, Math.round((27_200_000 + 36_800_000) * 60.1));
  assert.ok(turn.valueShare >= 5 && turn.returnPercent <= -5);
});

test("each condition of the mark is required", () => {
  assert.equal(turnOf(history({ sells: [-27_200_000] })), null, "one selling session is not a run");
  assert.equal(turnOf(history({ todayNet: 800_000 })), null, "under NT$50M of net buying");
  assert.equal(turnOf(history({ volume: 1_000_000_000 })), null, "under 5% of the traded value");
  assert.equal(turnOf(history({ todayClose: 70 })), null, "above the 60-day average and not falling");
  assert.equal(turnOf(history({ todayNet: -4_440_000 })), null, "still selling");
});

test("a missing institution session ends the selling run instead of being skipped", () => {
  const bars = history({ sells: [-10_000_000, -27_200_000, -36_800_000] });
  assert.equal(turnOf(bars).sellSessions, 3);
  // Unknown flows on the second selling day leave a one-day run, which is not enough.
  bars[bars.length - 3].institutions = [];
  assert.equal(turnOf(bars), null);
});

test("no mark without trading dates to place the session", () => {
  assert.equal(getInstitutionTurn(history(), null, dates.at(-1)), null);
});
