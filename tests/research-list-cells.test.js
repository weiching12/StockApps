import test from "node:test";
import assert from "node:assert/strict";
import { researchListCells } from "../src/ui/entry-research.js";

const esc = String, number = (value) => String(value);
const cell = (status, nextDayStatus, setupType = null) => researchListCells({ symbol: "2330", name: "台積電",
  entryResearch: { modelVersion: "entry-research-v3", score: 70, gateStatus: "PASS", status, nextDayStatus, setupType } }, esc, number).research;
const line = (html) => html.match(/<small[^>]*>(.*?)<\/small>/)?.[1] ?? null;

test("a triggered signal shows a short next-day line with its setup and keeps the full wording on hover", () => {
  assert.equal(line(cell("TRIGGERED", "NEXT_DAY_CANDIDATE", "PULLBACK_RECOVERY")), "進場候選 · 回踩恢復");
  assert.equal(line(cell("TRIGGERED", "PRICE_TOO_HIGH", "RANGE_BREAKOUT")), "價格過高 · 區間突破");
  assert.equal(line(cell("TRIGGERED", "DATA_INSUFFICIENT", "RANGE_BREAKOUT")), "資料不足 · 區間突破");
  assert.match(cell("TRIGGERED", "PRICE_TOO_HIGH", "RANGE_BREAKOUT"), /title="價格超出容許範圍 · 整理區間向上突破"/);
});

test("statuses without a plan show only the chip, so an expired setup never reads as current", () => {
  for (const [status, next, setup] of [["WAIT_TRIGGER", "WAIT_TRIGGER", null], ["SIGNAL_EXPIRED", "WAIT_TRIGGER", "PULLBACK_RECOVERY"],
    ["SIGNAL_INVALIDATED", "PLAN_INVALIDATED", "RANGE_BREAKOUT"], ["DATA_INSUFFICIENT", "DATA_INSUFFICIENT", null], ["NOT_ELIGIBLE", "NOT_ELIGIBLE", null]]) {
    const html = cell(status, next, setup);
    assert.equal(line(html), null, status);
    assert.match(html, /research-chip/);
    assert.doesNotMatch(html, /明日|回踩恢復|區間突破/);
  }
});
