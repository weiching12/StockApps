const list = (items, esc, empty) => items.length
  ? `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : `<p>${empty}</p>`;
const guideItem = (index, title, content) =>
  `<article class="guide-item entry-guide-item"><span>${index}</span><div><h4>${title}</h4>${content}</div></article>`;
import { dailyCloseSeries } from "../../shared/price-history.js";
import { institutionalScoreBreakdown } from "../../shared/entry-score.js";
import { isEtf } from "../../shared/market-codec.js";
import { researchChartMarks, researchDialogSections } from "./entry-research.js";
import { entryScoreChangePresentation } from "./market.js";

export function priceTrend(series) {
  const valid = series.filter(({ close }) => Number.isFinite(close) && close > 0);
  if (valid.length < 2) return "flat";
  return valid.at(-1).close > valid[0].close ? "up" : valid.at(-1).close < valid[0].close ? "down" : "flat";
}

const chartChange = (value) => Number.isFinite(value)
  ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%` : "—";
const chartReadout = (point, number) =>
  `${point.date} · ${Number.isFinite(point.close) ? `收盤 ${number(point.close, 2)}` : "無收盤價"}`;

function priceChartMarkup(stock, esc, number, series, marks = null) {
  const heading = '<h3>30 個交易日走勢圖</h3>';
  if (!series.length) return `<section class="entry-price-chart">${heading}<p>走勢資料載入中…</p></section>`;
  const valid = series.filter(({ close }) => Number.isFinite(close) && close > 0);
  if (!valid.length) return `<section class="entry-price-chart">${heading}<p>近 30 個交易日沒有可用的收盤價。</p></section>`;
  const planLines = (marks?.lines ?? []).filter(({ value }) => Number.isFinite(value) && value > 0);
  // Plan prices widen the scale so every marked level stays inside the plot.
  const values = [...series.flatMap(({ close, ma20, ma60 }) => [close, ma20, ma60]
    .filter((value) => Number.isFinite(value) && value > 0)), ...planLines.map(({ value }) => value)];
  const low = Math.min(...values), high = Math.max(...values);
  const closingLow = Math.min(...valid.map(({ close }) => close));
  const closingHigh = Math.max(...valid.map(({ close }) => close));
  const trend = priceTrend(series);
  const padding = Math.max((high - low) * 0.12, high * 0.01);
  const floor = low - padding, ceiling = high + padding;
  const x = (index) => 8 + index * 584 / Math.max(1, series.length - 1);
  const y = (close) => 140 - (close - floor) / (ceiling - floor) * 124;
  let highLabelY = y(closingHigh), lowLabelY = y(closingLow);
  if (lowLabelY - highLabelY < 30) {
    const middle = (highLabelY + lowLabelY) / 2;
    highLabelY = middle - 15;
    lowLabelY = middle + 15;
  }
  let path = "", ma20Path = "", ma60Path = "";
  let continuous = false, ma20Continuous = false, ma60Continuous = false;
  const maxVolume = Math.max(0, ...series.map(({ volume }) => Number.isFinite(volume) ? volume : 0));
  const bars = series.map(({ volume, changePercent }, index) => Number.isFinite(volume) && maxVolume > 0
    ? `<rect class="entry-chart-volume ${Number.isFinite(changePercent) ? changePercent > 0 ? "up" : changePercent < 0 ? "down" : "flat" : "flat"}" x="${(x(index) - 5).toFixed(1)}" y="${(197 - volume / maxVolume * 30).toFixed(1)}" width="10" height="${(volume / maxVolume * 30).toFixed(1)}"/>` : "").join("");
  const dots = series.map(({ date, close }, index) => {
    const { ma20, ma60 } = series[index];
    if (Number.isFinite(ma20) && ma20 > 0) {
      ma20Path += `${ma20Continuous ? " L" : " M"}${x(index).toFixed(1)} ${y(ma20).toFixed(1)}`;
      ma20Continuous = true;
    } else ma20Continuous = false;
    if (Number.isFinite(ma60) && ma60 > 0) {
      ma60Path += `${ma60Continuous ? " L" : " M"}${x(index).toFixed(1)} ${y(ma60).toFixed(1)}`;
      ma60Continuous = true;
    } else ma60Continuous = false;
    if (!Number.isFinite(close) || close <= 0) { continuous = false; return ""; }
    path += `${continuous ? " L" : " M"}${x(index).toFixed(1)} ${y(close).toFixed(1)}`;
    continuous = true;
    return `<circle data-index="${index}" cx="${x(index).toFixed(1)}" cy="${y(close).toFixed(1)}" r="3"${index === series.length - 1 ? ' class="selected"' : ""}><title>${esc(date)} 收盤 ${number(close, 2)}</title></circle>`;
  }).join("");
  const last = series.at(-1);
  const readout = chartReadout(last, number);
  const signalIndex = marks?.signalDate ? series.findIndex(({ date }) => date === marks.signalDate) : -1;
  const planSvg = planLines.map(({ key, value }) =>
    `<line class="entry-chart-plan ${key}" x1="8" x2="592" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}"/>`).join("") +
    (signalIndex >= 0 ? `<line class="entry-chart-signal" x1="${x(signalIndex).toFixed(1)}" x2="${x(signalIndex).toFixed(1)}" y1="16" y2="140"/>` : "");
  // Plan levels are neutral gray (told apart by dash and a label on the line) so they never
  // read as the colored close, MA20 or MA60 series. Labels near each other are spread apart.
  const swatch = (key) => `<svg class="entry-chart-plan-swatch" viewBox="0 0 16 4" aria-hidden="true"><line class="entry-chart-plan ${key}" x1="0" x2="16" y1="2" y2="2"/></svg>`;
  const placed = planLines.map((line) => ({ ...line, at: y(line.value) })).sort((a, b) => a.at - b.at);
  placed.forEach((line, index) => { if (index && line.at - placed[index - 1].at < 16) line.at = placed[index - 1].at + 16; });
  const planLabels = placed.length ? `<div class="entry-chart-plan-labels" aria-hidden="true">${placed.map(({ key, short, value, at }) =>
    `<span class="${key}" style="top:${(Math.min(at, 204) / 210 * 100).toFixed(2)}%">${short} ${number(value, 2)}</span>`).join("")}</div>` : "";
  const planLegend = planLines.length || signalIndex >= 0
    ? `<ul class="entry-chart-plan-legend" aria-label="進場計畫價位">${planLines.map(({ key, label, value }) =>
      `<li class="${key}">${swatch(key)}${label} ${number(value, 2)}</li>`).join("")}${signalIndex >= 0
      ? `<li class="signal">${swatch("signal")}訊號日 ${esc(marks.signalDate.slice(5).replace("-", "/"))}</li>` : ""}</ul>` : "";
  return `<section class="entry-price-chart" data-trend="${trend}"><div class="entry-chart-header"><div class="entry-chart-default">${heading}<div class="entry-chart-latest"><strong aria-label="${esc(last.date)} 收盤價 ${esc(Number.isFinite(last.close) ? number(last.close, 2) : "—")}">${Number.isFinite(last.close) ? number(last.close, 2) : "—"}</strong><small class="entry-chart-latest-change ${last.changePercent > 0 ? "up" : last.changePercent < 0 ? "down" : ""}">${chartChange(last.changePercent)}</small></div></div><div class="entry-chart-readout" aria-label="選定交易日資訊" hidden><div><strong class="entry-chart-selected-date">${esc(last.date.slice(5).replace("-", "/"))}</strong><span class="entry-chart-selected-close">${esc(Number.isFinite(last.close) ? `收盤 ${number(last.close, 2)}` : "無收盤價")}</span><small class="entry-chart-selected-volume">${esc(Number.isFinite(last.volume) ? `量 ${number(last.volume / 1000)} 張` : "成交量不足")}</small></div><strong class="entry-chart-selected-change ${Number.isFinite(last.changePercent) ? last.changePercent > 0 ? "up" : last.changePercent < 0 ? "down" : "" : ""}">${chartChange(last.changePercent)}</strong></div></div>
    <div class="entry-chart-legend">${[
      ["close", "收盤價"], ["ma20", "月線 MA20"], ["ma60", "季線 MA60"],
      ["volume", "成交量"],
    ].map(([key, label]) => `<button type="button" data-chart-series="${key}" aria-pressed="true" aria-label="${label}">${label}</button>`).join("")}</div>
    <div class="entry-chart-price-region"><div class="entry-chart-scale" aria-label="近 30 個交易日收盤價最高與最低"><span style="top:${(highLabelY / 210 * 100).toFixed(2)}%">高<br>${number(closingHigh, 2)}</span><span style="top:${(lowLabelY / 210 * 100).toFixed(2)}%">低<br>${number(closingLow, 2)}</span></div>
    <div class="entry-chart-plot" role="slider" tabindex="0" aria-label="${esc(stock.symbol)}近 ${series.length} 個交易日收盤價；點選圖表查看，觸控長按後左右滑動，鍵盤可用方向鍵" aria-orientation="horizontal" aria-valuemin="1" aria-valuemax="${series.length}" aria-valuenow="${series.length}" aria-valuetext="${esc(readout)}" data-index="${series.length - 1}" data-points="${esc(JSON.stringify(series))}"><svg viewBox="0 0 600 210" preserveAspectRatio="none" aria-hidden="true">
      <line x1="8" y1="16" x2="592" y2="16"/><line x1="8" y1="78" x2="592" y2="78"/><line x1="8" y1="140" x2="592" y2="140"/><line x1="8" y1="197" x2="592" y2="197"/>
      <path class="entry-chart-close" d="${path.trim()}"/><path class="entry-chart-ma20" d="${ma20Path.trim()}"/><path class="entry-chart-ma" d="${ma60Path.trim()}"/>${planSvg}<g class="entry-chart-bars">${bars}</g><g class="entry-chart-points">${dots}</g><line class="entry-chart-cursor" x1="${x(series.length - 1).toFixed(1)}" x2="${x(series.length - 1).toFixed(1)}" y1="16" y2="197"/></svg>${planLabels}</div></div>
    <div class="entry-chart-dates"><span>${esc(series[0].date)}</span><span>${esc(last.date)}</span></div>${planLegend}</section>`;
}

function kdChartMarkup(series, esc, number, metrics) {
  const points = series.slice(-3);
  const x = (index) => 34 + index * 292 / Math.max(1, points.length - 1);
  const y = (value) => 112 - value / 100 * 78;
  const line = (key) => {
    let path = "", continuous = false;
    points.forEach((point, index) => {
      if (!Number.isFinite(point[key])) { continuous = false; return; }
      path += `${continuous ? " L" : " M"}${x(index).toFixed(1)} ${y(point[key]).toFixed(1)}`;
      continuous = true;
    });
    return path.trim();
  };
  const kPath = line("k"), dPath = line("d");
  if (!kPath && !dPath) return "<p>KD 走勢資料不足。</p>";
  const valueLabel = (label, value, pointIndex, tone, below = false) => {
    if (!Number.isFinite(value) || pointIndex < 0) return "";
    const pointX = x(pointIndex), pointY = y(value);
    return `<g class="entry-kd-point-label ${tone}"><circle cx="${pointX.toFixed(1)}" cy="${pointY.toFixed(1)}" r="3"/><text x="${pointX.toFixed(1)}" y="${(pointY + (below ? 21 : -13)).toFixed(1)}" text-anchor="middle">${esc(label)} ${number(value, 2)}</text></g>`;
  };
  const lastIndex = points.length - 1;
  const labels = [
    valueLabel("K", metrics?.dayBeforeK, lastIndex - 2, "k"),
    valueLabel("K", metrics?.previousK, lastIndex - 1, "k"),
    valueLabel("K", metrics?.k, lastIndex, "k"),
    valueLabel("D", metrics?.d, lastIndex, "d", true),
  ].join("");
  return `<div class="entry-condition-kd-chart"><div class="entry-chart-legend"><button type="button" data-chart-series="k" aria-pressed="true" aria-label="K 線">K 線</button><button type="button" data-chart-series="d" aria-pressed="true" aria-label="D 線">D 線</button></div><div class="entry-condition-kd-plot"><svg viewBox="0 0 360 132" preserveAspectRatio="xMidYMid meet" role="img" aria-label="判斷使用的 ${points.length} 個交易日 K 與 D 走勢；K 值 ${Number.isFinite(metrics?.k) ? number(metrics.k, 2) : "無資料"}、D 值 ${Number.isFinite(metrics?.d) ? number(metrics.d, 2) : "無資料"}、前日 K 值 ${Number.isFinite(metrics?.previousK) ? number(metrics.previousK, 2) : "無資料"}、前二日 K 值 ${Number.isFinite(metrics?.dayBeforeK) ? number(metrics.dayBeforeK, 2) : "無資料"}"><line x1="34" y1="49.6" x2="326" y2="49.6"/><line x1="34" y1="96.4" x2="326" y2="96.4"/><path class="entry-chart-k" d="${kPath}"/><path class="entry-chart-d" d="${dPath}"/>${labels}</svg><div class="entry-chart-kd-scale"><span>80</span><span>20</span></div></div><div class="entry-chart-dates">${points.map((point) => `<span>${esc(point.date.slice(5).replace("-", "/"))}</span>`).join("")}</div></div>`;
}

export function selectEntryChartPoint(plot, index, number) {
  const points = JSON.parse(plot.dataset.points);
  const selected = Math.max(0, Math.min(points.length - 1, index));
  const point = points[selected];
  const readout = chartReadout(point, number);
  plot.dataset.index = String(selected);
  plot.setAttribute("aria-valuenow", String(selected + 1));
  plot.setAttribute("aria-valuetext", readout);
  const chart = plot.closest(".entry-price-chart");
  chart.querySelector(".entry-chart-default").hidden = true;
  chart.querySelector(".entry-chart-readout").hidden = false;
  chart.querySelector(".entry-chart-selected-date").textContent = point.date.slice(5).replace("-", "/");
  chart.querySelector(".entry-chart-selected-close").textContent = Number.isFinite(point.close) ? `收盤 ${number(point.close, 2)}` : "無收盤價";
  chart.querySelector(".entry-chart-selected-volume").textContent = Number.isFinite(point.volume) ? `量 ${number(point.volume / 1000)} 張` : "成交量不足";
  const change = chart.querySelector(".entry-chart-selected-change");
  change.textContent = chartChange(point.changePercent);
  change.className = `entry-chart-selected-change ${Number.isFinite(point.changePercent) ? point.changePercent > 0 ? "up" : point.changePercent < 0 ? "down" : "" : ""}`;
  const x = 8 + selected * 584 / Math.max(1, points.length - 1);
  const cursor = plot.querySelector(".entry-chart-cursor");
  cursor.setAttribute("x1", x.toFixed(1));
  cursor.setAttribute("x2", x.toFixed(1));
  plot.querySelector(".entry-chart-points .selected")?.classList.remove("selected");
  plot.querySelector(`.entry-chart-points [data-index="${selected}"]`)?.classList.add("selected");
}

export function restoreEntryChartTitle(plot) {
  const chart = plot.closest(".entry-price-chart");
  chart.querySelector(".entry-chart-default").hidden = false;
  chart.querySelector(".entry-chart-readout").hidden = true;
}
const CORE_LABELS = { trend: "趨勢結構", momentum: "KD 動能", priceVolume: "量價表現",
  institutional: "法人籌碼", entryRisk: "進場位置與風險" };
const CORE_DATA_LABELS = { close: "收盤價", ma20: "月線", ma60: "季線", previousMa20: "前日月線", previousMa60: "前日季線", k: "K 值", d: "D 值", previousK: "前日 K 值", dayBeforeK: "前二日 K 值", changePercent: "漲跌幅", rvol20: "均量倍數", institutionalNet5: "近五日法人淨額", deviation20: "月線乖離", previous10Low: "近十日前低點", atr14: "平均波動" };
const coreData = (data, esc, number) => Object.entries(data ?? {}).map(([key, value]) =>
  `<span><dt>${esc(CORE_DATA_LABELS[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2"))}</dt><dd>${Number.isFinite(value) ? number(value, 2) : esc(value ?? "—")}</dd></span>`).join("");

/** The V1.2 day-over-day label that the market list showed before entry research led it. */
function legacyChange(stock, esc, number) {
  if (!stock.entryScore) return "";
  const { label, title } = entryScoreChangePresentation(stock, number);
  return `<p class="entry-score-change" title="${esc(title)}">${esc(label)}</p>`;
}

export function entryScoreDialogMarkup(stock, esc, number, percent, favorite = false, icon = () => "", trackingHtml = "") {
  const score = stock.entryScore;
  const heading = `<div class="entry-dialog-title"><p class="entry-dialog-sector">${esc(stock.sector ?? "產業未分類")}</p><button type="button" class="icon-button favorite-button ${favorite ? "is-favorite" : ""}" data-favorite="${esc(stock.symbol)}" aria-label="${favorite ? "移除" : "加入"}${esc(stock.name)}自選" aria-pressed="${favorite}">${icon("star")}</button><h2 id="dialog-heading">${esc(stock.symbol)} ${esc(stock.name)}</h2></div>`;
  if (!score) return `${heading}<p>資料不足，無法評分。</p>${trackingHtml}`;
  const valid = Number.isFinite(score.finalScore);
  if (!score.categories || !Object.keys(score.categories).length && valid)
    return `${heading}<p role="status">評分明細載入中…</p>`;
  const metrics = score.metrics;
  const institutionParts = institutionalScoreBreakdown(metrics.netRatio,
    metrics.institutionBuyDays, metrics.institutionPositiveCategories);
  const chartSeries = stock.priceHistory ?? dailyCloseSeries(stock.history,
    stock.tradingDates ?? stock.history?.map((bar) => bar.date), score.asOf);
  const research = stock.entryResearch?.gateResult ? stock.entryResearch : null;
  const header = `<header class="entry-dialog-header">${heading}
    <p class="entry-dialog-meta">波段順勢進場 · ${esc(score.asOf)}</p></header>`;
  const chart = priceChartMarkup(stock, esc, number, chartSeries, researchChartMarks(research));
  const legacy = `<section class="entry-summary" data-conditions-passed="${Boolean(score.coreConditionsPassed)}"><time class="entry-summary-date" datetime="${esc(score.asOf ?? "")}">${esc(score.asOf?.replaceAll("-", "/") ?? "—")}</time><div class="entry-summary-head"><strong${valid ? ` data-score-target="${score.finalScore}"` : ""}>${valid ? `${number(score.finalScore, 2)} / 100` : "—"}</strong><span>${esc(score.status)}</span></div>
    <section class="entry-evidence entry-core-panel"><h3>核心條件檢查</h3><div class="entry-condition-list">${Object.entries(CORE_LABELS).map(([key, label]) => {
      const item = score.coreConditions?.[key];
      const status = item?.status === "PASS" ? "通過" : item?.status === "FAIL" ? "未通過" : "資料不足";
      const tone = item?.status === "PASS" ? "pass" : item?.status === "FAIL" ? "fail" : "missing";
      const data = coreData(item?.data, esc, number);
      const category = score.categories?.[key];
      const scoreDetail = valid && Number.isFinite(category?.score)
        ? `<span class="entry-category ${tone === "pass" ? "" : "excluded"}"><span class="entry-category-values"><strong>${number(category.score, 2)} 分</strong><span>權重 ${category.weight}% · 計入分數 ${number(category.creditedContribution ?? (tone === "pass" ? category.contribution : 0), 2)}</span></span><progress value="${category.score}" max="100" aria-label="${esc(label)}評分"></progress></span>` : "";
      const iconPath = tone === "pass" ? "M4.5 10.25 8.5 14.25 15.5 6.5" :
        tone === "fail" ? "M5.5 5.5 14.5 14.5 M14.5 5.5 5.5 14.5" : "M5 10 15 10";
      const detail = key === "momentum" ? kdChartMarkup(chartSeries, esc, number, item?.data) : data ? `<dl class="entry-condition-data">${data}</dl>` : "<p>尚無條件數據。</p>";
      const institutionDetail = key === "institutional" && stock.sector && !isEtf(stock)
        ? `<div class="entry-institution-detail">${detail}<button type="button" class="outline-button" data-institution-sector="${esc(stock.symbol)}" aria-label="查看${esc(stock.name)}所屬${esc(stock.sector)}產業法人買賣">查看產業法人 ↗</button></div>` : detail;
      return `<details class="entry-condition ${tone}"><summary><span class="entry-condition-icon" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none"><path d="${iconPath}"/></svg></span><span class="entry-condition-copy"><strong>${label}</strong><small>${esc(item?.reason ?? "尚無判斷資料")}</small></span><span class="entry-condition-status ${tone}">${status}</span>${scoreDetail}</summary><div class="entry-condition-detail">${institutionDetail}</div></details>`;
    }).join("")}</div>
    ${valid ? `<div class="entry-more"><details><summary>支持條件、風險與後續觀察</summary>
      ${guideItem("01", "支持條件", list(score.supportingEvidence, esc, "目前沒有符合的支持條件。"))}
      ${guideItem("02", "疑慮與風險", list(score.conflictingEvidence, esc, "目前沒有額外風險提示。"))}
      ${guideItem("03", "後續觀察", list(score.pendingConditions, esc, "核心趨勢條件已齊備，仍須自行評估風險。"))}</details>
      <details class="entry-metrics"><summary>查看完整計算依據</summary>
      ${guideItem("01", "趨勢與均線", `<p>月線 MA20：${number(metrics.ma20, 2)}（前日 ${number(metrics.previousMa20, 2)}）</p><p>季線 MA60：${number(metrics.ma60, 2)}（前日 ${number(metrics.previousMa60, 2)}）</p><code>近五日站上月線：${metrics.fiveAboveMa20} 日</code>`)}
      ${guideItem("02", "KD 與今日量價", `<p>K／D：${number(metrics.k, 2)}／${number(metrics.d, 2)}（前日 ${number(metrics.previousK, 2)}／${number(metrics.previousD, 2)}）</p><code>${esc(metrics.priceVolume)} · ${number(metrics.rvol20, 2)} 倍均量</code>`)}
      ${guideItem("03", "法人籌碼", `<p>近五個交易日三大法人合計淨買賣超 ${number(metrics.institutionNet5)} 股；同期個股成交量 ${number(metrics.institutionVolume5)} 股。</p><p>法人淨額占比 = 淨買賣超 ÷ 成交量 = ${percent(metrics.netRatio * 100)}。</p><p>占比分數 = 50 + 50 × 占比 ÷ 5%，限制在 0～100 分；此筆為 ${number(institutionParts.ratioScore, 2)} 分，計入 ${number(institutionParts.ratioContribution, 2)} 分（占 60%）。</p><p>法人合計買超 ${metrics.institutionBuyDays} 日 × 5 = ${number(institutionParts.dayContribution, 2)} 分；累計買超 ${metrics.institutionPositiveCategories} 類 × 5 = ${number(institutionParts.categoryContribution, 2)} 分。</p><code>法人籌碼分數 = ${number(institutionParts.ratioContribution, 2)} + ${number(institutionParts.dayContribution, 2)} + ${number(institutionParts.categoryContribution, 2)} = ${number(institutionParts.score, 2)} 分；通過法人核心條件時，依此構面的 20% 權重計入總分。</code>`)}
      ${guideItem("04", "進場位置與波動", `<p>月線乖離 ${percent(metrics.deviation20)} · 近十日前低點 ${number(metrics.previous10Low, 2)} · 距離 ${percent(metrics.riskDistance)}</p><code>ATR14 ${number(metrics.atr14, 2)}（${percent(metrics.atrPercent)}）</code>`)}</details></div>` : ""}</section></section>
    ${!valid ? `<section class="entry-evidence"><h3>無法評分的原因</h3>${list(score.missingData, esc, "必要資料尚未齊備。")}</section>` : ""}`;
  if (!research) return `<div class="entry-dialog">${header}${chart}${legacy}
    ${trackingHtml}<p class="helper-text entry-disclaimer">此分數僅表示固定研究策略的條件符合程度，不代表上漲機率、預期報酬率或買賣指令。法人完整明細請至法人買賣頁面查看。<br>模型版本：${esc(score.modelVersion)}</p></div>`;
  const sections = researchDialogSections(research, stock, { esc, number, percent });
  // The price chart keeps its original place under the header; stage 1 gates come before the
  // next-day assessment they decide. Stocks stopped by stage 1 skip the empty later sections.
  const body = sections.evaluated
    ? `${sections.basic}${sections.gates}${sections.card}${sections.readiness}${sections.signal}${sections.plan}`
    : `${sections.basic}${sections.gates}${sections.card}${sections.notice}`;
  return `<div class="entry-dialog has-research">${header}${chart}${body}
    <section class="entry-legacy" aria-labelledby="entry-legacy-title"><h3 id="entry-legacy-title">舊版株研評分 V1.2 <small>綜合研究分數，不是進場準備度</small></h3>${legacyChange(stock, esc, number)}${legacy}</section>
    ${trackingHtml}<p class="helper-text entry-disclaimer">進場研究依固定規則計算，明日進場候選不代表保證可以買進；分數不代表上漲機率、預期報酬率或買賣指令，參數為暫定、尚未經歷史回測驗證。<br>模型版本：${esc(research.modelVersion)}（進場研究）、${esc(score.modelVersion)}（株研評分）</p></div>`;
}
