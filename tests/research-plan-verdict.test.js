import test from "node:test";
import assert from "node:assert/strict";
import { researchDialogSections } from "../src/ui/entry-research.js";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const number = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : "—";
const percent = (value) => `${value.toFixed(2)}%`;
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

// A triggered pullback whose stop sits 400.50 − 0.25 × 32.04 = 392.49 below a 460 reference price.
function result(plan) {
  return {
    modelVersion: "entry-research-v3", stockCode: "6957",
    gateResult: { status: "PASS", passedCount: 5, conditions: {}, details: {}, reasons: [] },
    dataQuality: { warnings: [] },
    entryResearch: {
      status: "TRIGGERED", label: "進場訊號已觸發", score: 95, setupLabel: "順勢回踩恢復",
      triggeredConditions: ["收盤重新站上 MA20"], pendingConditions: [], riskWarnings: [], setups: [],
      componentScores: { structure: 90, signal: 100, timing: 100 }, weights: { structure: 50, signal: 30, timing: 20 },
      signal: { setupType: "PULLBACK_RECOVERY", setupLabel: "順勢回踩恢復", status: "TRIGGERED", date: "2026-11-09",
        triggerPrice: 460, validSessions: 1, kdConfirmed: true, volumeConfirmed: true, rvol20: 1.2, checks: [],
        evidence: { pullbackDates: ["2026-11-05"], pullbackLow: 400.5, ma20: 430, previousHigh: 455 } },
    },
    nextDayPlan: { referenceClose: 460, entryReferencePrice: 460, entryPriceLower: null, entryPriceUpper: 476.02,
      invalidationPrice: 392.49, riskPercent: 14.68, maxRiskPercent: 17.55, atr14: 32.04,
      planAsOf: "2026-11-09", planExpiresAt: "2026-11-10", conditionsToConfirm: [], reasons: [], ...plan },
  };
}

test("a stop too far away says no entry and names the loss against the 8% limit", () => {
  const sections = researchDialogSections(result({ status: "PRICE_TOO_HIGH", label: "價格超出容許範圍" }), {}, { esc, number, percent });
  const card = text(sections.card), plan = text(sections.plan);
  assert.match(card, /11\/10 不進場/);
  assert.match(card, /依 11\/09 收盤/);
  assert.match(card, /停損距離太遠：以最高價 476\.02 買進、跌到停損價 392\.49 會虧損 17\.55%，超過單筆上限 8%/);
  assert.doesNotMatch(sections.card, /research-buy-range/);
  assert.match(sections.plan, /research-risk-check fail/);
  assert.match(plan, /以最高價買進的停損虧損 17\.55%/);
  assert.match(plan, /單筆虧損上限（標準） 8%/);
  assert.match(plan, /買入價需 ≤ 426\.62/);
  assert.match(plan, /回踩低點 400\.50 − 0\.25 × ATR14 32\.04 = 392\.49/);
  assert.match(plan, /參考買入價 460\.00 ＋ 0\.5 × ATR14 32\.04 = 476\.02/);
});

test("a close above the upper price says it is not chased", () => {
  const sections = researchDialogSections(result({ status: "PRICE_TOO_HIGH", label: "價格超出容許範圍", referenceClose: 480 }), {}, { esc, number, percent });
  assert.match(text(sections.card), /11\/09 收盤 480\.00 已高於可接受最高價 476\.02，不追價/);
});

test("a candidate shows the buy range first and passes the risk check", () => {
  const sections = researchDialogSections(result({ status: "NEXT_DAY_CANDIDATE", label: "明日進場候選",
    invalidationPrice: 440.5, riskPercent: 4.24, maxRiskPercent: 7.46 }), {}, { esc, number, percent });
  const card = text(sections.card);
  assert.match(card, /11\/10 可進場/);
  assert.match(card, /參考買入價 460\.00/);
  assert.match(card, /最高價 開盤上限 476\.02/);
  assert.match(card, /最低價 停損價 440\.50/);
  assert.match(card, /只看 11\/10 開盤價：高於 440\.50 且不高於 476\.02 才成立/);
  assert.match(sections.plan, /research-risk-check pass/);
  assert.doesNotMatch(text(sections.plan), /買入價需 ≤/);
});

test("without the next session in the calendar the wording falls back to 下一交易日", () => {
  const sections = researchDialogSections(result({ status: "WAIT_TRIGGER", label: "等待進場訊號", planExpiresAt: null,
    entryReferencePrice: null, entryPriceUpper: null, invalidationPrice: null, reasons: ["尚未出現有效進場訊號"] }), {}, { esc, number, percent });
  assert.match(text(sections.card), /下一交易日不進場/);
  assert.match(text(sections.plan), /尚未出現有效進場訊號/);
});
