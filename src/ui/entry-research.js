import { entryResearchSummary } from "../../shared/entry-research.js";
import { ENTRY_RESEARCH_STATUS_LABELS, NEXT_DAY_STATUS_LABELS, SETUP_LABELS } from "../../shared/entry-research-model.js";

// Presentation of entry research results. Every value comes from shared/entry-research.js
// (server summary/analysis, or the same module in demo mode); nothing is recomputed here.

const V1_GATE_LABELS = { trend: "趨勢結構", momentum: "KD 動能", priceVolume: "量價表現", institutional: "法人籌碼", entryRisk: "基礎價格風險" };
// v2 vetoes: full label for lists and panels, short name under each icon.
const VETO_LABELS = { trend: "趨勢遭破壞", distribution: "近期放量下跌", extension: "過度延伸", institutional: "法人明顯賣壓", liquidity: "流動性不足" };
const VETO_SHORT = { trend: "趨勢", distribution: "放量下跌", extension: "過度延伸", institutional: "法人賣壓", liquidity: "流動性" };
const VETO_ICONS = {
  trend: '<path d="m3 7 6 6 4-4 8 8"/><path d="M21 11v6h-6"/>',
  distribution: '<path d="M4 20v-8m5 8v-5m5 5V11"/><path d="M19 4v10m-3-3 3 3 3-3"/>',
  extension: '<path d="M4 20h16"/><path d="M12 16V4m-4 4 4-4 4 4"/>',
  institutional: '<path d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6"/>',
  liquidity: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/>',
};
// A veto that does not fire is fine, so v2 says 觸發／未觸發 rather than 通過／未通過.
const VETO_STATUS = { PASS: ["未觸發", "pass"], FAIL: ["觸發", "fail"], UNKNOWN: ["待確認", "unknown"] };
const isV1 = (version) => version === "entry-research-v1";
const STATUS_TONE = { TRIGGERED: "positive", WAIT_TRIGGER: "neutral", SIGNAL_EXPIRED: "muted", SIGNAL_INVALIDATED: "negative",
  DATA_INSUFFICIENT: "muted", NOT_ELIGIBLE: "muted" };
const NEXT_TONE = { NEXT_DAY_CANDIDATE: "positive", WAIT_TRIGGER: "neutral", PRICE_TOO_HIGH: "warning",
  PLAN_INVALIDATED: "negative", DATA_INSUFFICIENT: "muted", NOT_ELIGIBLE: "muted" };
const DATA_LABELS = { close: "收盤價", ma20: "MA20", ma60: "MA60", previousMa20: "前日 MA20", previousMa60: "前日 MA60",
  k: "K", d: "D", previousK: "前日 K", dayBeforeK: "前二日 K", changePercent: "漲跌幅 %", rvol20: "RVOL20",
  institutionalNet5: "近五日法人淨額（股）", deviation20: "MA20 乖離 %", previous10Low: "前十日最低價", atr14: "ATR14",
  slopeSessions: "季線比較期間（交易日）", earlierMa60: "比較期初 MA60", date: "放量下跌日", high: "當日最高價", extensionAtr: "距 MA20（ATR 倍數）", netShares: "外資＋投信淨額（股）",
  volumeShares: "期間成交量（股）", netPercent: "淨額占成交量 %", averageTradingValue: "平均成交金額（元）" };
const REFERENCE_NOTE = "參數為本站依參考資料調整，尚未以歷史資料驗證。";

/** Compact fields for lists, from either the summary API or a full result (demo/analysis). */
export const researchSummaryOf = (stock) => stock?.entryResearch?.gateResult
  ? entryResearchSummary(stock.entryResearch) : stock?.entryResearch ?? null;

/** List line: v2 names the first triggered veto; v1 keeps its x/5 count. */
function gateText(summary) {
  if (!summary) return "—";
  if (isV1(summary.modelVersion)) return summary.gateStatus === "UNKNOWN" ? `門檻 ${summary.gatePassed}/5 待確認` : `門檻 ${summary.gatePassed}/5`;
  if (summary.gateStatus === "PASS") return "初步門檻通過";
  if (summary.gateStatus === "UNKNOWN") return "初步門檻待確認";
  const fired = Object.entries(summary.gateConditions ?? {}).filter(([, status]) => status === "FAIL").map(([key]) => VETO_LABELS[key] ?? key);
  return fired.length > 1 ? `${fired[0]} 等 ${fired.length} 項` : fired[0] ?? "未通過初步門檻";
}

export function researchListCells(stock, esc, number) {
  const summary = researchSummaryOf(stock);
  const score = Number.isFinite(summary?.score) ? number(summary.score, 0) : "—";
  const gateTone = summary?.gateStatus === "PASS" ? "pass" : summary?.gateStatus === "FAIL" ? "fail" : "unknown";
  const readiness = `<button type="button" class="entry-score-button research-score-button" data-entry-score="${esc(stock.symbol)}" aria-label="查看${esc(stock.name)}進場研究"><strong>${score}</strong><small class="research-gate ${gateTone}">${esc(gateText(summary))}</small></button>`;
  const status = summary?.status, next = summary?.nextDayStatus;
  // The next-day line only adds information beyond the status chip.
  const nextLabel = NEXT_DAY_STATUS_LABELS[next] ?? "—";
  const nextText = next === "WAIT_TRIGGER" ? "明日：尚無進場計畫" : next === "NOT_ELIGIBLE" ? "明日：尚未評估"
    : nextLabel.startsWith("明日") ? nextLabel : `明日：${nextLabel}`;
  const research = summary
    ? `<span class="research-chip ${STATUS_TONE[status] ?? "muted"}">${esc(ENTRY_RESEARCH_STATUS_LABELS[status] ?? "—")}</span><small class="research-next ${NEXT_TONE[next] ?? "muted"}">${esc(nextText)}${summary.setupType ? ` · ${esc(SETUP_LABELS[summary.setupType])}` : ""}</small>`
    : '<span class="research-chip muted">資料不足</span>';
  return { readiness, research };
}

export const RESEARCH_FILTERS = [
  ["all", "全部研究狀態"], ["gatePass", "初步門檻通過"], ["triggered", "進場訊號已觸發"],
  ["waiting", "等待進場訊號"], ["candidate", "明日進場候選"], ["priceHigh", "價格超出容許範圍"],
  ["pullback", "順勢回踩恢復"], ["breakout", "整理區間向上突破"], ["score80", "進場準備度 80 以上"],
  ["score60", "進場準備度 60～79"],
];

export function matchesResearchFilter(stock, filter) {
  if (!filter || filter === "all") return true;
  const summary = researchSummaryOf(stock);
  if (!summary) return false;
  switch (filter) {
    case "gatePass": return summary.gateStatus === "PASS";
    case "triggered": return summary.status === "TRIGGERED";
    case "waiting": return summary.status === "WAIT_TRIGGER";
    case "candidate": return summary.nextDayStatus === "NEXT_DAY_CANDIDATE";
    case "priceHigh": return summary.nextDayStatus === "PRICE_TOO_HIGH";
    case "pullback": return summary.setupType === "PULLBACK_RECOVERY";
    case "breakout": return summary.setupType === "RANGE_BREAKOUT";
    case "score80": return summary.score >= 80;
    case "score60": return summary.score >= 60 && summary.score < 80;
    default: return true;
  }
}

/** Default order: next-day candidates, other gate passes, price too high, then everything else;
 * readiness high to low inside a group, then gates passed, then symbol. */
export function compareResearchStocks(a, b) {
  const group = (stock) => {
    const summary = researchSummaryOf(stock);
    if (!summary) return 4;
    if (summary.nextDayStatus === "NEXT_DAY_CANDIDATE") return 0;
    if (summary.nextDayStatus === "PRICE_TOO_HIGH") return 2;
    return summary.gateStatus === "PASS" ? 1 : 3;
  };
  const difference = group(a) - group(b);
  if (difference) return difference;
  const as = researchSummaryOf(a), bs = researchSummaryOf(b);
  const scoreDifference = (bs?.score ?? -1) - (as?.score ?? -1);
  if (scoreDifference) return scoreDifference;
  return (bs?.gatePassed ?? -1) - (as?.gatePassed ?? -1) || a.symbol.localeCompare(b.symbol);
}

const items = (values, esc, empty) => values?.length
  ? `<ul>${values.map((value) => `<li>${esc(value)}</li>`).join("")}</ul>` : `<p class="research-empty">${empty}</p>`;
const price = (value, number) => Number.isFinite(value) ? number(value, 2) : "—";
const NEXT_EXPLANATION = {
  NEXT_DAY_CANDIDATE: "今日收盤符合波段順勢策略，並已出現進場訊號。明日仍須確認實際價格是否符合計畫，不代表開盤後可無條件買進。",
  WAIT_TRIGGER: "初步門檻已通過，但尚未出現有效的進場訊號，暫不建立價格計畫。",
  PRICE_TOO_HIGH: "訊號已出現，但價格或風險已超出計畫容許範圍，避免直接追價。",
  PLAN_INVALIDATED: "收盤已跌破策略失效價，原進場計畫失效。",
  DATA_INSUFFICIENT: "必要資料不足或尚待查核，無法建立可靠的進場計畫。",
  NOT_ELIGIBLE: "觸發初步門檻的否決條件，不進行進場評估。",
};

/** Dialog sections in the required order; the chart and the V1.2 detail follow them. */
export function researchDialogSections(result, stock, { esc, number, percent }) {
  const { gateResult: gate, entryResearch: research, nextDayPlan: plan, dataQuality: quality } = result;
  // Price, change and date already show in the header and chart above; only price-data warnings
  // (e.g. unadjusted prices around a dividend) stay here, once. Missing data is explained by the
  // pending gates themselves.
  const basic = quality.warnings.length
    ? `<section class="research-basic" aria-label="資料提醒"><div class="research-warning" role="note">${items(quality.warnings, esc, "")}</div></section>` : "";

  const reasons = research.status === "TRIGGERED" ? research.triggeredConditions : gate.status !== "PASS" ? gate.reasons : research.pendingConditions;
  const risks = research.riskWarnings.filter((warning) => !quality.warnings.includes(warning));
  const card = `<section class="research-plan-card ${NEXT_TONE[plan.status] ?? "muted"}" aria-labelledby="research-plan-title"><p class="research-eyebrow">明日進場評估 · 依 ${esc(plan.planAsOf)} 收盤</p><h3 id="research-plan-title">${esc(plan.label)}</h3><p>${esc(NEXT_EXPLANATION[plan.status] ?? "")}</p><dl class="research-plan-facts"><div><dt>進場準備度</dt><dd>${Number.isFinite(research.score) ? `${number(research.score, 0)} / 100` : "—"}</dd></div><div><dt>初步門檻</dt><dd>${gateSummary(gate, result.modelVersion)}</dd></div><div><dt>進場策略</dt><dd>${esc(research.setupLabel ?? "—")}</dd></div><div><dt>訊號日</dt><dd>${esc(research.signal?.date ?? "—")}</dd></div></dl>
    <details class="research-reasons"${plan.status === "NEXT_DAY_CANDIDATE" ? " open" : ""}><summary>${research.status === "TRIGGERED" ? "主要成立原因" : "目前狀態原因"}</summary>${items(reasons, esc, "沒有額外說明。")}${risks.length ? `<h4>主要風險</h4>${items(risks, esc, "")}` : ""}${plan.conditionsToConfirm.length ? `<h4>明日需確認</h4>${items(plan.conditionsToConfirm, esc, "")}` : ""}</details>
    ${plan.requiresPriceConfirmation && plan.status === "NEXT_DAY_CANDIDATE" ? '<p class="research-confirm">等待實際價格確認：目前沒有即時行情，以下一交易日實際開盤價判斷是否仍符合計畫。</p>' : ""}</section>`;

  const component = (label, value, weight) => `<div class="research-component"><span>${label}<small>權重 ${weight}%</small></span><strong>${Number.isFinite(value) ? number(value, 0) : "—"}</strong><progress value="${Number.isFinite(value) ? value : 0}" max="100" aria-label="${label} ${Number.isFinite(value) ? number(value, 0) : "無資料"} 分"></progress></div>`;
  const readiness = `<section class="research-readiness" aria-labelledby="research-readiness-title"><h3 id="research-readiness-title">進場準備度</h3>${Number.isFinite(research.score)
    ? `<div class="research-readiness-body"><div class="research-readiness-score"><strong>${number(research.score, 0)}</strong><span>/ 100</span></div><div class="research-components">${component("五大構面強度", research.componentScores.structure, research.weights.structure)}${component("進場訊號品質", research.componentScores.signal, research.weights.signal)}${component("進場位置與時機", research.componentScores.timing, research.weights.timing)}</div></div><div class="research-strengths"><div><h4>表現較好</h4>${items(research.strengths, esc, "沒有特別突出的構面。")}</div><div><h4>仍可改善</h4>${items(research.weaknesses, esc, "沒有明顯偏弱的構面。")}</div></div>`
    : `<p class="research-empty">${gate.status === "FAIL" ? "未通過初步門檻，不計算進場準備度。" : "資料不足，無法計算進場準備度。"}</p>`}<p class="helper-text">衡量進場準備程度供股票之間比較，不是獲利機率或買進指令；權重為暫定、尚未經歷史回測驗證。</p></section>`;

  const gates = gatesSection(result, { esc, number });
  const signal = research.signal;
  const evidence = signal?.setupType === "PULLBACK_RECOVERY" ? [
    ["回踩日期", signal.evidence.pullbackDates.join("、") || "—"], ["回踩低點", price(signal.evidence.pullbackLow, number)],
    ["MA20", price(signal.evidence.ma20, number)], ["前日最高價", price(signal.evidence.previousHigh, number)],
  ] : signal ? [
    ["整理區間", `${signal.evidence.rangeStart} ～ ${signal.evidence.rangeEnd}`], ["區間上緣", price(signal.evidence.rangeHigh, number)],
    ["區間下緣", price(signal.evidence.rangeLow, number)], ["突破幅度", percent(signal.evidence.breakoutPercent)],
  ] : [];
  const signalSection = `<section class="research-signal" aria-labelledby="research-signal-title"><h3 id="research-signal-title">進場訊號分析</h3>${signal
    ? `<p><span class="research-chip ${STATUS_TONE[signal.status]}">${esc(ENTRY_RESEARCH_STATUS_LABELS[signal.status])}</span> ${esc(signal.setupLabel)} · ${esc(signal.date)}${signal.invalidatedOn ? ` · ${esc(signal.invalidatedOn)} 收盤跌破失效價` : ""}</p><dl class="research-signal-facts">${[["觸發價格", price(signal.triggerPrice, number)], ...evidence,
      ["KD 確認", signal.kdConfirmed ? "已確認" : "未完全確認"], ["量能確認", signal.volumeConfirmed === null ? "資料不足" : signal.volumeConfirmed ? `已確認（RVOL20 ${price(signal.rvol20, number)}）` : `未達標準（RVOL20 ${price(signal.rvol20, number)}）`],
      ["有效期間", `觸發日起 ${signal.validSessions} 個交易日`]].map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>${items(signal.checks.map((check) => `${check.met ? "✓" : "✗"} ${check.text}`), esc, "")}`
    : `<p><span class="research-chip ${STATUS_TONE[research.status] ?? "muted"}">${esc(research.label ?? "—")}</span></p>${research.status === "WAIT_TRIGGER" ? `<h4>還需要成立的條件</h4>${items(research.pendingConditions, esc, "等待回踩 MA20 或整理區間形成。")}` : ""}`}</section>`;

  const row = (label, value, note = "") => `<div><dt>${label}</dt><dd>${value}${note ? `<small>${note}</small>` : ""}</dd></div>`;
  const planSection = `<section class="research-price-plan" aria-labelledby="research-price-plan-title"><h3 id="research-price-plan-title">明日價格計畫</h3>${Number.isFinite(plan.entryReferencePrice)
    ? `<dl class="research-plan-table">${row("今日參考收盤價", price(plan.referenceClose, number))}${row("進場參考價格", price(plan.entryReferencePrice, number))}${row("可接受價格區間", plan.entryPriceLower === null ? `≤ ${price(plan.entryPriceUpper, number)}` : `${price(plan.entryPriceLower, number)} ～ ${price(plan.entryPriceUpper, number)}`, plan.entryPriceLower === null ? "策略未定義下限" : "")}${row("可接受價格上限", price(plan.entryPriceUpper, number), "超過後不再符合原計畫，避免追價")}${row("策略失效價格", price(plan.invalidationPrice, number), "跌破代表原策略情境被破壞")}${row("預估風險距離", `${number(plan.riskPercent, 2)}%`, `以上限進場為 ${number(plan.maxRiskPercent, 2)}%`)}${row("ATR14", price(plan.atr14, number))}${row("計畫有效", esc(plan.planExpiresAt ?? "下一個交易日"))}</dl>`
    : `<p class="research-empty">${esc(plan.reasons.at(-1) ?? "沒有有效的價格計畫。")}</p>`}</section>`;

  // Stocks that did not pass stage 1 have no readiness, signal or plan to show.
  const evaluated = gate.status === "PASS";
  const notice = evaluated ? "" : `<p class="research-not-evaluated">${gate.status === "FAIL" ? "未通過初步門檻，不評估進場準備度、訊號與價格計畫。" : "初步門檻資料待確認，暫不評估進場準備度、訊號與價格計畫。"}</p>`;
  return { basic, card, readiness, gates, signal: signalSection, plan: planSection, evaluated, notice };
}

function gateSummary(gate, version) {
  if (isV1(version)) return `${gate.passedCount} / 5${gate.status === "UNKNOWN" ? "（待確認）" : ""}`;
  const fired = Object.values(gate.conditions).filter((status) => status === "FAIL").length;
  return gate.status === "PASS" ? "通過" : fired ? `觸發 ${fired} 項` : "待確認";
}

const dataValue = (value, number) => typeof value === "number"
  ? (Number.isInteger(value) ? value.toLocaleString("zh-TW") : number(value, 2)) : String(value);

/**
 * Stage 1 as icons side by side. Each icon is a radio label; its calculation and references
 * show below when selected (pure CSS, so re-rendered dialogs need no event wiring). A stock
 * that did not pass opens on its first triggered or pending condition.
 */
function gatesSection(result, { esc, number }) {
  const gate = result.gateResult, v1 = isV1(result.modelVersion);
  const name = `research-gate-${esc(result.stockCode)}`;
  const entries = Object.entries(gate.details);
  const opened = gate.status === "PASS" ? null : (entries.find(([, item]) => item.status === "FAIL") ?? entries.find(([, item]) => item.status !== "PASS"))?.[0];
  const status = (item) => (v1 ? { PASS: ["通過", "pass"], FAIL: ["未通過", "fail"], UNKNOWN: ["資料不足", "unknown"] } : VETO_STATUS)[item.status] ?? ["待確認", "unknown"];
  const inputs = entries.map(([key]) => `<input type="radio" class="research-gate-choice" name="${name}" id="${name}-${key}" value="${key}"${key === opened ? " checked" : ""}>`).join("");
  const tiles = entries.map(([key, item]) => {
    const [label, tone] = status(item);
    return `<label class="research-gate-tile ${tone}" for="${name}-${key}" data-gate="${key}"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${VETO_ICONS[key] ?? '<circle cx="12" cy="12" r="8"/>'}</svg><strong>${esc(v1 ? V1_GATE_LABELS[key] ?? item.label : VETO_SHORT[key] ?? item.label)}</strong><small>${label}</small></label>`;
  }).join("");
  const panels = entries.map(([key, item]) => {
    const [label, tone] = status(item);
    const data = Object.entries(item.data ?? {}).filter(([, value]) => value !== null && value !== undefined)
      .map(([field, value]) => `<div><dt>${esc(DATA_LABELS[field] ?? field)}</dt><dd>${esc(dataValue(value, number))}</dd></div>`).join("");
    const references = (item.references ?? []).map((ref) => `<li><span class="research-reference-kind">${esc(ref.kind)}</span><a href="${esc(ref.url)}" target="_blank" rel="noopener noreferrer">${esc(ref.title)}</a></li>`).join("");
    return `<div class="research-gate-panel" data-gate="${key}"><div class="research-gate-head"><strong>${esc(item.label ?? key)}</strong><span class="research-gate-status ${tone}">${label}</span></div><p>${esc(item.reason)}</p><p class="research-rule">計算方式：${esc(item.rule)}</p>${data ? `<dl>${data}</dl>` : ""}${references ? `<details class="research-reference-details"><summary>參考依據</summary><ul class="research-references">${references}</ul><p class="research-gate-note">${REFERENCE_NOTE}</p></details>` : ""}</div>`;
  }).join("");
  const fired = entries.filter(([, item]) => item.status === "FAIL").length;
  const heading = v1 ? "五大核心門檻" : "初步門檻（否決條件）";
  const badge = v1 ? `${gate.passedCount} / 5` : gate.status === "PASS" ? "皆未觸發" : fired ? `觸發 ${fired} 項` : "待確認";
  return `<section class="research-gates" aria-labelledby="research-gates-title"><h3 id="research-gates-title">${heading} <small class="${gate.status === "FAIL" ? "fail" : ""}">${badge}</small></h3>${inputs}<div class="research-gate-tiles">${tiles}</div><div class="research-gate-panels">${panels}</div>${gate.status === "PASS" ? '<p class="research-gate-hint">點選圖示查看計算方式。</p>' : ""}</section>`;
}

/** Prices and the signal date to mark on the price chart, when a plan exists. */
export function researchChartMarks(result) {
  const plan = result?.nextDayPlan, signal = result?.entryResearch?.signal;
  if (!plan || !Number.isFinite(plan.entryReferencePrice)) return signal ? { signalDate: signal.date, lines: [] } : null;
  return { signalDate: signal?.date ?? null, lines: [
    { key: "entry", label: "進場參考", value: plan.entryReferencePrice },
    { key: "upper", label: "價格上限", value: plan.entryPriceUpper },
    { key: "invalidation", label: "失效價", value: plan.invalidationPrice },
  ] };
}
