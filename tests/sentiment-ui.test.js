import test from "node:test";
import assert from "node:assert/strict";
import { flowAmountText, netAmountText, sentimentTone, streakText } from "../src/ui/sentiment.js";

test("sector amounts drop decimals once large enough to crowd their cell", () => {
  assert.equal(flowAmountText(390000000), "+3.90 億");
  assert.equal(flowAmountText(-124599000000), "-1,246 億");
});

test("market amounts read in 億 and keep unknown as a dash", () => {
  assert.equal(netAmountText(1234567890), "+12.35 億");
  assert.equal(netAmountText(-50000000), "-0.50 億");
  assert.equal(netAmountText(0), "0.00 億");
  assert.equal(netAmountText(null), "—");
});

test("the institutional streak reads as days bought or sold in a row", () => {
  assert.equal(streakText(3), "連買 3 日");
  assert.equal(streakText(-2), "連賣 2 日");
  assert.equal(streakText(0), "買賣持平");
  assert.equal(streakText(null), "—");
});

test("market mood ring color follows the score and has an unknown fallback", () => {
  assert.equal(sentimentTone(0), "#3b82f6");
  assert.equal(sentimentTone(50), "#c49d69");
  assert.equal(sentimentTone(100), "#e86666");
  assert.notEqual(sentimentTone(49), sentimentTone(50));
  assert.notEqual(sentimentTone(50), sentimentTone(51));
  assert.equal(sentimentTone(null), "#64748b");
  assert.equal(sentimentTone(150), sentimentTone(100));
});
