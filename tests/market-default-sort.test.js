import assert from "node:assert/strict";
import test from "node:test";
import { compareResearchStocks, matchesResearchFilter } from "../src/ui/entry-research.js";

// A compact research summary as the market summary API returns it.
const stock = (symbol, { gate = "FAIL", passed = 4, score = null, status = "NOT_ELIGIBLE", next = "NOT_ELIGIBLE", setup = null } = {}) =>
  ({ symbol, entryResearch: { gateStatus: gate, gatePassed: passed, gateTotal: 5, score, status, nextDayStatus: next, setupType: setup } });

test("default market order groups candidates, other gate passes, price too high, then the rest", () => {
  const stocks = [
    stock("FAIL-4", { passed: 4 }), stock("HIGH", { gate: "PASS", passed: 5, score: 90, status: "TRIGGERED", next: "PRICE_TOO_HIGH" }),
    stock("WAIT-70", { gate: "PASS", passed: 5, score: 70, status: "WAIT_TRIGGER", next: "WAIT_TRIGGER" }),
    stock("CAND-60", { gate: "PASS", passed: 5, score: 60, status: "TRIGGERED", next: "NEXT_DAY_CANDIDATE" }),
    stock("CAND-80", { gate: "PASS", passed: 5, score: 80, status: "TRIGGERED", next: "NEXT_DAY_CANDIDATE" }),
    stock("WAIT-95", { gate: "PASS", passed: 5, score: 95, status: "WAIT_TRIGGER", next: "WAIT_TRIGGER" }),
    stock("UNKNOWN-4", { gate: "UNKNOWN", passed: 4, status: "DATA_INSUFFICIENT", next: "DATA_INSUFFICIENT" }),
    stock("FAIL-2", { passed: 2 }), { symbol: "NO-DATA" },
  ];
  assert.deepEqual(stocks.sort(compareResearchStocks).map(({ symbol }) => symbol),
    ["CAND-80", "CAND-60", "WAIT-95", "WAIT-70", "HIGH", "FAIL-4", "UNKNOWN-4", "FAIL-2", "NO-DATA"]);
});

test("a high-scoring waiting stock never outranks a next-day candidate", () => {
  const stocks = [stock("WAIT-99", { gate: "PASS", passed: 5, score: 99, status: "WAIT_TRIGGER", next: "WAIT_TRIGGER" }),
    stock("CAND-41", { gate: "PASS", passed: 5, score: 41, status: "TRIGGERED", next: "NEXT_DAY_CANDIDATE" })];
  assert.deepEqual(stocks.sort(compareResearchStocks).map(({ symbol }) => symbol), ["CAND-41", "WAIT-99"]);
});

test("research filters match the compact summary without treating UNKNOWN as a pass", () => {
  const candidate = stock("C", { gate: "PASS", passed: 5, score: 82, status: "TRIGGERED", next: "NEXT_DAY_CANDIDATE", setup: "RANGE_BREAKOUT" });
  const unknown = stock("U", { gate: "UNKNOWN", passed: 5, status: "DATA_INSUFFICIENT", next: "DATA_INSUFFICIENT" });
  assert.equal(matchesResearchFilter(candidate, "gatePass"), true);
  assert.equal(matchesResearchFilter(unknown, "gatePass"), false);
  assert.equal(matchesResearchFilter(candidate, "candidate"), true);
  assert.equal(matchesResearchFilter(candidate, "gateFail"), false);
  assert.equal(matchesResearchFilter(unknown, "gateFail"), false);
  assert.equal(matchesResearchFilter(stock("F"), "gateFail"), true);
  // The market menu's stages never overlap.
  const stages = ["candidate", "priceHigh", "waiting", "gateFail"];
  for (const each of [candidate, unknown, stock("F"), stock("H", { gate: "PASS", status: "TRIGGERED", next: "PRICE_TOO_HIGH" }),
    stock("W", { gate: "PASS", status: "WAIT_TRIGGER", next: "WAIT_TRIGGER" })])
    assert.ok(stages.filter((stage) => matchesResearchFilter(each, stage)).length <= 1, each.symbol);
  assert.equal(matchesResearchFilter({ symbol: "X" }, "triggered"), false);
  assert.equal(matchesResearchFilter({ symbol: "X" }, "all"), true);
});
