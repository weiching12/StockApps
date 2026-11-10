import { entryResearchSummary } from "../../shared/entry-research.js";
import { institutionalScoreBreakdown } from "../../shared/entry-score.js";
import { isEtf } from "../../shared/market-codec.js";
import { ENTRY_RESEARCH_MODEL, ENTRY_RESEARCH_STATUS_LABELS, NEXT_DAY_STATUS_LABELS, SETUP_LABELS } from "../../shared/entry-research-model.js";

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
const NEXT_SHORT = { PRICE_TOO_HIGH: "超出容許範圍", DATA_INSUFFICIENT: "資料不足" };
// A triggered signal is not an entry by itself: the list names the next-session outcome instead.
const TRIGGERED_CHIP = { NEXT_DAY_CANDIDATE: ["明日可進場", "positive"], PRICE_TOO_HIGH: ["訊號觸發・不進場", "warning"],
  DATA_INSUFFICIENT: ["訊號觸發・資料不足", "muted"] };
const SETUP_SHORT = { PULLBACK_RECOVERY: "回踩恢復", RANGE_BREAKOUT: "區間突破" };
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

/** ETFs have no research status, so the phone market card shows their close and change in its place. */
function etfPriceCell(stock, number) {
  const close = stock.latest?.close, change = stock.latest?.changePercent;
  const tone = change > 0 ? "up" : change < 0 ? "down" : "";
  const price = Number.isFinite(close) ? `<span class="research-etf-price"><strong>${number(close, 2)}</strong>${Number.isFinite(change)
    ? `<span class="change-chip ${tone}">${change > 0 ? "+" : ""}${number(change, 2)}%</span>` : ""}</span>` : "";
  return price;
}

export function researchListCells(stock, esc, number) {
  const summary = researchSummaryOf(stock);
  const score = Number.isFinite(summary?.score) ? number(summary.score, 0) : "—";
  const gateTone = summary?.gateStatus === "PASS" ? "pass" : summary?.gateStatus === "FAIL" ? "fail" : "unknown";
  // ETFs are not researched: they say so instead of looking like missing data.
  const etf = !summary && isEtf(stock);
  const readiness = etf ? "" : `<button type="button" class="entry-score-button research-score-button" data-entry-score="${esc(stock.symbol)}" aria-label="查看${esc(stock.name)}進場研究"><strong>${score}</strong></button><small class="research-gate ${gateTone}">${esc(gateText(summary))}</small>`;
  const status = summary?.status, next = summary?.nextDayStatus;
  // A triggered signal's chip states the next-session outcome; the line under it (wide screens)
  // names why it is held back and the pattern, with the full wording on hover.
  const triggered = status === "TRIGGERED";
  const [chipText, chipTone] = triggered && TRIGGERED_CHIP[next] ? TRIGGERED_CHIP[next]
    : [ENTRY_RESEARCH_STATUS_LABELS[status] ?? "—", STATUS_TONE[status] ?? "muted"];
  const setup = triggered ? summary.setupType : null;
  const nextParts = triggered ? [NEXT_SHORT[next], SETUP_SHORT[setup]].filter(Boolean) : [];
  const nextLine = nextParts.length ? `<small class="research-next ${NEXT_TONE[next] ?? "muted"}" title="${esc([NEXT_DAY_STATUS_LABELS[next], SETUP_LABELS[setup]].filter(Boolean).join(" · "))}">${esc(nextParts.join(" · "))}</small>` : "";
  const research = summary
    ? `<span class="research-chip ${chipTone}">${esc(chipText)}</span>${nextLine}`
    : etf ? etfPriceCell(stock, number) : '<span class="research-chip muted">資料不足</span>';
  return { readiness, research };
}

/** The market menu: one choice per research stage, none containing another. Readiness bands are left
 * to the readiness sort; gatePass and triggered remain for the favorites page's own menu. */
export const RESEARCH_FILTERS = [
  ["all", "全部研究狀態"], ["candidate", "明日進場候選"], ["priceHigh", "價格超出容許範圍"],
  ["waiting", "等待進場訊號"], ["gateFail", "未通過初步門檻"],
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
    case "gateFail": return summary.gateStatus === "FAIL";
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

/**
 * How the structure component is built: the mean of the trend and institutional category scores,
 * each shown with its own inputs. Needs the per-stock score detail (categories and metrics).
 */
function structureHelp(research, stock, { esc, number, percent }) {
  const categories = stock.entryScore?.categories, metrics = stock.entryScore?.metrics;
  const trend = categories?.trend?.score, institutional = categories?.institutional?.score;
  if (!Number.isFinite(trend) || !Number.isFinite(institutional) || !metrics) return "";
  const mark = (met) => met ? "✓" : "✗";
  const checks = [["收盤價高於月線 MA20", metrics.close > metrics.ma20], ["月線高於季線 MA60", metrics.ma20 > metrics.ma60],
    ["月線較前一交易日上升", metrics.ma20 > metrics.previousMa20], ["季線較前一交易日上升", metrics.ma60 > metrics.previousMa60]];
  const met = checks.filter(([, ok]) => ok).length;
  const parts = institutionalScoreBreakdown(metrics.netRatio, metrics.institutionBuyDays, metrics.institutionPositiveCategories);
  const sector = stock.sector && !isEtf(stock)
    ? `<button type="button" class="outline-button" data-institution-sector="${esc(stock.symbol)}" aria-label="查看${esc(stock.name)}所屬${esc(stock.sector)}產業法人買賣">查看產業法人 ↗</button>` : "";
  return `<details class="research-structure-help"><summary>構面強度計算方式</summary>
    <p class="research-structure-formula">構面強度 = （趨勢 ${number(trend, 2)} ＋ 法人 ${number(institutional, 2)}）÷ 2 = <strong>${number(research.componentScores.structure, 2)}</strong></p>
    <section><h4>趨勢結構 ${number(trend, 2)} 分</h4><ul class="research-structure-checks">${checks.map(([label, ok]) => `<li><span aria-hidden="true">${mark(ok)}</span> ${label}</li>`).join("")}</ul>
      <p>均線條件 ${met} 項 × 20 ＋ 近五日收盤站上月線 ${metrics.fiveAboveMa20} 日 × 4 = ${number(met * 20 + metrics.fiveAboveMa20 * 4, 2)} 分</p></section>
    <section><h4>法人籌碼 ${number(institutional, 2)} 分</h4>
      <p>近五日外資、投信、自營商合計淨買賣超 ${number(metrics.institutionNet5, 0)} 股，占同期成交量 ${percent(metrics.netRatio * 100)}。</p>
      <ul><li>占比分數 50 ＋ 50 × 占比 ÷ 5%（0～100）= ${number(parts.ratioScore, 2)}，計入 60% = ${number(parts.ratioContribution, 2)} 分</li>
        <li>合計買超 ${metrics.institutionBuyDays} 日 × 5 = ${number(parts.dayContribution, 2)} 分</li>
        <li>累計買超法人 ${metrics.institutionPositiveCategories} 類 × 5 = ${number(parts.categoryContribution, 2)} 分</li></ul>${sector}</section>
    <p class="helper-text">兩項分數各占一半，只衡量趨勢與籌碼的強弱，不是門檻；門檻由上方否決條件判斷。</p></details>`;
}

/** The next-day card from the list's compact fields, shown at once while the full research loads. */
export function researchCardPreview(summary, { esc, number }) {
  const gate = { status: summary.gateStatus, passedCount: summary.gatePassed, conditions: summary.gateConditions ?? {} };
  // Same wording as the full card at the latest session, whose next date is not yet in the calendar.
  const canBuy = summary.nextDayStatus === "NEXT_DAY_CANDIDATE";
  return `<section class="research-plan-card ${NEXT_TONE[summary.nextDayStatus] ?? "muted"}" aria-labelledby="research-plan-title"><p class="research-eyebrow">明日進場評估</p><div class="research-plan-head"><h3 id="research-plan-title">下一交易日${canBuy ? "可進場" : "不進場"}</h3><span class="research-plan-status">${esc(NEXT_DAY_STATUS_LABELS[summary.nextDayStatus] ?? "—")}</span></div><dl class="research-plan-facts"><div><dt>初步門檻</dt><dd>${esc(gateSummary(gate, summary.modelVersion))}</dd></div><div><dt>進場準備度</dt><dd>${Number.isFinite(summary.score) ? `${number(summary.score, 0)} / 100` : "—"}</dd></div><div><dt>技術型態</dt><dd>${esc(SETUP_LABELS[summary.setupType] ?? "—")}</dd></div></dl></section>`;
}

/** Dialog sections in the required order, under the header and chart. */
export function researchDialogSections(result, stock, { esc, number, percent }) {
  const { gateResult: gate, entryResearch: research, nextDayPlan: plan, dataQuality: quality } = result;
  // Price, change and date already show in the header and chart above; only price-data warnings
  // (e.g. unadjusted prices around a dividend) stay here, once. Missing data is explained by the
  // pending gates themselves.
  const basic = quality.warnings.length
    ? `<section class="research-basic" aria-label="資料提醒"><div class="research-warning" role="note">${items(quality.warnings, esc, "")}</div></section>` : "";

  const reasons = research.status === "TRIGGERED" ? research.triggeredConditions : gate.status !== "PASS" ? gate.reasons : research.pendingConditions;
  const risks = research.riskWarnings.filter((warning) => !quality.warnings.includes(warning));
  const verdict = planVerdict(plan, { number });
  const card = `<section class="research-plan-card ${NEXT_TONE[plan.status] ?? "muted"}" aria-labelledby="research-plan-title"><p class="research-eyebrow">明日進場評估</p><div class="research-plan-head"><h3 id="research-plan-title">${esc(verdict.title)}</h3><span class="research-plan-status">${esc(plan.label)}</span>${NEXT_EXPLANATION[plan.status] ? `<details class="research-plan-help"><summary aria-label="${esc(plan.label)}的說明"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/></svg></summary><p role="note">${esc(NEXT_EXPLANATION[plan.status])}</p></details>` : ""}</div><p class="research-plan-basis">${esc(verdict.basis)}</p>${verdict.body}<dl class="research-plan-facts"><div><dt>初步門檻</dt><dd>${gateSummary(gate, result.modelVersion)}</dd></div><div><dt>進場準備度</dt><dd>${Number.isFinite(research.score) ? `${number(research.score, 0)} / 100` : "—"}</dd></div><div><dt>技術型態</dt><dd>${esc(research.setupLabel ?? "—")}</dd></div></dl>
    <details class="research-reasons"><summary>${research.status === "TRIGGERED" ? "主要成立原因" : "目前狀態原因"}</summary>${items(reasons, esc, "沒有額外說明。")}${risks.length ? `<h4>主要風險</h4>${items(risks, esc, "")}` : ""}</details>
</section>`;

  const component = (label, value, weight) => `<div class="research-component"><span>${label}<small>權重 ${weight}%</small></span><strong>${Number.isFinite(value) ? number(value, 0) : "—"}</strong><progress value="${Number.isFinite(value) ? value : 0}" max="100" aria-label="${label} ${Number.isFinite(value) ? number(value, 0) : "無資料"} 分"></progress></div>`;
  const readiness = `<section class="research-readiness" aria-labelledby="research-readiness-title"><h3 id="research-readiness-title">進場準備度</h3>${Number.isFinite(research.score)
    ? `<div class="research-readiness-body"><div class="research-readiness-score"><strong>${number(research.score, 0)}</strong><span>/ 100</span></div><div class="research-components">${component(isV1(result.modelVersion) ? "五大構面強度" : "構面強度（趨勢＋法人）", research.componentScores.structure, research.weights.structure)}${component("進場訊號品質", research.componentScores.signal, research.weights.signal)}${component("進場位置與時機", research.componentScores.timing, research.weights.timing)}</div></div>${isV1(result.modelVersion) ? "" : structureHelp(research, stock, { esc, number, percent })}<div class="research-strengths"><div><h4>表現較好</h4>${items(research.strengths, esc, "沒有特別突出的構面。")}</div><div><h4>仍可改善</h4>${items(research.weaknesses, esc, "沒有明顯偏弱的構面。")}</div></div>`
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
      ["有效期間", validityText(signal.validSessions)]].map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>`
    : `<p><span class="research-chip ${STATUS_TONE[research.status] ?? "muted"}">${esc(research.label ?? "—")}</span></p>`}${signalRules(research, signal, esc)}</section>`;

  const planSection = riskSection(plan, signal, { esc, number });

  // Stocks that did not pass stage 1 have no readiness, signal or plan to show.
  const evaluated = gate.status === "PASS";
  const notice = evaluated ? "" : `<p class="research-not-evaluated">${gate.status === "FAIL" ? "未通過初步門檻，不評估進場準備度、訊號與價格計畫。" : "初步門檻資料待確認，暫不評估進場準備度、訊號與價格計畫。"}</p>`;
  return { basic, card, readiness, gates, signal: signalSection, plan: planSection, evaluated, notice };
}

const RISK_LIMIT = ENTRY_RESEARCH_MODEL.plan.maxRiskPercent, UPPER_ATR = ENTRY_RESEARCH_MODEL.plan.upperAtr;
const lossTo = (buy, stop) => Number.isFinite(buy) && Number.isFinite(stop) && buy > 0 ? (buy - stop) / buy * 100 : null;
// The next session as "11/10 " when the calendar already has it, else "下一交易日"; `within` pads it for
// mid-sentence use ("只看 11/10 開盤" / "只看下一交易日開盤").
const planDays = (plan) => {
  const date = plan.planExpiresAt ? shortDate(plan.planExpiresAt) : null;
  return { next: date ? `${date} ` : "下一交易日", within: date ? ` ${date} ` : "下一交易日", basis: plan.planAsOf ? shortDate(plan.planAsOf) : "今日" };
};

/**
 * What a user asks first: can I buy at the next open, and if so between which prices. Without a
 * candidate the card says why in one sentence, instead of showing prices that look usable.
 */
function planVerdict(plan, { number }) {
  const { next, within, basis } = planDays(plan);
  const money = (value) => price(value, number);
  const canBuy = plan.status === "NEXT_DAY_CANDIDATE";
  const title = `${next}${canBuy ? "可進場" : "不進場"}`;
  const basisText = `依 ${basis} 收盤、以固定研究規則判讀，非買賣指令`;
  if (canBuy) return { title, basis: basisText, body: `<dl class="research-buy-range"><div><dt>參考買入價</dt><dd>${money(plan.entryReferencePrice)}</dd></div><div><dt>最高價<small>開盤上限</small></dt><dd>${money(plan.entryPriceUpper)}</dd></div><div><dt>最低價<small>停損價</small></dt><dd>${money(plan.invalidationPrice)}</dd></div></dl><p class="research-plan-reason">只看${within}開盤價：高於 ${money(plan.invalidationPrice)} 且不高於 ${money(plan.entryPriceUpper)} 才成立；開盤高於最高價不追價，不高於停損價則計畫取消。</p>` };
  let reason = NEXT_EXPLANATION[plan.status] ?? "沒有有效的進場計畫。";
  if (plan.status === "PRICE_TOO_HIGH" && Number.isFinite(plan.entryPriceUpper))
    reason = plan.referenceClose > plan.entryPriceUpper
      ? `${basis} 收盤 ${money(plan.referenceClose)} 已高於可接受最高價 ${money(plan.entryPriceUpper)}，不追價。`
      : stopTooFar(plan, basis, money, number);
  return { title, basis: basisText, body: `<p class="research-plan-reason">${reason}</p>` };
}

/** Why a stop is too far, told from today's close; the open's upper limit only when the close alone fits. */
function stopTooFar(plan, basis, money, number) {
  const atClose = lossTo(plan.referenceClose, plan.invalidationPrice);
  const fromClose = `以 ${basis} 收盤價 ${money(plan.referenceClose)} 買進、跌到停損價 ${money(plan.invalidationPrice)} 會虧損 ${number(atClose, 2)}%`;
  return atClose > RISK_LIMIT
    ? `停損距離太遠：${fromClose}，超過單筆上限 ${RISK_LIMIT}%。`
    : `停損距離太遠：${fromClose}，但開盤若在上限 ${money(plan.entryPriceUpper)} 買進會虧損 ${number(plan.maxRiskPercent, 2)}%，超過單筆上限 ${RISK_LIMIT}%。`;
}

/** The risk check against its limit, then how every price and percentage is calculated, with numbers. */
function riskSection(plan, signal, { esc, number }) {
  const money = (value) => price(value, number);
  const heading = '<h3 id="research-price-plan-title">風險與計算方式</h3>';
  if (!Number.isFinite(plan.entryReferencePrice))
    return `<section class="research-price-plan" aria-labelledby="research-price-plan-title">${heading}<p class="research-empty">${esc(plan.reasons.at(-1) ?? "沒有有效的價格計畫。")}</p></section>`;
  const { within } = planDays(plan);
  const ok = plan.maxRiskPercent <= RISK_LIMIT;
  const atClose = lossTo(plan.referenceClose, plan.invalidationPrice);
  const maxBuy = plan.invalidationPrice / (1 - RISK_LIMIT / 100);
  const pullback = signal?.setupType === "PULLBACK_RECOVERY" && signal.evidence?.pullbackLow !== undefined;
  const breakout = signal?.setupType === "RANGE_BREAKOUT" && signal.evidence?.rangeHigh !== undefined;
  const atr = money(plan.atr14);
  const reference = pullback ? `訊號日收盤價 = ${money(plan.entryReferencePrice)}`
    : breakout ? `整理區間上緣 = ${money(plan.entryReferencePrice)}` : `訊號的進場參考價 = ${money(plan.entryReferencePrice)}`;
  const stop = pullback
    ? `回踩低點 ${money(signal.evidence.pullbackLow)} − ${ENTRY_RESEARCH_MODEL.pullback.invalidationAtr} × ATR14 ${atr} = ${money(plan.invalidationPrice)}`
    : breakout ? `max（區間上緣 ${money(signal.evidence.rangeHigh)} − ${ENTRY_RESEARCH_MODEL.breakout.invalidationAtr} × ATR14 ${atr}，區間下緣 ${money(signal.evidence.rangeLow)}）= ${money(plan.invalidationPrice)}`
      : `訊號的策略失效價 = ${money(plan.invalidationPrice)}`;
  const note = ok ? "" : `要讓停損虧損不超過 ${RISK_LIMIT}%，買入價需 ≤ ${money(maxBuy)}；規則只看${within}開盤是否落在區間內，不會等待回落後再買，此數字僅用來說明規則。`;
  return `<section class="research-price-plan" aria-labelledby="research-price-plan-title">${heading}<div class="research-risk-check ${ok ? "pass" : "fail"}"><div><span>以收盤價 ${money(plan.referenceClose)} 買進</span><strong class="${atClose > RISK_LIMIT ? "over" : ""}">${number(atClose, 2)}%</strong></div><div><span>以開盤上限 ${money(plan.entryPriceUpper)} 買進</span><strong class="${ok ? "" : "over"}">${number(plan.maxRiskPercent, 2)}%</strong></div><div><span>單筆虧損上限（標準）</span><strong>${RISK_LIMIT}%</strong></div><span class="research-risk-verdict">${ok ? "符合" : "超過上限"}</span></div><p class="research-risk-note">上面兩個百分比都是「買進後跌到停損價 ${money(plan.invalidationPrice)} 的虧損」；規則以開盤上限買進的最壞情況判定，須不超過 ${RISK_LIMIT}%。${note}</p><h4>計算方式</h4><ul class="research-formulas"><li><strong>參考買入價</strong>${reference}</li><li><strong>最高價（開盤上限）</strong>參考買入價 ${money(plan.entryReferencePrice)} ＋ ${UPPER_ATR} × ATR14 ${atr} = ${money(plan.entryPriceUpper)}</li><li><strong>最低價（停損價）</strong>${stop}；跌破代表原本的進場理由不成立</li><li><strong>停損虧損</strong>（買入價 − 停損價）÷ 買入價；以收盤價計：（${money(plan.referenceClose)} − ${money(plan.invalidationPrice)}）÷ ${money(plan.referenceClose)} = ${number(atClose, 2)}%；以開盤上限計：（${money(plan.entryPriceUpper)} − ${money(plan.invalidationPrice)}）÷ ${money(plan.entryPriceUpper)} = ${number(plan.maxRiskPercent, 2)}%</li><li><strong>單筆虧損上限 ${RISK_LIMIT}%</strong>研究模型的暫定參數：以開盤上限買進仍須在 ${RISK_LIMIT}% 內停損，用來排除停損距離過遠的訊號；尚未經歷史回測驗證</li><li><strong>ATR14</strong>近 14 個交易日的平均真實波動幅度 = ${atr}</li><li><strong>計畫有效</strong>僅${within}開盤</li></ul></section>`;
}

const validityText = (sessions) => sessions === 1 ? "僅訊號日當天" : `觸發日起 ${sessions} 個交易日`;

/**
 * How the system judges a signal, then both patterns with every condition and today's result.
 * The pattern behind an existing signal is shown as judged on its signal day.
 */
function signalRules(research, signal, esc) {
  const validity = signal?.validSessions ?? ENTRY_RESEARCH_MODEL.signal.validSessions;
  const steps = ["系統每個交易日收盤後，檢查下列兩種型態。", "「形成條件」全部成立，代表型態已出現。", "之後「觸發條件」也全部成立的那一天就是訊號日（進場訊號已觸發）。", ...(validity === 1
    ? ["訊號只在訊號日當天有效：當晚依收盤產生明日進場候選。", "下一個交易日起為「訊號已過期」，需等待新的訊號。", "之後收盤跌破策略失效價，標示為「訊號失效」。"]
    : [`訊號自訊號日起 ${validity} 個交易日內有效，超過為「訊號已過期」。`, "有效期間內收盤跌破策略失效價，標示為「訊號失效」。"])];
  const how = `<details class="research-plan-help research-signal-how"><summary><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/></svg>判定方式</summary><ol role="note">${steps.map((step) => `<li>${step}</li>`).join("")}</ol></details>`;
  const setups = (research.setups ?? []).map((today) => {
    const fromSignal = signal?.setupType === today.setupType;
    const checks = fromSignal ? signal.checks : today.checks;
    const basis = fromSignal ? signal.date : today.date;
    const missing = checks.filter((check) => !check.met);
    const state = !fromSignal && today.unavailable ? "資料不足，無法判斷"
      : fromSignal ? `${shortDate(signal.date)} 觸發`
        : today.triggered ? "今日觸發" : today.formed ? `已形成，還差 ${missing.length} 項` : "未形成";
    const tone = fromSignal || today.triggered ? "positive" : today.formed ? "neutral" : "muted";
    const list = (stage) => checks.filter((check) => check.stage === stage).map((check) =>
      `<li class="${check.met ? "met" : "unmet"}"><span aria-hidden="true">${check.met ? "✓" : "✗"}</span><div>${esc(check.text)}<span class="research-sr">${check.met ? "，已成立" : "，未成立"}</span>${check.detail ? `<small>${esc(check.detail)}</small>` : ""}</div></li>`).join("");
    const body = today.unavailable && !fromSignal ? '<p class="research-empty">必要的均線、KD 或 ATR 資料不足。</p>'
      : `<p class="research-setup-basis">依 ${esc(shortDate(basis))} 收盤判定</p><h4>形成條件</h4><ul class="research-checks">${list("setup")}</ul><h4>觸發條件</h4><ul class="research-checks">${list("trigger")}</ul>`;
    return `<details class="research-setup"><summary><strong>${esc(SETUP_LABELS[today.setupType])}</strong><span class="research-setup-state ${tone}">${state}</span></summary>${body}</details>`;
  }).join("");
  return `${how}${setups ? `<div class="research-setups">${setups}</div>` : ""}`;
}

const shortDate = (date) => String(date).slice(5).replace("-", "/");

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
  if (!plan || !Number.isFinite(plan.entryReferencePrice)) return null;
  return { lines: [
    { key: "entry", label: "進場參考", short: "進場", value: plan.entryReferencePrice },
    { key: "upper", label: "價格上限", short: "上限", value: plan.entryPriceUpper },
    { key: "invalidation", label: "失效價", short: "失效", value: plan.invalidationPrice },
  ] };
}
