import test from "node:test";
import assert from "node:assert/strict";
import { dataStatusText } from "../src/ui/topbar.js";
import { updatingDay } from "../src/update-countdown.js";

// 2026-11-18 is a Wednesday. Taipei is UTC+8.
const at = (iso) => new Date(iso);

test("while an update is due the bar counts down to it, as the home page does", () => {
  // 18:00 Taipei: thirty minutes to the 18:30 run.
  assert.deepEqual(dataStatusText({ asOf: "2026-11-17", updatedAt: "2026-11-17T12:40:00Z" }, at("2026-11-18T10:00:00Z")),
    { main: "資料日 2026/11/17", detail: "預計 18:30 更新 · 00:30:00" });
  // Saturday: the next run is Monday's.
  assert.match(dataStatusText({ asOf: "2026-11-20", updatedAt: "2026-11-20T12:40:00Z" }, at("2026-11-21T02:00:00Z")).detail, /^預計 18:30 更新 · \d{2}:\d{2}:\d{2}$/);
});

test("between the evening runs it says when the data was updated, with the date when it is not the trading day", () => {
  // 19:00 Taipei on the trading day, after the 18:30 run.
  assert.deepEqual(dataStatusText({ asOf: "2026-11-18", updatedAt: "2026-11-18T10:40:00Z" }, at("2026-11-18T11:00:00Z")),
    { main: "資料日 2026/11/18", detail: "18:40 更新" });
  // Data for 10/16 published on 10/18 reads as such (19:00 on Friday 10/16 is that day, so the date shows).
  assert.deepEqual(dataStatusText({ asOf: "2026-10-16", updatedAt: "2026-10-18T08:17:22Z" }, at("2026-10-16T11:00:00Z")),
    { main: "資料日 2026/10/16", detail: "10/18 16:17 更新" });
  assert.deepEqual(dataStatusText({ asOf: "2026-11-18", updatedAt: "not a date" }, at("2026-11-18T11:00:00Z")), { main: "資料日 2026/11/18", detail: "" });
});

test("loading, demo and missing data each read plainly", () => {
  assert.deepEqual(dataStatusText({ loading: true }), { main: "資料載入中", detail: "" });
  assert.deepEqual(dataStatusText({ demo: true, asOf: "2026-10-16" }), { main: "示範資料 · 2026/10/16", detail: "模擬行情，非交易所資料" });
  assert.deepEqual(dataStatusText({}), { main: "", detail: "" });
});

test("after 18:30 on a weekday, until that day's data is published, it says the update is under way", () => {
  // 18:40 Taipei on Wednesday 11-18 with Tuesday's data still on show.
  assert.deepEqual(dataStatusText({ asOf: "2026-11-17", updatedAt: "2026-11-17T10:40:00Z" }, at("2026-11-18T10:40:00Z")),
    { main: "資料日 2026/11/17", detail: "今日資料更新中" });
  // Once that day's data is on show, the update time returns.
  assert.equal(dataStatusText({ asOf: "2026-11-18", updatedAt: "2026-11-18T10:50:00Z" }, at("2026-11-18T11:00:00Z")).detail, "18:50 更新");
  // Before 18:30 and on weekends there is no run under way.
  assert.equal(updatingDay(at("2026-11-18T10:29:00Z")), null);
  assert.equal(updatingDay(at("2026-11-21T11:00:00Z")), null);
  assert.equal(updatingDay(at("2026-11-18T10:31:00Z")), "2026-11-18");
});
