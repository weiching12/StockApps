import { isEtf } from "../../shared/market-codec.js";
import { dailyCloseSeries, monthlyCloseSeries } from "../../shared/price-history.js";
import { researchCardPreview, researchChartMarks, researchDialogSections } from "./entry-research.js";
import { etfChartEventsMarkup, etfDividendCardMarkup, etfDividendHistoryMarkup, etfFundMarkup, etfMonthPanelsMarkup, etfTechnicalMarkup, showEtfMonth } from "./etf-detail.js";

export function priceTrend(series) {
  const valid = series.filter(({ close }) => Number.isFinite(close) && close > 0);
  if (valid.length < 2) return "flat";
  return valid.at(-1).close > valid[0].close ? "up" : valid.at(-1).close < valid[0].close ? "down" : "flat";
}

const chartChange = (value) => Number.isFinite(value)
  ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%` : "—";
const chartReadout = (point, number) =>
  `${point.date} · ${Number.isFinite(point.close) ? `收盤 ${number(point.close, 2)}` : "無收盤價"}`;

const INSTITUTION_LINES = [["foreign", "外資"], ["trust", "投信"], ["dealer", "自營商"]];
const lotsText = (shares, number) => Number.isFinite(shares) ? `${number(shares / 1000)} 張` : "—";

// Net shares at the session's close, so an estimate rather than the traded amount. A missing
// institution or close leaves it unknown rather than understating it.
function institutionMix(point, number) {
  const volumes = INSTITUTION_LINES.map(([key]) => point[`${key}Volume`]);
  const amount = Number.isFinite(point.institutionalNet) && Number.isFinite(point.close) ? point.institutionalNet * point.close : null;
  const size = Math.abs(amount);
  const money = amount === null ? "—" : `${amount > 0 ? "+" : amount < 0 ? "-" : ""}${size >= 1e8 ? `${number(size / 1e8, 2)} 億` : `${number(size / 1e4)} 萬`}`;
  return { volumes, complete: volumes.every(Number.isFinite), money, tone: amount > 0 ? "up" : amount < 0 ? "down" : "" };
}

function institutionBarMarkup(point, number) {
  const { volumes, complete, money, tone } = institutionMix(point, number);
  return `<div class="entry-institution-bar"><div class="entry-institution-head"><span>三大法人交易量</span><span class="entry-institution-net" title="淨買賣股數 × 當日收盤價，屬估算">淨買賣 <b class="${tone}">${money}</b></span></div>
    <div class="entry-institution-track" title="三大法人買進＋賣出股數的比例">${INSTITUTION_LINES.map(([key], index) => `<i class="${key}" style="flex-grow:${complete ? volumes[index] : 0}"></i>`).join("")}</div>
    <div class="entry-institution-legend">${INSTITUTION_LINES.map(([key, label], index) => `<span class="${key}" data-institution="${key}">${label} <b>${lotsText(volumes[index], number)}</b></span>`).join("")}</div></div>`;
}

/** Point the institution line at one session; the chart header above names the day. */
function showInstitutionPoint(chart, point, number) {
  const { volumes, complete, money, tone } = institutionMix(point, number);
  const net = chart.querySelector(".entry-institution-net b");
  // The monthly chart has no institution line.
  if (!net) return;
  net.textContent = money;
  net.className = tone;
  INSTITUTION_LINES.forEach(([key], index) => {
    chart.querySelector(`.entry-institution-track .${key}`).style.flexGrow = complete ? volumes[index] : 0;
    chart.querySelector(`[data-institution="${key}"] b`).textContent = lotsText(volumes[index], number);
  });
}

/** Sessions each range asks for; the stored history tops out near a year, so a longer range shows what exists. */
export const CHART_RANGES = [[30, "1 月"], [60, "3 月"], [260, "1 年"]];
/** A session reads as MM/DD, a month of the monthly chart as YYYY/MM. */
const pointLabel = (date, monthly) => monthly ? `${date.slice(0, 4)}/${date.slice(5, 7)}` : date.slice(5).replace("-", "/");
const rangeMarkup = (range) => `<div class="entry-chart-ranges" role="group" aria-label="走勢圖區間">${CHART_RANGES.map(([days, label]) =>
  `<button type="button" data-chart-range="${days}" aria-pressed="${days === range}">${label}</button>`).join("")}</div>`;

/**
 * `options.monthly` draws one point per month (an ETF's year): no range choice, no moving averages and no
 * institution line, and `options.events` adds the distribution lanes under the dates.
 */
function priceChartMarkup(stock, esc, number, series, marks = null, range = 30, options = {}) {
  const monthly = Boolean(options.monthly), ranges = monthly ? "" : rangeMarkup(range);
  const heading = monthly ? "<h3>近一年月線圖</h3>" : `<h3>${series.length || range} 個交易日走勢圖</h3>`;
  if (!series.length) return `<section class="entry-price-chart">${heading}${ranges}<p>近 ${range} 個交易日沒有走勢資料。</p></section>`;
  const valid = series.filter(({ close }) => Number.isFinite(close) && close > 0);
  if (!valid.length) return `<section class="entry-price-chart">${heading}${ranges}<p>近 ${range} 個交易日沒有可用的收盤價。</p></section>`;
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
  // Bars narrow with the number of sessions so a year of them does not merge into one block.
  const barWidth = Math.max(1, Math.min(10, 584 / Math.max(1, series.length - 1) * 0.62));
  const bars = series.map(({ volume, changePercent }, index) => Number.isFinite(volume) && maxVolume > 0
    ? `<rect class="entry-chart-volume ${Number.isFinite(changePercent) ? changePercent > 0 ? "up" : changePercent < 0 ? "down" : "flat" : "flat"}" x="${(x(index) - barWidth / 2).toFixed(1)}" y="${(197 - volume / maxVolume * 30).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${(volume / maxVolume * 30).toFixed(1)}"/>` : "").join("");
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
  const planSvg = planLines.map(({ key, value }) =>
    `<line class="entry-chart-plan ${key}" x1="8" x2="592" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}"/>`).join("");
  // Plan levels are neutral gray (told apart by dash and a label on the line) so they never
  // read as the colored close, MA20 or MA60 series. Labels near each other are spread apart.
  const placed = planLines.map((line) => ({ ...line, at: y(line.value) })).sort((a, b) => a.at - b.at);
  placed.forEach((line, index) => { if (index && line.at - placed[index - 1].at < 16) line.at = placed[index - 1].at + 16; });
  const planLabels = placed.length ? `<div class="entry-chart-plan-labels" aria-hidden="true">${placed.map(({ key, short, value, at }) =>
    `<span class="${key}" style="top:${(Math.min(at, 204) / 210 * 100).toFixed(2)}%">${short} ${number(value, 2)}</span>`).join("")}</div>` : "";
  // A candidate's plan levels start on the chart, where the decision card's prices can be checked against
  // the trend; otherwise they wait behind the toggle beside the chart heading.
  const planShown = Boolean(marks?.shown) && placed.length > 0;
  const planToggle = placed.length
    ? `<button type="button" class="entry-chart-plan-toggle" data-chart-series="plan" aria-pressed="${planShown}" aria-label="在走勢圖顯示計畫價位（${placed.map(({ label, value }) => `${label} ${number(value, 2)}`).join("、")}）"><span class="show">顯示計畫價位</span><span class="hide">隱藏計畫價位</span></button>` : "";
  return `<section class="entry-price-chart${planShown ? "" : " hide-plan"}${series.length > 60 ? " dense" : ""}" data-trend="${trend}" data-range="${range}"${monthly ? ' data-monthly="true"' : ""}><div class="entry-chart-header"><div class="entry-chart-default">${heading}${planToggle}</div><div class="entry-chart-readout" aria-label="選定交易日資訊" hidden><div><strong class="entry-chart-selected-date">${esc(pointLabel(last.date, monthly))}</strong><span class="entry-chart-selected-close">${esc(Number.isFinite(last.close) ? `收盤 ${number(last.close, 2)}` : "無收盤價")}</span><small class="entry-chart-selected-volume">${esc(Number.isFinite(last.volume) ? `量 ${number(last.volume / 1000)} 張` : "成交量不足")}</small></div><strong class="entry-chart-selected-change ${Number.isFinite(last.changePercent) ? last.changePercent > 0 ? "up" : last.changePercent < 0 ? "down" : "" : ""}">${chartChange(last.changePercent)}</strong></div></div>
    ${ranges}<div class="entry-chart-legend">${[
      ["close", monthly ? "月底收盤價" : "收盤價"], ...(monthly ? [] : [["ma20", "月線 MA20"], ["ma60", "季線 MA60"]]),
      ["volume", monthly ? "月成交量" : "成交量"],
    ].map(([key, label]) => `<button type="button" data-chart-series="${key}" aria-pressed="true" aria-label="${label}">${label}</button>`).join("")}</div>
    <div class="entry-chart-price-region"><div class="entry-chart-scale" aria-label="近 ${series.length} 個交易日收盤價最高與最低"><span style="top:${(highLabelY / 210 * 100).toFixed(2)}%">高<br>${number(closingHigh, 2)}</span><span style="top:${(lowLabelY / 210 * 100).toFixed(2)}%">低<br>${number(closingLow, 2)}</span></div>
    <div class="entry-chart-plot" role="slider" tabindex="0" aria-label="${esc(stock.symbol)}近 ${series.length} 個交易日收盤價；點選圖表查看，觸控長按後左右滑動，鍵盤可用方向鍵" aria-orientation="horizontal" aria-valuemin="1" aria-valuemax="${series.length}" aria-valuenow="${series.length}" aria-valuetext="${esc(readout)}" data-index="${series.length - 1}" data-points="${esc(JSON.stringify(series))}"><svg viewBox="0 0 600 210" preserveAspectRatio="none" aria-hidden="true">
      <line x1="8" y1="16" x2="592" y2="16"/><line x1="8" y1="78" x2="592" y2="78"/><line x1="8" y1="140" x2="592" y2="140"/><line x1="8" y1="197" x2="592" y2="197"/>
      <path class="entry-chart-close" d="${path.trim()}"/><path class="entry-chart-ma20" d="${ma20Path.trim()}"/><path class="entry-chart-ma" d="${ma60Path.trim()}"/>${planSvg}<g class="entry-chart-bars">${bars}</g><g class="entry-chart-points">${dots}</g><line class="entry-chart-cursor" x1="${x(series.length - 1).toFixed(1)}" x2="${x(series.length - 1).toFixed(1)}" y1="16" y2="197"/></svg>${planLabels}</div></div>
    <div class="entry-chart-dates"><span>${esc(monthly ? series[0].date.slice(0, 7) : series[0].date)}</span><span>${esc(monthly ? last.date.slice(0, 7) : last.date)}</span></div>${monthly ? options.events ?? "" : institutionBarMarkup(last, number)}</section>`;
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
  const monthly = chart.dataset.monthly === "true";
  chart.querySelector(".entry-chart-selected-date").textContent = pointLabel(point.date, monthly);
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
  showInstitutionPoint(chart, point, number);
  // The month's distributions and holdings under the chart follow the chosen month.
  if (monthly) showEtfMonth(chart.closest(".entry-dialog"), point.date.slice(0, 7));
}

export function restoreEntryChartTitle(plot, number) {
  const chart = plot.closest(".entry-price-chart");
  chart.querySelector(".entry-chart-default").hidden = false;
  chart.querySelector(".entry-chart-readout").hidden = true;
  // Back to the latest session, matching the title.
  showInstitutionPoint(chart, JSON.parse(plot.dataset.points).at(-1), number);
}
/** The chart alone, for another range: the same marks and series toggles as the dialog's first render. */
export function entryChartMarkup(stock, esc, number, series, range) {
  const research = !isEtf(stock) && stock.entryResearch?.gateResult ? stock.entryResearch : null;
  return priceChartMarkup(stock, esc, number, series, research ? researchChartMarks(research) : null, range);
}

/** The latest close and its change, beside the date in the dialog header. */
const quoteMarkup = (close, change, date, esc, number) => Number.isFinite(close)
  ? `<div class="entry-dialog-quote"><strong aria-label="${esc(date ?? "")} 收盤價 ${number(close, 2)}">${number(close, 2)}</strong>${Number.isFinite(change) ? `<small class="${change > 0 ? "up" : change < 0 ? "down" : ""}">${chartChange(change)}</small>` : ""}</div>` : "";

export function entryScoreDialogMarkup(stock, esc, number, percent, favorite = false, icon = () => "", loadingIcon = () => "") {
  const score = stock.entryScore;
  const heading = `<div class="entry-dialog-title"><p class="entry-dialog-sector">${esc(stock.sector ?? "產業未分類")}</p><button type="button" class="icon-button favorite-button ${favorite ? "is-favorite" : ""}" data-favorite="${esc(stock.symbol)}" aria-label="${favorite ? "移除" : "加入"}${esc(stock.name)}自選" aria-pressed="${favorite}">${icon("star")}</button><h2 id="dialog-heading">${esc(stock.symbol)} ${esc(stock.name)}</h2></div>`;
  const research = stock.entryResearch?.gateResult ? stock.entryResearch : null;
  // The list already knows the identity, price and next-day result; only the rest waits for the stock's analysis.
  if (score && !research && stock.entryResearch) {
    const date = score.asOf ?? stock.latest?.date ?? "";
    return `<div class="entry-dialog has-research"><header class="entry-dialog-header">${heading}
      <div class="entry-dialog-subline"><p class="entry-dialog-meta">波段順勢進場 · ${esc(date)}</p>${quoteMarkup(stock.latest?.close, stock.latest?.changePercent, date, esc, number)}</div></header>
      ${researchCardPreview(stock.entryResearch, { esc, number })}
      <section class="entry-price-chart entry-chart-pending"><div class="entry-chart-pending-head"><h3>30 個交易日走勢圖</h3></div><div class="entry-pending-body">${loadingIcon("走勢資料載入中")}</div></section>
      <section class="entry-pending">${loadingIcon("研究明細載入中")}</section></div>`;
  }
  if (isEtf(stock)) {
    // No entry research for ETFs: distributions lead; the year is drawn month by month with ex-dividend and
    // payment marks, and the month chosen on it shows that month's holdings below. Fund facts follow, and
    // the technical read and institutional flow close the dialog, folded.
    const known = "etfInfo" in stock || stock.etfInfoPending, fund = stock.etfInfo;
    const daily = stock.priceHistory ?? (stock.history ? dailyCloseSeries(stock.history,
      stock.tradingDates ?? stock.history.map((bar) => bar.date), stock.latest?.date, 260) : null);
    const latest = daily?.at(-1) ?? stock.latest;
    const format = { esc, number, percent };
    const monthly = daily?.length ? monthlyCloseSeries(daily) : [];
    const months = monthly.map((point) => point.month);
    const chart = monthly.length ? priceChartMarkup(stock, esc, number, monthly, null, 260, { monthly: true, events: etfChartEventsMarkup(fund, months, format) })
      : `<section class="entry-price-chart entry-chart-pending"><div class="entry-chart-pending-head"><h3>近一年月線圖</h3></div><div class="entry-pending-body">${loadingIcon("走勢資料載入中")}</div></section>`;
    return `<div class="entry-dialog has-research etf-dialog"><header class="entry-dialog-header">${heading}
      <div class="entry-dialog-subline"><p class="entry-dialog-meta">${esc(latest?.date ?? stock.latest?.date ?? "")}</p>${quoteMarkup(latest?.close ?? stock.latest?.close, latest?.changePercent ?? stock.latest?.changePercent, latest?.date, esc, number)}</div></header>
      ${known ? etfDividendCardMarkup(fund, format, loadingIcon) : ""}${chart}${known ? etfMonthPanelsMarkup(fund, months, format) : ""}${known ? etfDividendHistoryMarkup(fund, format) : ""}${known ? etfFundMarkup(fund, format) : ""}${etfTechnicalMarkup(stock, daily?.slice(-30) ?? null, format)}
      <p class="helper-text entry-disclaimer">ETF 追蹤指數或一籃子標的，不判斷進場時機，也不列入回測樣本。以上為公開資料整理，非買賣建議；配息以投信公告為準，折溢價採收盤後的預估淨值。</p></div>`;
  }
  if (!score || !research) return `${heading}<p>資料不足，無法進行進場研究。</p>`;
  const chartSeries = stock.priceHistory ?? dailyCloseSeries(stock.history,
    stock.tradingDates ?? stock.history?.map((bar) => bar.date), score.asOf);
  const latest = chartSeries.at(-1) ?? stock.latest;
  const header = `<header class="entry-dialog-header">${heading}
    <div class="entry-dialog-subline"><p class="entry-dialog-meta">波段順勢進場 · ${esc(score.asOf)}</p>${quoteMarkup(latest?.close, latest?.changePercent, latest?.date ?? score.asOf, esc, number)}</div></header>`;
  const chart = priceChartMarkup(stock, esc, number, chartSeries, researchChartMarks(research));
  const sections = researchDialogSections(research, stock, { esc, number, percent });
  // The next-day card is the conclusion, so it leads; the chart backs it up, then the detail follows the
  // order the research is decided in: gates, signal, readiness and the price plan. Stocks stopped by
  // stage 1 skip the empty later sections.
  const body = sections.evaluated
    ? `${sections.basic}${sections.gates}${sections.signal}${sections.readiness}${sections.plan}`
    : `${sections.basic}${sections.gates}${sections.notice}`;
  return `<div class="entry-dialog has-research">${header}${sections.card}${chart}${body}
    <p class="helper-text entry-disclaimer">進場研究依固定規則計算，明日進場候選不代表保證可以買進；分數不代表上漲機率、預期報酬率或買賣指令，參數為暫定、尚未經歷史回測驗證。<br>模型版本：${esc(research.modelVersion)}</p></div>`;
}
