import test from "node:test";
import assert from "node:assert/strict";
import { GATE_BADGE_LIMIT, researchListCells } from "../src/ui/entry-research.js";

const esc = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const keys = ["trend", "distribution", "extension", "institutional", "liquidity"];
const stock = (failed, gateStatus = failed ? "FAIL" : "PASS") => ({ symbol: "2317", name: "鴻海", entryResearch: {
  modelVersion: "entry-research-v2", gateStatus, status: "NOT_ELIGIBLE", nextDayStatus: "NOT_ELIGIBLE",
  gateConditions: Object.fromEntries(keys.map((key, index) => [key, index < failed ? "FAIL" : "PASS"])) } });
const gate = (failed, status) => researchListCells(stock(failed, status), esc, String).readiness;
const badges = (html) => [...html.matchAll(/<span class="research-gate-badge"[^>]*>([^<]*)<\/span>/g)].map((match) => match[1]);

test("up to three triggered vetoes are each named as a badge, with no 等 N 項", () => {
  assert.equal(GATE_BADGE_LIMIT, 3);
  assert.deepEqual(badges(gate(1)), ["趨勢遭破壞"]);
  assert.deepEqual(badges(gate(2)), ["趨勢遭破壞", "近期放量下跌"]);
  assert.deepEqual(badges(gate(3)), ["趨勢遭破壞", "近期放量下跌", "過度延伸"]);
  for (const failed of [1, 2, 3]) assert.doesNotMatch(gate(failed), /等/);
});

test("more than three are counted in one badge that still names them on hover", () => {
  assert.deepEqual(badges(gate(4)), ["共 4 項"]);
  assert.deepEqual(badges(gate(5)), ["共 5 項"]);
  assert.match(gate(5), /title="觸發：趨勢遭破壞、近期放量下跌、過度延伸、法人明顯賣壓、流動性不足"/);
});

test("pass, pending and a failure without named vetoes stay plain text", () => {
  assert.match(gate(0), />通過<\/small>/);
  assert.match(gate(0, "UNKNOWN"), />待確認<\/small>/);
  assert.match(researchListCells({ symbol: "1", name: "x", entryResearch: { modelVersion: "entry-research-v2", gateStatus: "FAIL", gateConditions: {} } }, esc, String).readiness, />未通過初步門檻<\/small>/);
  for (const html of [gate(0), gate(0, "UNKNOWN")]) assert.deepEqual(badges(html), []);
});
