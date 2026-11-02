import { activeResearchPeriod } from "./research-store.js";
import { reviewInitialScore, reviewTrackingTimeline } from "../../shared/research-review.js";
import { researchPriceChart } from "./research-review.js";
import { researchComparisonMarkup } from "./research-comparison.js";

const fmt = (value) => Number.isFinite(value) ? value.toFixed(2) : "—";
const delta = (value) => Number.isFinite(value) ? `${value > 0 ? "+" : ""}${fmt(value)}` : "—";
const tone = (value) => value > 0 ? "up" : value < 0 ? "down" : "neutral";
const dateTime = (value) => value ? new Date(value).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }) : "原始加入時間未知";
const important = (row) => (row?.comparison?.events ?? []).some((event) => event.type !== "base-score-change");
const categoryLabels = { trend: "趨勢", momentum: "KD", priceVolume: "量價", institutional: "法人", entryRisk: "進場風險" };

function directionalChanges(initial, latest, change) {
  const direction = Math.abs(change) < .005 ? 0 : Math.sign(change);
  if (!direction) return [{ key: "unchanged", label: "分數持平", tone: "neutral" }];
  const changes = Object.entries(categoryLabels).flatMap(([key, name]) => {
    const before = initial.conditions?.[key]?.status, after = latest.conditions?.[key]?.status;
    if (before === "FAIL" && after === "PASS" && direction > 0)
      return [{ key, label: `${name}條件改善`, tone: "up", priority: 0, amount: 0 }];
    if (before === "PASS" && after === "FAIL" && direction < 0)
      return [{ key, label: `${name}條件失效`, tone: "down", priority: 0, amount: 0 }];
    const previous = initial.categories?.[key]?.creditedContribution, current = latest.categories?.[key]?.creditedContribution;
    const contribution = Number.isFinite(previous) && Number.isFinite(current) ? current - previous : null;
    return Number.isFinite(contribution) && Math.abs(contribution) >= .005 && Math.sign(contribution) === direction
      ? [{ key, label: `${name}條件${direction > 0 ? "提高" : "下降"}`, tone: tone(direction), priority: 1, amount: Math.abs(contribution) }] : [];
  });
  const beforeCap = initial.cap?.enabled, afterCap = latest.cap?.enabled;
  const capDirection = beforeCap && !afterCap ? 1 : !beforeCap && afterCap ? -1 : beforeCap && afterCap
    ? Math.sign(latest.cap.value - initial.cap.value) : 0;
  if (capDirection === direction) changes.push({ key: "cap", label: afterCap ? `分數上限${!beforeCap ? "啟用" : direction > 0 ? "提高" : "下修"}` : "分數上限解除", tone: tone(direction), priority: 0, amount: 0 });
  return changes.length ? changes.sort((a, b) => a.priority - b.priority || b.amount - a.amount)
    : [{ key: "score", label: `分數${direction > 0 ? "提高" : "下降"}`, tone: tone(direction) }];
}

export function researchCardTrend(period, row) {
  const latest = row?.latest;
  const result = reviewInitialScore(period, latest);
  const initial = result.initial;
  if (!initial) return { status: "missing-initial", label: "收藏後變化", reason: "收藏基準未知，無法比較" };
  const label = period?.addedSnapshot?.valid ? "自收藏後" : "自首次有效評分起";
  if (!latest?.valid) return { status: "missing-latest", label };
  if (!["comparable", "same-snapshot"].includes(result.status))
    return { status: result.status, label, reason: result.status === "incompatible" ? "設定不同，暫不比較" : "資料不足，暫不比較" };
  const badges = result.status === "same-snapshot" || initial.asOf === latest.asOf
    ? [{ key: "waiting", label: "等待後續交易日評分", tone: "neutral" }]
    : directionalChanges(initial, latest, result.finalDelta);
  return { status: result.status, label, initial, latest, delta: result.finalDelta, reason: badges[0].label, badges };
}

export function researchCardPrice(period, row, stock, asOf = row?.latest?.asOf) {
  const positive = value => Number.isFinite(value) && value > 0;
  const latest = row?.latest?.asOf === asOf ? row.latest : null;
  const close = positive(latest?.close) ? latest.close : stock?.latest?.date === asOf && positive(stock.latest.close) ? stock.latest.close : null;
  // Snapshot.close is the observed closing price, even when scoring adjusts earlier bars.
  const joined = period?.addedSnapshot;
  const baseline = period?.baseline ?? (positive(joined?.close) ? { asOf: joined.asOf, close: joined.close, priceBasis: "unadjusted" } : null);
  if (!close) return { close: null, delta: null, asOf, reason: "當日收盤價不足" };
  if (!positive(baseline?.close) || !baseline.asOf) return { close, delta: null, asOf, reason: "收藏價格未保存，無法比較" };
  if (baseline.asOf > asOf || baseline.priceBasis && baseline.priceBasis !== "unadjusted")
    return { close, delta: null, asOf, reason: "收藏價格日期或基準不一致，無法比較" };
  return { close, delta: close - baseline.close, asOf, baseline };
}

function scoreChart(history) {
  const points = [...history].filter((item) => item.valid && Number.isFinite(item.finalScore))
    .sort((a, b) => a.asOf.localeCompare(b.asOf));
  const heading = '<div class="research-chart-heading"><details class="research-chart-info"><summary aria-label="個股歷史評分說明"><span aria-hidden="true">ⓘ</span></summary><p>顯示這檔股票各交易日可取得的株研評分，觀察研究條件符合程度如何變化。可能包含收藏前的評分；沒有可用分數的日期不列入圖表。</p></details><h4>個股歷史評分</h4></div>';
  if (!points.length) return `<div class="research-chart">${heading}<p class="research-muted">目前沒有可繪製的有效評分。</p></div>`;
  const line = (key, color) => {
    let segments = [], current = [];
    points.forEach((item, index) => {
      if (!item.valid || !Number.isFinite(item[key]) ||
          (index && (["modelVersion", "configId", "priceBasis"].some((field) => item[field] !== points[index - 1][field]) || item.source !== points[index - 1].source))) {
        if (current.length > 1) segments.push(current);
        current = [];
      }
      if (item.valid && Number.isFinite(item[key])) current.push(`${8 + index * 284 / Math.max(1, points.length - 1)},${106 - item[key] * .9}`);
    });
    if (current.length > 1) segments.push(current);
    return segments.map((segment) => `<polyline points="${segment.join(" ")}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>`).join("");
  };
  const last = points.at(-1);
  const markers = points.map((point, index) => point.cap?.enabled && point.valid
    ? `<circle cx="${8 + index * 284 / Math.max(1, points.length - 1)}" cy="${106 - point.finalScore * .9}" r="3" fill="#e19971"><title>${point.asOf} · 上限 ${point.cap.value}</title></circle>` : "").join("");
  const singleMarker = points.length === 1 ? `<circle cx="8" cy="${106 - last.finalScore * .9}" r="3" fill="#6a9cff"><title>${last.asOf} · ${fmt(last.finalScore)} 分</title></circle>` : "";
  return `<div class="research-chart">${heading}<p class="research-score-readout" aria-live="polite">${last.asOf} · ${fmt(last.finalScore)} 分${last.cap?.enabled ? ` · 上限 ${fmt(last.cap.value)}` : ""}${last.source === "historical-recalculation" ? " · 歷史重算" : ""}</p>${points.length === 1 ? '<p class="research-muted">目前只有一筆有效評分，尚無跨日變化。</p>' : ""}<div class="research-score-plot" role="slider" tabindex="0" aria-label="分數歷史；點選或水平拖曳查看" aria-valuemin="1" aria-valuemax="${points.length}" aria-valuenow="${points.length}" data-points="${encodeURIComponent(JSON.stringify(points.map((point) => ({ date: point.asOf, finalScore: point.finalScore ?? null, cap: point.cap ?? null, source: point.source ?? null }))))}"><svg viewBox="0 0 300 116" preserveAspectRatio="none" aria-hidden="true"><path d="M8 16H292M8 61H292M8 106H292" stroke="currentColor" opacity=".15"/>${line("finalScore", "#6a9cff")}${markers}${singleMarker}<line class="cursor" x1="${points.length === 1 ? 8 : 292}" x2="${points.length === 1 ? 8 : 292}" y1="16" y2="106"/></svg></div><div><span>${points[0].asOf}</span><span>${points.length > 1 ? "圓點：分數上限" : "僅一筆有效評分"}</span><span>${points.at(-1).asOf}</span></div></div>`;
}

export function selectResearchScorePoint(plot, index) {
  const points = JSON.parse(decodeURIComponent(plot.dataset.points));
  const selected = Math.max(0, Math.min(points.length - 1, index));
  const point = points[selected];
  plot.setAttribute("aria-valuenow", String(selected + 1));
  const x = String(8 + selected * 284 / Math.max(1, points.length - 1));
  plot.querySelector(".cursor")?.setAttribute("x1", x);
  plot.querySelector(".cursor")?.setAttribute("x2", x);
  plot.closest(".research-chart").querySelector(".research-score-readout").textContent =
    `${point.date} · ${fmt(point.finalScore)} 分${point.cap?.enabled ? ` · 上限 ${fmt(point.cap.value)}` : ""}${point.source === "historical-recalculation" ? " · 歷史重算" : ""}`;
}

export function renderResearchCenter({ favorites, stocks, rows, store, date, sort, filter, esc }) {
  const bySymbol = new Map(stocks.map((stock) => [stock.symbol, stock]));
  const values = favorites.map((symbol) => ({ symbol, stock: bySymbol.get(symbol), row: rows.get(symbol),
    trend: researchCardTrend(activeResearchPeriod(store, symbol), rows.get(symbol)) }));
  const comparable = values.filter(({ trend }) => trend.status === "comparable" && trend.initial.asOf !== trend.latest.asOf);
  const increased = comparable.filter(({ trend }) => trend.delta > 0).length;
  const changed = new Set(values.filter(({ row }) => important(row)).map(({ symbol }) => symbol)).size;
  const filtered = values.filter(({ row }) => filter === "all" || filter === "important" && important(row) ||
    filter === "improved" && row?.comparison?.conditionsImproved || filter === "lost" && row?.comparison?.conditionsLost);
  filtered.sort((a, b) => {
    const av = sort === "change" ? a.trend.status === "comparable" && a.trend.initial.asOf !== a.trend.latest.asOf ? a.trend.delta : null : a.row?.latest?.valid ? a.row.latest.finalScore : null;
    const bv = sort === "change" ? b.trend.status === "comparable" && b.trend.initial.asOf !== b.trend.latest.asOf ? b.trend.delta : null : b.row?.latest?.valid ? b.row.latest.finalScore : null;
    return av === null && bv === null ? a.symbol.localeCompare(b.symbol) : av === null ? 1 : bv === null ? -1 : bv - av || a.symbol.localeCompare(b.symbol);
  });
  const entries = filtered.map(({ symbol, stock, row, trend }) => {
    const snap = row?.latest;
    const label = stock?.name ?? symbol;
    const condition = snap?.valid ? `${snap.passedCount}/${snap.totalConditions} 必要條件通過` : "必要資料不足";
    const comparableTrend = trend.status === "comparable" && trend.initial.asOf !== trend.latest.asOf;
    const changeValue = comparableTrend ? delta(trend.delta) : "—";
    const baseline = trend.initial ? `${trend.initial.asOf} ${fmt(trend.initial.finalScore)} 分` : "尚無收藏基準";
    const changeDetail = `${trend.label}：${baseline} → ${snap?.asOf ?? "—"} ${fmt(snap?.finalScore)} 分；${trend.reason ?? ""}`;
    const price = researchCardPrice(activeResearchPeriod(store, symbol), row, stock, date);
    const priceDetail = price.baseline ? `收藏基準 ${price.baseline.asOf} ${fmt(price.baseline.close)} → ${price.asOf} ${fmt(price.close)}；未還原收盤價差，未計股息，不代表投資損益` : price.reason;
    const sectorBadge = stock?.sector ? `<span class="research-sector-badge" title="${esc(stock.sector)}">${esc(stock.sector)}</span>` : "";
    const reason = row?.loading ? "讀取研究快照中" : trend.reason ?? "缺少當日評分快照";
    const badges = row?.loading ? [{ label: reason, tone: "neutral" }] : trend.badges ?? [{ label: reason, tone: "neutral" }];
    const badgesMarkup = `<span class="research-change-badges">${badges.map(badge => `<span class="research-change-badge ${badge.tone}">${esc(badge.label)}</span>`).join("")}</span>`;
    const conditionText = `${condition}${snap?.cap?.enabled ? ` · 上限 ${fmt(snap.cap.value)}` : ""}`;
    return `<tr class="research-card" data-research-symbol="${esc(symbol)}" data-entry-score="${esc(symbol)}"><th scope="row"><button type="button" class="research-card-main" data-entry-score="${esc(symbol)}" aria-label="查看 ${esc(symbol)} ${esc(label)} 株研評分"><span class="research-stock"><span class="research-stock-head"><span class="research-code">${esc(symbol)}</span><strong>${esc(label)}</strong>${sectorBadge}</span>${row?.source === "historical-recalculation" ? "<small>模擬重算</small>" : ""}</span></button><span class="research-stock-badges">${badgesMarkup}</span></th><td class="research-score"><strong>${fmt(snap?.finalScore)}</strong><small class="research-score-change ${tone(comparableTrend ? trend.delta : null)}" title="${esc(changeDetail)}" aria-label="${esc(trend.label)}評分變化 ${esc(changeValue)}">${changeValue}</small></td><td class="research-price"><strong aria-label="${esc(price.asOf ?? "")} 收盤價 ${fmt(price.close)}">${fmt(price.close)}</strong><small class="research-price-change ${tone(price.delta)}" title="${esc(priceDetail)}" aria-label="自收藏後股價差異 ${delta(price.delta)}">${delta(price.delta)}</small></td><td class="research-condition ${snap?.valid ? "" : "insufficient"}">${esc(conditionText)}</td><td class="research-summary">${badgesMarkup}</td></tr>`;
  }).join("");
  const stat = (label, value, note, tone = "") => `<div class="research-stat"><span class="research-stat-label">${label}</span><strong class="${tone}">${value}<small>檔</small></strong><span class="research-stat-note">${note}</span></div>`;
  return { stats: stat("追蹤股票", favorites.length, `${comparable.length} 檔可比較`) +
      stat("分數提高", increased, comparable.length ? "較收藏時" : "尚無可比較", increased ? "up" : "") +
      stat("重要異動", changed, `共 ${favorites.length} 檔追蹤`),
    cards: entries ? `<table class="research-table"><thead><tr><th scope="col">股票</th><th scope="col">分數</th><th scope="col">股價</th><th scope="col">必要條件</th><th scope="col">最新異動</th></tr></thead><tbody>${entries}</tbody></table>`
      : `<p class="research-muted">${favorites.length ? "此篩選目前沒有股票。" : "尚無追蹤股票。"}</p>` };
}

function researchDetailMarkupV2({ symbol, row, store, esc }) {
  if (!store) return "";
  const period = activeResearchPeriod(store, symbol);
  if (!period) return "";
  const snap = row?.latest;
  const comparison = row?.comparison;
  const comparisonNotice = ["missing-current", "missing-previous"].includes(comparison?.status)
    ? `<p class="research-muted">${esc(comparison.summary)}</p>` : "";
  const timeline = reviewTrackingTimeline(period, row);
  const categoryNames = { trend: "趨勢結構", momentum: "KD 動能", priceVolume: "量價表現",
    institutional: "法人籌碼", entryRisk: "進場位置與風險" };
  const changes = comparison?.categoryDeltas;
  const settings = snap?.settings;
  const priceBasis = { unadjusted: "未還原", "reference-adjusted": "除息參考價調整", adjusted: "已還原" }[snap?.priceBasis] ?? snap?.priceBasis ?? "—";
  const categoryMarkup = snap?.valid ? `<details class="research-breakdown research-category-changes"><summary>構面較前期變化</summary><p class="research-muted">${comparison?.dates?.length === 2 ? `${esc(comparison.dates[0])} → ${esc(comparison.dates[1])}` : esc(comparison?.summary ?? "尚無可比較的前期快照")}</p><dl class="research-category-deltas">${Object.entries(categoryNames).map(([key, name]) =>
    `<div><dt>${name}</dt><dd class="${tone(changes?.[key])}">${Number.isFinite(changes?.[key]) ? `${delta(changes[key])} 分` : "—"}</dd></div>`).join("")}</dl></details>
    <details class="research-breakdown research-version"><summary>模型與資料版本</summary><dl class="research-facts"><div><dt>模型</dt><dd>${esc(snap.modelVersion ?? "—")}</dd></div><div><dt>KD 設定</dt><dd>${settings ? [settings.period, settings.kSmooth, settings.dSmooth].map(value => esc(value ?? "—")).join(" / ") : "—"}</dd></div><div><dt>價格基準</dt><dd>${esc(priceBasis)}</dd></div><div><dt>資料取得時間</dt><dd>${esc(dateTime(snap.capturedAt))}</dd></div>${snap.cap?.enabled ? `<div><dt>分數上限</dt><dd>${fmt(snap.cap.value)} 分 · ${esc(snap.cap.reason ?? "")}</dd></div>` : ""}<div class="research-version-id"><dt>版本識別</dt><dd><code>${esc(snap.revisionId ?? "—")}</code></dd></div></dl></details>` : "";
  const timelineMarkup = timeline.comparisons.length ? `<ol class="research-events">${timeline.comparisons.map(item => {
    const summary = item.status === "comparable" ? item.finalDelta === 0 ? "分數持平" : `分數${item.finalDelta > 0 ? "提高" : "下降"} ${fmt(Math.abs(item.finalDelta))} 分` : item.summary;
    const reasons = item.events.filter(event => !["final-score-change", "base-score-change"].includes(event.type));
    return `<li><time>${esc(item.fromDate)} → ${esc(item.toDate)}</time><span>${esc(summary)}</span>${reasons.length ? `<ul>${reasons.map(event => `<li>${esc(event.reason)}</li>`).join("")}</ul>` : ""}</li>`;
  }).join("")}</ol>` : "";
  const trackingScore = period.addedSnapshot?.valid && Number.isFinite(period.addedSnapshot.finalScore)
    ? `${esc(period.addedSnapshot.asOf)} · ${fmt(period.addedSnapshot.finalScore)} 分`
    : period.addedSnapshot ? "追蹤時資料不足" : "追蹤時評分未保存";
  return `<section class="entry-evidence research-detail"><h3>研究追蹤</h3>${comparisonNotice}<dl class="research-facts research-tracking-facts"><div><dt>追蹤時間</dt><dd>${period.startedAt ? esc(dateTime(period.startedAt)) : "追蹤時間未知"}</dd></div><div><dt>追蹤時評分</dt><dd>${trackingScore}</dd></div></dl>${scoreChart(row?.history ?? [])}${categoryMarkup}${timelineMarkup ? `<h4>研究事件時間軸</h4>${timelineMarkup}` : ""}</section>`;
}

export function researchDetailMarkup({ symbol, row, store, esc }) {
  const base = researchDetailMarkupV2({ symbol, row, store, esc });
  const period = activeResearchPeriod(store, symbol);
  if (!base || !period) return base;
  const review = `<section class="research-review-detail">${researchPriceChart(period, row, esc)}${researchComparisonMarkup(period, row, esc)}</section>`;
  return base.replace(/<\/section>$/, `${review}</section>`);
}
