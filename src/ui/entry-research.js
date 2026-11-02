import { entryResearchSummary } from "../../shared/entry-research.js";
import { ENTRY_RESEARCH_STATUS_LABELS, NEXT_DAY_STATUS_LABELS, SETUP_LABELS } from "../../shared/entry-research-model.js";

// Presentation of entry research results. Every value comes from shared/entry-research.js
// (server summary/analysis, or the same module in demo mode); nothing is recomputed here.

const GATE_LABELS = { trend: "趨勢結構", momentum: "KD 動能", priceVolume: "量價表現", institutional: "法人籌碼", entryRisk: "基礎價格風險" };
const GATE_STATUS = { PASS: ["通過", "pass"], FAIL: ["未通過", "fail"], UNKNOWN: ["資料不足", "unknown"] };
const STATUS_TONE = { TRIGGERED: "positive", WAIT_TRIGGER: "neutral", SIGNAL_EXPIRED: "muted", SIGNAL_INVALIDATED: "negative",
  DATA_INSUFFICIENT: "muted", NOT_ELIGIBLE: "muted" };
const NEXT_TONE = { NEXT_DAY_CANDIDATE: "positive", WAIT_TRIGGER: "neutral", PRICE_TOO_HIGH: "warning",
  PLAN_INVALIDATED: "negative", DATA_INSUFFICIENT: "muted", NOT_ELIGIBLE: "muted" };
const DATA_LABELS = { close: "收盤價", ma20: "MA20", ma60: "MA60", previousMa20: "前日 MA20", previousMa60: "前日 MA60",
  k: "K", d: "D", previousK: "前日 K", dayBeforeK: "前二日 K", changePercent: "漲跌幅 %", rvol20: "RVOL20",
  institutionalNet5: "近五日法人淨額（股）", deviation20: "MA20 乖離 %", previous10Low: "前十日最低價", atr14: "ATR14" };

/** Compact fields for lists, from either the summary API or a full result (demo/analysis). */
export const researchSummaryOf = (stock) => stock?.entryResearch?.gateResult
  ? entryResearchSummary(stock.entryResearch) : stock?.entryResearch ?? null;

const gateText = (summary) => !summary ? "—" : summary.gateStatus === "UNKNOWN"
  ? `門檻 ${summary.gatePassed}/5 待確認` : `門檻 ${summary.gatePassed}/5`;

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
  ["all", "全部研究狀態"], ["gatePass", "五大門檻全部通過"], ["triggered", "進場訊號已觸發"],
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
  WAIT_TRIGGER: "五大門檻已通過，但尚未出現有效的進場訊號，暫不建立價格計畫。",
  PRICE_TOO_HIGH: "訊號已出現，但價格或風險已超出計畫容許範圍，避免直接追價。",
  PLAN_INVALIDATED: "收盤已跌破策略失效價，原進場計畫失效。",
  DATA_INSUFFICIENT: "必要資料不足或尚待查核，無法建立可靠的進場計畫。",
  NOT_ELIGIBLE: "五大核心門檻未全部通過，不進行進場評估。",
};

/** Dialog sections in the required order; the chart and the V1.2 detail follow them. */
export function researchDialogSections(result, stock, { esc, number, percent }) {
  const { gateResult: gate, entryResearch: research, nextDayPlan: plan, dataQuality: quality } = result;
  const latest = stock.latest ?? {};
  const qualityLabel = quality.status === "VALID" ? "資料完整" : quality.status === "WARNING" ? "資料有提醒" : "資料不足";
  const basic = `<section class="research-basic" aria-label="個股基本資訊"><div class="research-basic-price"><strong>${price(latest.close ?? plan.referenceClose, number)}</strong><span class="${latest.changePercent > 0 ? "up" : latest.changePercent < 0 ? "down" : ""}">${Number.isFinite(latest.change) ? `${latest.change > 0 ? "+" : ""}${number(latest.change, 2)}` : ""} ${Number.isFinite(latest.changePercent) ? percent(latest.changePercent) : ""}</span></div><dl><div><dt>資料日期</dt><dd>${esc(result.asOf)}</dd></div><div><dt>資料品質</dt><dd class="research-quality ${quality.status.toLowerCase()}">${qualityLabel}</dd></div></dl>${quality.warnings.length || quality.missing.length ? `<div class="research-warning" role="note">${items([...quality.missing, ...quality.warnings], esc, "")}</div>` : ""}</section>`;

  const reasons = research.status === "TRIGGERED" ? research.triggeredConditions : gate.status !== "PASS" ? gate.reasons : research.pendingConditions;
  const card = `<section class="research-plan-card ${NEXT_TONE[plan.status] ?? "muted"}" aria-labelledby="research-plan-title"><p class="research-eyebrow">明日進場評估 · 依 ${esc(plan.planAsOf)} 收盤</p><h3 id="research-plan-title">${esc(plan.label)}</h3><p>${esc(NEXT_EXPLANATION[plan.status] ?? "")}</p><dl class="research-plan-facts"><div><dt>進場準備度</dt><dd>${Number.isFinite(research.score) ? `${number(research.score, 0)} / 100` : "—"}</dd></div><div><dt>五大門檻</dt><dd>${gate.passedCount} / 5${gate.status === "UNKNOWN" ? "（待確認）" : ""}</dd></div><div><dt>進場策略</dt><dd>${esc(research.setupLabel ?? "—")}</dd></div><div><dt>訊號日</dt><dd>${esc(research.signal?.date ?? "—")}</dd></div></dl>
    <details class="research-reasons"${plan.status === "NEXT_DAY_CANDIDATE" ? " open" : ""}><summary>${research.status === "TRIGGERED" ? "主要成立原因" : "目前狀態原因"}</summary>${items(reasons, esc, "沒有額外說明。")}${research.riskWarnings.length ? `<h4>主要風險</h4>${items(research.riskWarnings, esc, "")}` : ""}${plan.conditionsToConfirm.length ? `<h4>明日需確認</h4>${items(plan.conditionsToConfirm, esc, "")}` : ""}</details>
    ${plan.requiresPriceConfirmation && plan.status === "NEXT_DAY_CANDIDATE" ? '<p class="research-confirm">等待實際價格確認：目前沒有即時行情，以下一交易日實際開盤價判斷是否仍符合計畫。</p>' : ""}</section>`;

  const component = (label, value, weight) => `<div class="research-component"><span>${label}<small>權重 ${weight}%</small></span><strong>${Number.isFinite(value) ? number(value, 0) : "—"}</strong><progress value="${Number.isFinite(value) ? value : 0}" max="100" aria-label="${label} ${Number.isFinite(value) ? number(value, 0) : "無資料"} 分"></progress></div>`;
  const readiness = `<section class="research-readiness" aria-labelledby="research-readiness-title"><h3 id="research-readiness-title">進場準備度</h3>${Number.isFinite(research.score)
    ? `<div class="research-readiness-body"><div class="research-readiness-score"><strong>${number(research.score, 0)}</strong><span>/ 100</span></div><div class="research-components">${component("五大構面強度", research.componentScores.structure, research.weights.structure)}${component("進場訊號品質", research.componentScores.signal, research.weights.signal)}${component("進場位置與時機", research.componentScores.timing, research.weights.timing)}</div></div><div class="research-strengths"><div><h4>表現較好</h4>${items(research.strengths, esc, "沒有特別突出的構面。")}</div><div><h4>仍可改善</h4>${items(research.weaknesses, esc, "沒有明顯偏弱的構面。")}</div></div>`
    : `<p class="research-empty">${gate.status === "FAIL" ? "五大核心門檻未全部通過，不計算進場準備度。" : "資料不足，無法計算進場準備度。"}</p>`}<p class="helper-text">衡量進場準備程度供股票之間比較，不是獲利機率或買進指令；權重為暫定、尚未經歷史回測驗證。</p></section>`;

  const gates = `<section class="research-gates" aria-labelledby="research-gates-title"><h3 id="research-gates-title">五大核心門檻 <small>${gate.passedCount} / 5</small></h3><ol>${Object.entries(gate.details).map(([key, item]) => {
    const [label, tone] = GATE_STATUS[item.status] ?? GATE_STATUS.UNKNOWN;
    const data = Object.entries(item.data ?? {}).filter(([, value]) => value !== null && value !== undefined)
      .map(([name, value]) => `<div><dt>${esc(DATA_LABELS[name] ?? name)}</dt><dd>${Number.isFinite(value) ? number(value, 2) : esc(value)}</dd></div>`).join("");
    return `<li class="research-gate-item ${tone}"><div class="research-gate-head"><strong>${GATE_LABELS[key]}</strong><span class="research-gate-status ${tone}">${label}</span></div><p>${esc(item.reason)}</p><details><summary>門檻條件與實際數據</summary><p class="research-rule">${esc(item.rule)}</p>${data ? `<dl>${data}</dl>` : ""}</details></li>`;
  }).join("")}</ol>${gate.reasons.filter((reason) => !Object.values(GATE_LABELS).some((label) => reason.startsWith(label))).length
    ? `<div class="research-warning" role="note">${items(gate.reasons.filter((reason) => !Object.values(GATE_LABELS).some((label) => reason.startsWith(label))), esc, "")}</div>` : ""}</section>`;

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

  return { basic, card, readiness, gates, signal: signalSection, plan: planSection };
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
