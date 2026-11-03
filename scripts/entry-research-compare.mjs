// Offline comparison of entry research gate models on published history (docs/entry-research-gates-v2.md).
// Reads the public market snapshot API (no writes anywhere) plus a corporate-action export, then
// re-evaluates every stock on every session with enough history under v1, v2 and v2 sensitivity
// variants, and writes a Markdown report. Every evaluation uses only bars up to its session;
// outcomes read later bars only to measure what happened next.
//
//   node scripts/entry-research-compare.mjs --actions <dir> --out <report.md> [--origin URL] [--cache file.json]
//
// <dir> holds coverage.json ([{ Date, Status }]) and events.json ([{ Date, Symbol, Kind, BeforeClose,
// ReferencePrice }]) exported read-only from D1 (see the report header for the exact commands).
import { writeFile } from "node:fs/promises";
import { analyzeHistory, DEFAULT_SETTINGS } from "../shared/indicators.js";
import { getEntryScore } from "../shared/entry-score.js";
import { entryResearchGates, evaluateEntryResearch } from "../shared/entry-research.js";
import { evaluateResearchOutcome } from "../shared/entry-research-outcome.js";
import { ENTRY_RESEARCH_MODEL_V1, ENTRY_RESEARCH_MODEL_V2 } from "../shared/entry-research-model.js";
import { cliArgs, DEFAULT_ORIGIN, loadActions, loadDataset } from "./lib/research-history.mjs";

const args = cliArgs();
const origin = args.origin ?? DEFAULT_ORIGIN;
if (!args.actions || !args.out) throw new Error("Usage: --actions <dir> --out <report.md> [--origin URL] [--cache file]");

const variant = (label, gates) => ({ label, model: { ...ENTRY_RESEARCH_MODEL_V2, gates: { ...ENTRY_RESEARCH_MODEL_V2.gates, ...gates } } });
const VARIANTS = [
  variant("G1 季線斜率 10 日", { trendSlopeSessions: 10 }),
  variant("G2 回看 5 日", { distributionSessions: 5 }),
  variant("G2 回看 20 日", { distributionSessions: 20 }),
  variant("G3 延伸 2.5 ATR", { maxExtensionAtr: 2.5 }),
  variant("G3 延伸 4 ATR", { maxExtensionAtr: 4 }),
  variant("G4 法人 1 日", { institutionSessions: 1 }),
  variant("G4 法人 5 日", { institutionSessions: 5 }),
  variant("G4 賣超 3%", { institutionNetSellPercent: 3 }),
  variant("G4 賣超 10%", { institutionNetSellPercent: 10 }),
  variant("G5 500 萬元", { minTradingValue: 5_000_000 }),
  variant("G5 2,000 萬元", { minTradingValue: 20_000_000 }),
];
const HORIZONS = [5, 10, 20];

const dataset = await loadDataset(origin, args.cache);
const actions = await loadActions(args.actions);
const dates = dataset.dates;
// G1's 20-session MA60 slope needs 80 sessions; every model is compared on the same sessions.
const firstIndex = 79;
const sessions = dates.slice(firstIndex);
const samples = [];
const started = Date.now();
for (const [position, raw] of dataset.stocks.entries()) {
  const stock = { ...raw, history: analyzeHistory(raw.history, DEFAULT_SETTINGS) };
  for (const asOf of sessions) {
    if (!stock.history.some((bar) => bar.date === asOf)) continue;
    const common = { stock, tradingDates: dates, asOf, corporateActions: actions, settings: DEFAULT_SETTINGS };
    const score = getEntryScore(stock, dates, asOf, { priceBasis: "unadjusted", corporateActions: actions, settings: DEFAULT_SETTINGS });
    const v1 = evaluateEntryResearch({ ...common, score, model: ENTRY_RESEARCH_MODEL_V1, researchAllStocks: true });
    const v2 = evaluateEntryResearch({ ...common, score, model: ENTRY_RESEARCH_MODEL_V2, researchAllStocks: true });
    const plan = v2.nextDayPlan;
    const outcome = evaluateResearchOutcome({ symbol: stock.symbol, tradeDate: asOf, referenceClose: plan.referenceClose, nextDayPlan: plan },
      { tradingDates: dates, history: stock.history, corporateActions: actions });
    samples.push({
      symbol: stock.symbol, asOf, candidatePlan: plan.status === "NEXT_DAY_CANDIDATE",
      gates: { v1: v1.gateResult.status, v2: v2.gateResult.status,
        ...Object.fromEntries(VARIANTS.map(({ label, model }) => [label, entryResearchGates({ ...common, score, model }).status])) },
      v1Conditions: v1.gateResult.conditions, v2Conditions: v2.gateResult.conditions,
      readiness: { v1: v1.entryResearch.score, v2: v2.entryResearch.score },
      forward: Object.fromEntries(HORIZONS.map((days) => [days, outcome.horizons[days]?.status === "COMPLETE" ? outcome.horizons[days].returnPercent : null])),
      // Only trades whose full holding window has passed: early stop-outs alone would bias unfinished windows.
      trade: Object.fromEntries(HORIZONS.map((days) => [days, dates.indexOf(asOf) + 1 + days <= dates.length - 1 &&
        outcome.trade?.exits?.[days]?.status === "COMPLETE" ? outcome.trade.exits[days].netReturnPercent : null])),
    });
  }
  if ((position + 1) % 200 === 0) console.error(`${position + 1}/${dataset.stocks.length} stocks, ${Math.round((Date.now() - started) / 1000)}s`);
}

// --- statistics ---
const finite = (values) => values.filter(Number.isFinite);
const stats = (values) => {
  const list = finite(values);
  if (!list.length) return { n: 0, mean: null, win: null };
  return { n: list.length, mean: list.reduce((sum, value) => sum + value, 0) / list.length,
    win: list.filter((value) => value > 0).length / list.length * 100 };
};
const fmt = (value, digits = 2, sign = true) => Number.isFinite(value) ? `${sign && value > 0 ? "+" : ""}${value.toFixed(digits)}` : "—";
const cell = ({ n, mean, win }) => n ? `${fmt(mean)}%（勝 ${fmt(win, 0, false)}%，n=${n}）` : "—";
const perSession = (rows) => rows.length / sessions.length;
/** Staggered capital: each session commits 1/days of the account to that session's trades, so
 * overlapping holding windows are not compounded on top of each other. */
function equity(rows, days) {
  const byDate = new Map();
  for (const row of rows) if (Number.isFinite(row.trade[days])) byDate.set(row.asOf, [...byDate.get(row.asOf) ?? [], row.trade[days]]);
  let value = 1, peak = 1, drawdown = 0;
  for (const date of [...byDate.keys()].sort()) {
    const list = byDate.get(date);
    value *= 1 + list.reduce((sum, item) => sum + item, 0) / list.length / 100 / days;
    peak = Math.max(peak, value); drawdown = Math.min(drawdown, (value / peak - 1) * 100);
  }
  return { cumulative: (value - 1) * 100, drawdown, days: byDate.size };
}

const models = [["v1（現行）", "v1"], ["v2（採用參數）", "v2"], ...VARIANTS.map(({ label }) => [label, label])];
const lines = [];
const push = (...text) => lines.push(...text);
const allForward = Object.fromEntries(HORIZONS.map((days) => [days, stats(samples.map((row) => row.forward[days]))]));

push("# 進場研究門檻 v1／v2 歷史比較", "",
  `產生時間：${new Date().toISOString()}；資料來源：${origin} 公開市場快照（${dataset.info.generation}），公司行動為 D1 唯讀匯出。`,
  `比較期間：${sessions[0]} ～ ${sessions.at(-1)}，共 ${sessions.length} 個交易日、${samples.length.toLocaleString("en-US")} 筆樣本（${dataset.stocks.length} 檔）。`,
  "G1 的 20 日季線斜率需要 80 個交易日歷史，所有模型都在同一段期間比較；資料自 2026-06-08 起，因此比較期間較短。", "",
  "報酬為未還原價格，期間有除權息或停牌時不計（不補 0）。後續報酬以樣本日收盤為基準；模擬交易以隔日開盤在價格計畫內成交，扣除手續費、交易稅與滑價。", "",
  "## 1. 門檻通過數與明日候選", "",
  "| 模型 | 每日通過 | 每日待確認 | 每日明日候選 | 候選總數 |", "|---|---|---|---|---|");
for (const [label, key] of models) {
  const pass = samples.filter((row) => row.gates[key] === "PASS"), unknown = samples.filter((row) => row.gates[key] === "UNKNOWN");
  const candidates = pass.filter((row) => row.candidatePlan);
  push(`| ${label} | ${fmt(perSession(pass), 1, false)} | ${fmt(perSession(unknown), 1, false)} | ${fmt(perSession(candidates), 1, false)} | ${candidates.length} |`);
}

push("", "## 2. 通過與未通過門檻的後續報酬（收盤後 N 日，全部樣本）", "",
  `全部樣本：5 日 ${cell(allForward[5])}；10 日 ${cell(allForward[10])}；20 日 ${cell(allForward[20])}`, "",
  "| 模型 | 群組 | 5 日 | 10 日 | 20 日 |", "|---|---|---|---|---|");
for (const [label, key] of models.slice(0, 2)) for (const [group, status] of [["通過", "PASS"], ["未通過", "FAIL"]]) {
  const rows = samples.filter((row) => row.gates[key] === status);
  push(`| ${label} | ${group} | ${HORIZONS.map((days) => cell(stats(rows.map((row) => row.forward[days])))).join(" | ")} |`);
}

const singleFail = (conditionsKey, gateKey) => samples.filter((row) => {
  const conditions = row[conditionsKey];
  return conditions[gateKey] === "FAIL" && Object.entries(conditions).every(([key, status]) => key === gateKey || status === "PASS");
});
for (const [label, conditionsKey, labels] of [
  ["v1", "v1Conditions", { trend: "趨勢結構", momentum: "KD 動能", priceVolume: "量價表現", institutional: "法人籌碼", entryRisk: "基礎價格風險" }],
  ["v2", "v2Conditions", { trend: "G1 趨勢遭破壞", distribution: "G2 近期放量下跌", extension: "G3 過度延伸", institutional: "G4 法人明顯賣壓", liquidity: "G5 流動性不足" }],
]) {
  push("", `## 3${label === "v1" ? "a" : "b"}. ${label}：只差一項門檻的股票（其餘全部通過）`, "",
    "數字越低於「全部通過」，代表該項門檻越有排除效果；接近或更高，代表該項門檻擋掉的股票後來並沒有比較差。", "",
    "| 只未通過 | 5 日 | 10 日 | 20 日 |", "|---|---|---|---|");
  const passRows = samples.filter((row) => row.gates[label] === "PASS");
  push(`| （全部通過） | ${HORIZONS.map((days) => cell(stats(passRows.map((row) => row.forward[days])))).join(" | ")} |`);
  for (const [key, name] of Object.entries(labels)) {
    const rows = singleFail(conditionsKey, key);
    push(`| ${name} | ${HORIZONS.map((days) => cell(stats(rows.map((row) => row.forward[days])))).join(" | ")} |`);
  }
}

push("", "## 4. 明日候選的模擬交易（淨報酬）", "",
  "資金分 10 份、每個交易日投入 1 份於當日候選（等權），持有 10 日；未滿持有期的交易不計。", "",
  "| 模型 | 持有 5 日 | 持有 10 日 | 持有 20 日 | 10 日分批累積 | 10 日最大回撤 |", "|---|---|---|---|---|---|");
for (const [label, key] of models) {
  const rows = samples.filter((row) => row.gates[key] === "PASS" && row.candidatePlan);
  const curve = equity(rows, 10);
  push(`| ${label} | ${HORIZONS.map((days) => cell(stats(rows.map((row) => row.trade[days])))).join(" | ")} | ${fmt(curve.cumulative)}%（${curve.days} 日） | ${fmt(curve.drawdown)}% |`);
}

push("", "## 5. 準備度分組（通過門檻的樣本，收盤後 10 日）", "",
  "檢查「分數越高、後續表現越好」是否成立。", "", "| 準備度 | v1 | v2 |", "|---|---|---|");
for (const [min, max] of [[0, 39], [40, 59], [60, 69], [70, 79], [80, 89], [90, 100]]) {
  const bucket = (key) => cell(stats(samples.filter((row) => row.gates[key] === "PASS" && row.readiness[key] >= min &&
    (max === 100 ? row.readiness[key] <= 100 : row.readiness[key] < max + 1)).map((row) => row.forward[10])));
  push(`| ${min}–${max} | ${bucket("v1")} | ${bucket("v2")} |`);
}

const v1Candidates = new Set(samples.filter((row) => row.gates.v1 === "PASS" && row.candidatePlan).map((row) => `${row.symbol}@${row.asOf}`));
const v2Candidates = samples.filter((row) => row.gates.v2 === "PASS" && row.candidatePlan);
push("", "## 6. 候選重疊", "",
  `v1 候選 ${v1Candidates.size} 筆、v2 候選 ${v2Candidates.length} 筆，兩者共同 ${v2Candidates.filter((row) => v1Candidates.has(`${row.symbol}@${row.asOf}`)).length} 筆。`, "",
  "## 限制", "",
  `- 比較期間只有 ${sessions.length} 個交易日，涵蓋單一行情；20 日結果樣本特別少，只能看方向，不能當成定論。`,
  "- 名錄為目前上市公司，期間內已下市者不在內（存活者偏差）。",
  "- 歷史資料為交易所更正後版本，可能與當日晚間實際取得的資料略有差異。",
  "- 敏感度測試只用來確認結果是否穩定，不據此挑選表現最好的一組參數。", "");
await writeFile(args.out, lines.join("\n"));
if (args.samples) await writeFile(args.samples, JSON.stringify(samples));
console.error(`Wrote ${args.out}: ${samples.length} samples in ${Math.round((Date.now() - started) / 1000)}s`);
