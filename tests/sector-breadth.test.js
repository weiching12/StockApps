import test from "node:test";
import assert from "node:assert/strict";
import { breadthText } from "../src/ui/sectors.js";

test("breadth reads buying stocks over every stock in the sector", () => {
  assert.equal(breadthText({ buying: 2, available: 4, expected: 4 }), "買超 2／4 檔");
  // One stock has no data for the window: it is not buying, but it is still one of the sector's stocks.
  assert.equal(breadthText({ buying: 1, available: 3, expected: 4 }), "買超 1／4 檔");
  assert.equal(breadthText({ buying: 0, available: 3, expected: 4 }), "買超 0／4 檔");
});

test("breadth stays blank when no stock has usable data", () => {
  assert.equal(breadthText({ buying: 0, available: 0, expected: 4 }), "");
  assert.equal(breadthText(undefined), "");
});
