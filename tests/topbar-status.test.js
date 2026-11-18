import test from "node:test";
import assert from "node:assert/strict";
import { dataStatusText } from "../src/ui/topbar.js";

test("the status names the trading day and when it was updated, in Taipei time", () => {
  assert.deepEqual(dataStatusText({ asOf: "2026-11-18", updatedAt: "2026-11-18T10:31:00Z" }), { main: "資料日 2026/11/18", detail: "18:31 更新" });
  assert.deepEqual(dataStatusText({ asOf: "2026-11-18", updatedAt: "2026-11-18T12:31:00Z" }), { main: "資料日 2026/11/18", detail: "20:31 更新" });
  // The next update is left to the home page's countdown, so the bar never repeats it.
  assert.doesNotMatch(JSON.stringify(dataStatusText({ asOf: "2026-11-18", updatedAt: "2026-11-18T12:31:00Z" })), /下次|預計/);
});

test("loading, demo and missing data each read plainly", () => {
  assert.deepEqual(dataStatusText({ loading: true }), { main: "資料載入中", detail: "" });
  assert.deepEqual(dataStatusText({ demo: true, asOf: "2026-10-16" }), { main: "示範資料 · 2026/10/16", detail: "模擬行情，非交易所資料" });
  assert.deepEqual(dataStatusText({}), { main: "", detail: "" });
  assert.deepEqual(dataStatusText({ asOf: "2026-11-18", updatedAt: "not a date" }), { main: "資料日 2026/11/18", detail: "" });
});
