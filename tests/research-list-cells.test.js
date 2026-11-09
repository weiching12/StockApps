import test from "node:test";
import assert from "node:assert/strict";
import { researchListCells } from "../src/ui/entry-research.js";

const esc = String, number = (value) => String(value);
const cell = (status, nextDayStatus, setupType = null) => researchListCells({ symbol: "2330", name: "台積電",
  entryResearch: { modelVersion: "entry-research-v3", score: 70, gateStatus: "PASS", status, nextDayStatus, setupType } }, esc, number).research;
const line = (html) => html.match(/<small[^>]*>(.*?)<\/small>/)?.[1] ?? null;

const chip = (html) => html.match(/<span class="research-chip ([a-z]+)">(.*?)<\/span>/)?.slice(1) ?? null;

test("a triggered signal's chip states whether the next session can be entered, never just 已觸發", () => {
  assert.deepEqual(chip(cell("TRIGGERED", "NEXT_DAY_CANDIDATE", "PULLBACK_RECOVERY")), ["positive", "明日可進場"]);
  assert.deepEqual(chip(cell("TRIGGERED", "PRICE_TOO_HIGH", "RANGE_BREAKOUT")), ["warning", "訊號觸發・不進場"]);
  assert.deepEqual(chip(cell("TRIGGERED", "DATA_INSUFFICIENT", "RANGE_BREAKOUT")), ["muted", "訊號觸發・資料不足"]);
  for (const next of ["NEXT_DAY_CANDIDATE", "PRICE_TOO_HIGH", "DATA_INSUFFICIENT"])
    assert.doesNotMatch(cell("TRIGGERED", next, "PULLBACK_RECOVERY"), /進場訊號已觸發/);
});

test("the line under a triggered chip names why it is held back and the pattern, with the full wording on hover", () => {
  assert.equal(line(cell("TRIGGERED", "NEXT_DAY_CANDIDATE", "PULLBACK_RECOVERY")), "回踩恢復");
  assert.equal(line(cell("TRIGGERED", "PRICE_TOO_HIGH", "RANGE_BREAKOUT")), "超出容許範圍 · 區間突破");
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
