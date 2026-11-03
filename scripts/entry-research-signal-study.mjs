// Offline study of the entry signal's validity window and of whether stage 1 vetoes during that
// window should cancel the signal. Signals are evaluated with a 5-session window so later days can be
// measured; each next-day candidate is then filtered by validity (days 1–5 after the trigger, the
// trigger day being day 1) and by gate rule:
//   A  the gates pass on the evaluated day (current rule)
//   C  A, and the gates also passed on the trigger day
//   D  A, and the gates passed on every day after the trigger up to the evaluated day
//   CD A, and the gates passed on every day from the trigger day on
// Outcomes are simulated next-open fills, net of costs, counted only once their holding window has passed.
//
//   node scripts/entry-research-signal-study.mjs --actions <dir> --out <report.md> [--origin URL] [--cache file.json]
import { writeFile } from "node:fs/promises";
import { analyzeHistory, DEFAULT_SETTINGS } from "../shared/indicators.js";
import { getEntryScore } from "../shared/entry-score.js";
import { evaluateEntryResearch } from "../shared/entry-research.js";
import { evaluateResearchOutcome } from "../shared/entry-research-outcome.js";
import { ENTRY_RESEARCH_MODEL_V2 } from "../shared/entry-research-model.js";
import { cliArgs, DEFAULT_ORIGIN, loadActions, loadDataset } from "./lib/research-history.mjs";

const args = cliArgs();
const origin = args.origin ?? DEFAULT_ORIGIN;
if (!args.actions || !args.out) throw new Error("Usage: --actions <dir> --out <report.md> [--origin URL] [--cache file]");

const MAX_DAYS = 5, HORIZONS = [5, 10];
const model = { ...ENTRY_RESEARCH_MODEL_V2, signal: { ...ENTRY_RESEARCH_MODEL_V2.signal, validSessions: MAX_DAYS } };
const dataset = await loadDataset(origin, args.cache);
const actions = await loadActions(args.actions);
const dates = dataset.dates;
// v2's G1 needs 80 sessions; earlier gate results are UNKNOWN, so only signals from then on are studied.
const firstIndex = 79;
const lastIndex = dates.length - 1;
const candidates = [];
const started = Date.now();
for (const [position, raw] of dataset.stocks.entries()) {
  const stock = { ...raw, history: analyzeHistory(raw.history, DEFAULT_SETTINGS) };
  const gateOn = new Map();
  const rows = [];
  for (let index = firstIndex; index <= lastIndex; index++) {
    const asOf = dates[index];
    if (!stock.history.some((bar) => bar.date === asOf)) { gateOn.set(asOf, "NO_BAR"); continue; }
    const score = getEntryScore(stock, dates, asOf, { priceBasis: "unadjusted", corporateActions: actions, settings: DEFAULT_SETTINGS });
    const result = evaluateEntryResearch({ stock, tradingDates: dates, asOf, corporateActions: actions, settings: DEFAULT_SETTINGS,
      score, model, researchAllStocks: true });
    gateOn.set(asOf, result.gateResult.status);
    rows.push({ asOf, index, result });
  }
  for (const { asOf, index, result } of rows) {
    const signal = result.entryResearch.signal, plan = result.nextDayPlan;
    if (result.entryResearch.status !== "TRIGGERED" || plan.status !== "NEXT_DAY_CANDIDATE" || signal.date < dates[firstIndex]) continue;
    const signalIndex = dates.indexOf(signal.date);
    const window = dates.slice(signalIndex, index + 1).map((date) => gateOn.get(date));
    const outcome = evaluateResearchOutcome({ symbol: stock.symbol, tradeDate: asOf, referenceClose: plan.referenceClose, nextDayPlan: plan },
      { tradingDates: dates, history: stock.history, corporateActions: actions });
    candidates.push({
      symbol: stock.symbol, asOf, day: index - signalIndex + 1, setup: signal.setupType,
      gateToday: window.at(-1), gateOnSignal: window[0], gatesAfterSignal: window.slice(1), fill: outcome.trade?.status,
      trade: Object.fromEntries(HORIZONS.map((days) => [days, index + 1 + days <= lastIndex &&
        outcome.trade?.exits?.[days]?.status === "COMPLETE" ? outcome.trade.exits[days].netReturnPercent : null])),
    });
  }
  if ((position + 1) % 300 === 0) console.error(`${position + 1}/${dataset.stocks.length} stocks, ${Math.round((Date.now() - started) / 1000)}s`);
}

const RULES = {
  A: (row) => row.gateToday === "PASS",
  C: (row) => row.gateToday === "PASS" && row.gateOnSignal === "PASS",
  D: (row) => row.gateToday === "PASS" && row.gatesAfterSignal.every((status) => status === "PASS"),
  CD: (row) => row.gateToday === "PASS" && row.gateOnSignal === "PASS" && row.gatesAfterSignal.every((status) => status === "PASS"),
};
const RULE_LABELS = { A: "A 只看當日門檻（現行）", C: "C 觸發日也須通過", D: "D 觸發後每日皆須通過", CD: "C＋D 觸發日起每日皆須通過" };
const stats = (values) => {
  const list = values.filter(Number.isFinite);
  if (!list.length) return "—";
  const mean = list.reduce((sum, value) => sum + value, 0) / list.length;
  return `${mean > 0 ? "+" : ""}${mean.toFixed(2)}%（勝 ${(list.filter((value) => value > 0).length / list.length * 100).toFixed(0)}%，n=${list.length}）`;
};
const sessions = lastIndex - firstIndex + 1;
const fillRate = (rows) => rows.length ? `${(rows.filter((row) => row.fill === "FILLED").length / rows.length * 100).toFixed(0)}%` : "—";
const lines = [];
const push = (...text) => lines.push(...text);

push("# 進場訊號效期與初步門檻規則研究", "",
  `產生時間：${new Date().toISOString()}；資料來源：${origin} 公開市場快照（${dataset.info.generation}），公司行動為 D1 唯讀匯出。`,
  "重跑：`node scripts/entry-research-signal-study.mjs --actions <dir> --out <report.md>`（`<dir>` 與 entry-research-compare.mjs 相同）。",
  `期間：${dates[firstIndex]} ～ ${dates[lastIndex]}，共 ${sessions} 個交易日；只納入訊號日在期間內的明日候選，共 ${candidates.length} 筆（效期放寬為 ${MAX_DAYS} 日以便比較）。`, "",
  "訊號日為第 1 天。每筆候選以隔日開盤在價格計畫內模擬成交，持有 5／10 日後扣除成本計算淨報酬；未滿持有期不計。成交率為隔日開盤落在計畫範圍內的比例。", "",
  "## 1. 訊號第幾天成為候選（規則 A）", "",
  "| 訊號第幾天 | 候選筆數 | 隔日成交率 | 持有 5 日 | 持有 10 日 |", "|---|---|---|---|---|");
for (let day = 1; day <= MAX_DAYS; day++) {
  const rows = candidates.filter((row) => row.day === day && RULES.A(row));
  push(`| 第 ${day} 天 | ${rows.length} | ${fillRate(rows)} | ${stats(rows.map((row) => row.trade[5]))} | ${stats(rows.map((row) => row.trade[10]))} |`);
}

push("", "## 2. 效期天數 × 門檻規則", "", "效期 N 天＝只採用訊號第 1～N 天的候選。", "",
  "| 效期 | 規則 | 每日候選 | 持有 5 日 | 持有 10 日 |", "|---|---|---|---|---|");
for (let days = 1; days <= MAX_DAYS; days++) for (const [key, rule] of Object.entries(RULES)) {
  const rows = candidates.filter((row) => row.day <= days && rule(row));
  push(`| ${days} 天 | ${RULE_LABELS[key]} | ${(rows.length / sessions).toFixed(1)} | ${stats(rows.map((row) => row.trade[5]))} | ${stats(rows.map((row) => row.trade[10]))} |`);
}

const excluded = (key) => candidates.filter((row) => row.day <= 3 && RULES.A(row) && !RULES[key](row));
push("", "## 3. 被新規則排除的候選（效期 3 天，原本符合規則 A）", "",
  "這些候選在新規則下會被取消；表現越差，代表該規則越有排除價值。", "",
  "| 規則 | 被排除筆數 | 持有 5 日 | 持有 10 日 |", "|---|---|---|---|");
for (const key of ["C", "D", "CD"]) {
  const rows = excluded(key);
  push(`| ${RULE_LABELS[key]} | ${rows.length} | ${stats(rows.map((row) => row.trade[5]))} | ${stats(rows.map((row) => row.trade[10]))} |`);
}

push("", "## 限制", "",
  `- 期間只有 ${sessions} 個交易日，第 3 天以後與規則 C／D 排除的樣本都很少，只能看方向。`,
  "- 10 日持有需要訊號後 11 個交易日的行情，期間後段的候選尚無結果。",
  "- 名錄為目前上市公司；歷史資料為交易所更正後版本。", "");
await writeFile(args.out, lines.join("\n"));
console.error(`Wrote ${args.out}: ${candidates.length} candidates in ${Math.round((Date.now() - started) / 1000)}s`);
