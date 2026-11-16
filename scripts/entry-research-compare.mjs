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
import { entryResearchApplies, entryResearchGates, evaluateEntryResearch } from "../shared/entry-research.js";
import { evaluateResearchOutcome } from "../shared/entry-research-outcome.js";
import { ENTRY_RESEARCH_MODEL_V1, ENTRY_RESEARCH_MODEL_V2, ENTRY_RESEARCH_MODEL_V3 } from "../shared/entry-research-model.js";
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
  variant("G5 1 億元", { minTradingValue: 100_000_000 }),
  variant("G5 3 億元", { minTradingValue: 300_000_000 }),
];
const HORIZONS = [5, 10, 20];
// v4 draft (docs/entry-research-grid-2y.md): the live v3 signal with the two changes that improved
// both 2025 and 2026 in the whole-pipeline grid: G5 at NT$300 million and a 20-session hold, entry
// still at the next open. The limit buy was not stable and is kept only as a comparison row.
// Research only; the live model is unchanged.
const V4_LIQUIDITY = "G5 3 億元";
const LIMIT_MODEL = { ...ENTRY_RESEARCH_MODEL_V3, plan: { ...ENTRY_RESEARCH_MODEL_V3.plan, entryMode: "limitAtClose" } };

const loaded = await loadDataset(origin, args.cache);
// Entry research never evaluates ETFs in production (entryResearchApplies); the studies match that.
const dataset = { ...loaded, stocks: loaded.stocks.filter(entryResearchApplies) };
const actions = await loadActions(args.actions);
const dates = dataset.dates;
// G1's 20-session MA60 slope needs 80 sessions; every model is compared on the same sessions.
const firstIndex = 79;
const sessions = dates.slice(firstIndex);
const samples = [];
const started = Date.now();
// Only trades whose full holding window has passed: early stop-outs alone would bias unfinished windows.
const tradeOf = (outcome, asOf) => Object.fromEntries(HORIZONS.map((days) => [days, dates.indexOf(asOf) + 1 + days <= dates.length - 1 &&
  outcome.trade?.exits?.[days]?.status === "COMPLETE" ? outcome.trade.exits[days].netReturnPercent : null]));
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
    // The live v3 signal, filled at the next open (live rule) and by a limit at the signal close.
    const v3 = evaluateEntryResearch({ ...common, score, model: ENTRY_RESEARCH_MODEL_V3, researchAllStocks: true });
    const plan3 = v3.nextDayPlan, sample3 = { symbol: stock.symbol, tradeDate: asOf, referenceClose: plan3.referenceClose, nextDayPlan: plan3 };
    const context = { tradingDates: dates, history: stock.history, corporateActions: actions };
    const outcome3 = evaluateResearchOutcome(sample3, { ...context, model: ENTRY_RESEARCH_MODEL_V3 });
    const outcome3Limit = evaluateResearchOutcome(sample3, { ...context, model: LIMIT_MODEL });
    samples.push({
      symbol: stock.symbol, asOf, candidatePlan: plan.status === "NEXT_DAY_CANDIDATE",
      candidateV3: plan3.status === "NEXT_DAY_CANDIDATE",
      tradeV3: tradeOf(outcome3, asOf), tradeV3Limit: tradeOf(outcome3Limit, asOf),
      gates: { v1: v1.gateResult.status, v2: v2.gateResult.status,
        ...Object.fromEntries(VARIANTS.map(({ label, model }) => [label, entryResearchGates({ ...common, score, model }).status])) },
      v1Conditions: v1.gateResult.conditions, v2Conditions: v2.gateResult.conditions,
      readiness: { v1: v1.entryResearch.score, v2: v2.entryResearch.score },
      forward: Object.fromEntries(HORIZONS.map((days) => [days, outcome.horizons[days]?.status === "COMPLETE" ? outcome.horizons[days].returnPercent : null])),
      trade: tradeOf(outcome, asOf),
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
function equity(rows, days, kind = "trade") {
  const byDate = new Map();
  for (const row of rows) if (Number.isFinite(row[kind][days])) byDate.set(row.asOf, [...byDate.get(row.asOf) ?? [], row[kind][days]]);
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
  `產生時間：${new Date().toISOString()}；資料來源：${args.cache ? `本機資料集 ${args.cache}` : `${origin} 公開市場快照`}（${dataset.info.generation}），公司行動來自 ${args.actions}。`,
  `重跑：\`node scripts/entry-research-compare.mjs --actions ${args.actions} --out ${args.out}${args.cache ? ` --cache ${args.cache}` : ""}\`${args.cache ? "；本機資料集與公司行動由 `scripts/backfill-history-offline.mjs`（fetch → actions → build → verify）產生" : ""}。`,
  `比較期間：${sessions[0]} ～ ${sessions.at(-1)}，共 ${sessions.length} 個交易日、${samples.length.toLocaleString("en-US")} 筆樣本（${dataset.stocks.length} 檔）。`,
  `G1 的 20 日季線斜率需要 80 個交易日歷史，所有模型都在同一段期間比較；資料自 ${dates[0]} 起。`, "",
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
// --- excess return and market regimes ---
// Benchmark: the equal-weight mean of every sample's forward return on the same session (the whole
// researched market), so a candidate's excess return is what it earned beyond simply holding the market.
const benchmark = Object.fromEntries(HORIZONS.map((days) => {
  const sums = new Map();
  for (const row of samples) if (Number.isFinite(row.forward[days])) {
    const entry = sums.get(row.asOf) ?? [0, 0]; entry[0] += row.forward[days]; entry[1]++; sums.set(row.asOf, entry);
  }
  return [days, new Map([...sums].map(([date, [sum, n]]) => [date, sum / n]))];
}));
const excess = (row, days, kind) => {
  const base = benchmark[days].get(row.asOf), value = row[kind][days];
  return Number.isFinite(base) && Number.isFinite(value) ? value - base : null;
};
// Market regime from an equal-weight index of every non-ETF stock's daily close-to-close return,
// skipping returns across a missing session or a corporate action (unadjusted prices).
const regimeOf = (() => {
  const position = new Map(dates.map((date, index) => [date, index]));
  const sums = dates.map(() => [0, 0]);
  for (const stock of dataset.stocks) {
    if (stock.sector === "ETF" || stock.assetType === "etf") continue;
    const events = actions.eventsBySymbol.get(stock.symbol);
    for (let i = 1; i < stock.history.length; i++) {
      const bar = stock.history[i], prior = stock.history[i - 1], index = position.get(bar.date);
      if (index !== position.get(prior.date) + 1 || events?.has(bar.date)) continue;
      const change = bar.close / prior.close - 1;
      if (Math.abs(change) > 0.11) continue;
      sums[index][0] += change; sums[index][1]++;
    }
  }
  const level = [];
  sums.forEach(([sum, n], index) => level.push(index ? level[index - 1] * (1 + (n ? sum / n : 0)) : 1));
  const ma = (index) => index < 59 ? null : level.slice(index - 59, index + 1).reduce((a, b) => a + b, 0) / 60;
  const regimes = new Map();
  for (let index = 0; index < dates.length; index++) {
    const now = ma(index), before = index >= 20 ? ma(index - 20) : null;
    regimes.set(dates[index], now === null || before === null ? null
      : level[index] > now && now > before ? "多頭" : level[index] < now && now < before ? "空頭" : "盤整");
  }
  return { regimes, level };
})();
const quarter = (date) => `${date.slice(0, 4)} Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`;
const candidatesOf = (key) => samples.filter((row) => row.gates[key] === "PASS" && row.candidatePlan);
const excessCell = (rows, days, kind) => {
  const list = finite(rows.map((row) => excess(row, days, kind)));
  return list.length ? `${fmt(list.reduce((a, b) => a + b, 0) / list.length)}%（贏過大盤 ${fmt(list.filter((v) => v > 0).length / list.length * 100, 0, false)}%，n=${list.length}）` : "—";
};

push("", "## 6. 超額報酬（候選報酬減同期全市場樣本報酬）", "",
  "基準為同一樣本日所有樣本（全市場、等權）收盤後 N 日報酬的平均。「收盤基準」以候選的樣本日收盤計算，與基準同口徑；",
  "「模擬交易」以隔日開盤成交、扣除成本的淨報酬減同一基準，因成本與成交價不同，會比收盤基準略低。", "",
  "| 模型 | 口徑 | 5 日 | 10 日 | 20 日 |", "|---|---|---|---|---|");
for (const [label, key] of models.slice(0, 2)) for (const [name, kind] of [["收盤基準", "forward"], ["模擬交易", "trade"]]) {
  const rows = candidatesOf(key);
  push(`| ${label} | ${name} | ${HORIZONS.map((days) => excessCell(rows, days, kind)).join(" | ")} |`);
}
push("", "通過門檻（不論是否為明日候選）的超額報酬，收盤基準：", "", "| 模型 | 5 日 | 10 日 | 20 日 |", "|---|---|---|---|");
for (const [label, key] of models.slice(0, 2)) {
  const rows = samples.filter((row) => row.gates[key] === "PASS");
  push(`| ${label} | ${HORIZONS.map((days) => excessCell(rows, days, "forward")).join(" | ")} |`);
}

const segmentTable = (title, intro, keyOf, order) => {
  push("", title, "", ...intro, "",
    "| 區段 | 交易日 | 全市場 10 日 | v1 候選 10 日淨報酬 | v1 超額（收盤） | v2 候選 10 日淨報酬 | v2 超額（收盤） |",
    "|---|---|---|---|---|---|---|");
  const groups = [...new Set(sessions.map(keyOf).filter(Boolean))].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  for (const group of groups) {
    const inGroup = (row) => keyOf(row.asOf) === group;
    const days = sessions.filter((date) => keyOf(date) === group).length;
    const all = stats(samples.filter(inGroup).map((row) => row.forward[10]));
    const [v1, v2] = ["v1", "v2"].map((key) => candidatesOf(key).filter(inGroup));
    push(`| ${group} | ${days} | ${cell(all)} | ${cell(stats(v1.map((row) => row.trade[10])))} | ${excessCell(v1, 10, "forward")} | ${cell(stats(v2.map((row) => row.trade[10])))} | ${excessCell(v2, 10, "forward")} |`);
  }
};
segmentTable("## 7a. 依季度分段（持有 10 日）", ["每季的全市場報酬代表當季行情；超額報酬為正，代表候選在該季仍贏過大盤。"], quarter, () => 0);
const regimeCounts = Object.entries(sessions.reduce((counts, date) => {
  const regime = regimeOf.regimes.get(date) ?? "未定"; return { ...counts, [regime]: (counts[regime] ?? 0) + 1 };
}, {})).map(([name, n]) => `${name} ${n} 日`).join("、");
segmentTable("## 7b. 依大盤趨勢分段（持有 10 日）", [
  "大盤以全部個股（不含 ETF）每日收盤報酬的等權平均自行計算指數；跨停牌或除權息日的報酬不計。",
  "樣本日指數在 60 日均線之上且均線較 20 日前上升為「多頭」，在均線之下且均線下降為「空頭」，其餘為「盤整」。",
  `期間分布：${regimeCounts}。`], (date) => regimeOf.regimes.get(date), (name) => ["多頭", "盤整", "空頭"].indexOf(name));

// --- v4 draft, one change at a time on the live v3 signal ---
const V4_ROWS = [
  ["v3（正式站現行）：隔日開盤", "v2", "tradeV3"],
  ["v3＋限價買在訊號日收盤", "v2", "tradeV3Limit"],
  ["v3＋流動性 1 億", "G5 1 億元", "tradeV3"],
  ["v4 草案：流動性 3 億（持有 20 日）", V4_LIQUIDITY, "tradeV3"],
  ["v4＋限價（對照）", V4_LIQUIDITY, "tradeV3Limit"],
];
const v4Candidates = (gateKey) => samples.filter((row) => row.gates[gateKey] === "PASS" && row.candidateV3);
const meanCell = (values) => cell(stats(values));
push("", "## 8. v4 草案驗證（以正式站 v3 訊號為基準，逐項加入）", "",
  "依全流程組合回測（docs/entry-research-grid-2y.md）在 2025、2026 兩段都改善的兩項改動：G5 流動性門檻由 1,000 萬元提高到 3 億元、持有期由 10 日延長到 20 日；進場仍為隔日開盤。限價買兩段結果不一致，只列為對照。",
  "v3 與 v2 的門檻相同，差別在訊號只在觸發當天成為候選。各列門檻與訊號相同，只改一項，用來確認每項改動各自的貢獻。研究用，正式站模型未變更。", "",
  "| 方案 | 每日候選 | 持有 10 日 | 持有 20 日 | 20 日超額 | 20 日分批累積 | 20 日最大回撤 |", "|---|---|---|---|---|---|---|");
for (const [label, gateKey, kind] of V4_ROWS) {
  const rows = v4Candidates(gateKey), curve = equity(rows, 20, kind);
  push(`| ${label} | ${fmt(perSession(rows), 1, false)} | ${meanCell(rows.map((row) => row[kind][10]))} | ${meanCell(rows.map((row) => row[kind][20]))} | ${excessCell(rows, 20, kind)} | ${fmt(curve.cumulative)}%（${curve.days} 日） | ${fmt(curve.drawdown)}% |`);
}
for (const [title, keyOf, order] of [
  ["依年度（持有 20 日）", (date) => date.slice(0, 4), () => 0],
  ["依季度（持有 20 日）", quarter, () => 0],
  ["依大盤趨勢（持有 20 日）", (date) => regimeOf.regimes.get(date), (name) => ["多頭", "盤整", "空頭"].indexOf(name)],
]) {
  push("", `### ${title}`, "", `| 區段 | ${V4_ROWS.map(([label]) => label).join(" | ")} |`, `|---|${V4_ROWS.map(() => "---").join("|")}|`);
  const groups = [...new Set(sessions.map(keyOf).filter(Boolean))].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  for (const group of groups) push(`| ${group} | ${V4_ROWS.map(([, gateKey, kind]) => {
    const rows = v4Candidates(gateKey).filter((row) => keyOf(row.asOf) === group);
    return `${meanCell(rows.map((row) => row[kind][20]))}；超額 ${excessCell(rows, 20, kind)}`;
  }).join(" | ")} |`);
}
push("", "持有 20 日需要訊號後 21 個交易日的行情，期間最後約一個月的候選尚無結果。G1～G4、訊號定義與限價進場在組合回測中兩段方向不一致或影響很小，為避免過度配適，維持現行。");

push("", "## 9. 候選重疊", "",
  `v1 候選 ${v1Candidates.size} 筆、v2 候選 ${v2Candidates.length} 筆，兩者共同 ${v2Candidates.filter((row) => v1Candidates.has(`${row.symbol}@${row.asOf}`)).length} 筆。`, "",
  "## 限制", "",
  `- 比較期間共 ${sessions.length} 個交易日；不同區段的樣本數差異大，單一區段的結果只能看方向。`,
  "- 名錄為目前上市公司，期間內已下市者不在內（存活者偏差），全市場基準與候選報酬都可能因此偏高。",
  "- 與正式站相同，ETF 不納入進場研究（樣本、候選、全市場基準與大盤指數皆不含 ETF）。",
  "- 歷史資料為交易所更正後版本，可能與當日晚間實際取得的資料略有差異。",
  "- 敏感度測試與分段結果只用來確認現行參數是否穩定，不據此挑選表現最好的一組參數。", "");
await writeFile(args.out, lines.join("\n"));
if (args.samples) await writeFile(args.samples, JSON.stringify(samples));
console.error(`Wrote ${args.out}: ${samples.length} samples in ${Math.round((Date.now() - started) / 1000)}s`);
