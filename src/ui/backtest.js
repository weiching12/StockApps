import { ENTRY_RESEARCH_STATUS_LABELS, NEXT_DAY_STATUS_LABELS, SETUP_LABELS } from "../../shared/entry-research-model.js";

// 策略回測 page: filters, aggregate tiles, charts and the saved sample list. Every number comes
// from the backtest/samples APIs; nothing here recomputes research rules. Demo mode has no saved
// samples and shows an explicit empty state instead of simulated results.

// v1 samples used the V1.2 core conditions; v2 samples store veto conditions (觸發 = vetoed).
const GATE_LABELS = {
  v1: { trend: "趨勢結構", momentum: "KD 動能", priceVolume: "量價表現", institutional: "法人籌碼", entryRisk: "基礎價格風險" },
  v2: { trend: "趨勢遭破壞", distribution: "近期放量下跌", extension: "過度延伸", institutional: "法人明顯賣壓", liquidity: "流動性不足" },
};
const GATE_STATUS = { v1: { PASS: "通過", FAIL: "未通過", UNKNOWN: "待確認" }, v2: { PASS: "未觸發", FAIL: "觸發", UNKNOWN: "待確認" } };
const TRADE_STATUS = { FILLED: "已模擬成交", NOT_APPLICABLE: "非明日候選", PENDING: "等待隔日行情", UNAVAILABLE: "行情不可比較",
  OPEN_ABOVE_UPPER: "開盤高於上限，不成交", OPEN_BELOW_INVALIDATION: "開盤低於失效價，不成交" };
const SAMPLE_PAGE = 50;
const RETENTION_NOTE = "研究樣本保留最近 6 個月，較舊的樣本與結果會自動刪除。";

export const DEFAULT_BACKTEST_FILTERS = Object.freeze({ from: "", to: "", symbol: "", setup: "", gate: "", nextDay: "", minScore: "", horizon: "10" });

/** Query parameters for both APIs; empty filters are omitted. */
export function backtestQuery(filters) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) if (value !== "" && value !== null && value !== undefined) params.set(name, value);
  return params;
}

const signed = (value, digits = 2) => Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(digits)}%` : "—";
const plain = (value, digits = 1) => Number.isFinite(value) ? `${value.toFixed(digits)}%` : "—";
const count = (value) => Number.isFinite(value) ? value.toLocaleString("zh-TW") : "—";
const tone = (value) => value > 0 ? "up" : value < 0 ? "down" : "";

export function backtestPanelMarkup() {
  const options = (items) => items.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
  return `<section id="backtest-page" class="backtest-page" data-page-panel="backtest" aria-label="策略回測" hidden>
    <form id="backtest-filters" class="backtest-filters panel" aria-label="回測條件">
      <label>起始日<input type="date" name="from"></label>
      <label>結束日<input type="date" name="to"></label>
      <label>策略<select name="setup">${options([["", "全部策略"], ["PULLBACK_RECOVERY", SETUP_LABELS.PULLBACK_RECOVERY], ["RANGE_BREAKOUT", SETUP_LABELS.RANGE_BREAKOUT]])}</select></label>
      <label>初步門檻<select name="gate">${options([["", "全部"], ["PASS", "通過"], ["FAIL", "未通過"], ["UNKNOWN", "待確認"]])}</select></label>
      <label>明日狀態<select name="nextDay">${options([["", "全部"], ...Object.entries(NEXT_DAY_STATUS_LABELS)])}</select></label>
      <label>準備度<select name="minScore">${options([["", "不限"], ["40", "40 分以上"], ["60", "60 分以上"], ["70", "70 分以上"], ["80", "80 分以上"], ["90", "90 分以上"]])}</select></label>
      <label>股票代號<input name="symbol" inputmode="text" autocomplete="off" placeholder="例如 2330" maxlength="12"></label>
      <fieldset class="backtest-horizon"><legend>持有天數</legend><div class="segmented-control" role="group" aria-label="持有天數">${[5, 10, 20].map((days) => `<button type="button" data-backtest-horizon="${days}" aria-pressed="${days === 10}">${days} 日</button>`).join("")}</div></fieldset>
      <button type="reset" class="text-button">清除條件</button>
    </form>
    <p id="backtest-scope" class="backtest-scope" role="status"></p>
    <div id="backtest-content" class="backtest-content"></div>
    <div id="backtest-tooltip" class="backtest-tooltip" role="tooltip" hidden></div>
  </section>`;
}

function scopeText(result, filters) {
  const { totals } = result.data, meta = result.meta;
  const parts = [totals.firstDate ? `${totals.firstDate.replaceAll("-", "/")}～${totals.lastDate.replaceAll("-", "/")}，${count(totals.sessions)} 個交易日` : "目前條件沒有樣本",
    `模型 ${meta.modelVersion}${meta.provisional ? "（暫定參數，尚未驗證）" : ""}`, `持有 ${meta.horizon} 日`];
  const active = Object.entries(filters).filter(([name, value]) => value && !["horizon", "from", "to"].includes(name)).length;
  if (active) parts.push(`另有 ${active} 項篩選條件`);
  return `統計範圍：${parts.join(" · ")}`;
}

function tile(label, value, note = "", extra = "") {
  return `<div class="backtest-tile${extra}"><span>${label}</span><strong>${value}</strong>${note ? `<small>${note}</small>` : ""}</div>`;
}

function tilesMarkup({ totals, trades, forward }, meta) {
  const thin = trades.insufficient ? `<em class="backtest-thin">樣本不足（少於 ${meta.minimumSamples} 筆）</em>` : "";
  return `<section class="backtest-section" aria-labelledby="backtest-totals-title"><h2 id="backtest-totals-title">樣本概況</h2><div class="backtest-tiles">
    ${tile("研究樣本", count(totals.samples), "全市場每日收盤後保存，含未通過門檻的股票")}
    ${tile("初步門檻通過", count(totals.gatePass), totals.samples ? `占 ${plain(totals.gatePass / totals.samples * 100)}` : "")}
    ${tile("進場訊號觸發", count(totals.triggered))}
    ${tile("明日進場候選", count(totals.candidates))}
    ${tile("模擬成交", count(totals.filled), totals.tradePending ? `${count(totals.tradePending)} 筆尚未滿 ${meta.horizon} 日` : "隔日開盤價在計畫範圍內才成交")}
  </div></section>
  <section class="backtest-section" aria-labelledby="backtest-trades-title"><h2 id="backtest-trades-title">模擬交易結果 <small>持有 ${meta.horizon} 日 · 已扣手續費、交易稅與滑價</small></h2>${thin}<div class="backtest-tiles">
    ${tile("已完成交易", count(trades.count))}
    ${tile("勝率", plain(trades.winRate), "淨報酬大於 0 的比例")}
    ${tile("平均報酬", `<span class="${tone(trades.averageReturn)}">${signed(trades.averageReturn)}</span>`)}
    ${tile("平均獲利／平均虧損", `<span class="${tone(trades.averageWin)}">${signed(trades.averageWin)}</span> / <span class="${tone(trades.averageLoss)}">${signed(trades.averageLoss)}</span>`)}
    ${tile("最大回撤", `<span class="${tone(trades.maxDrawdown)}">${signed(trades.maxDrawdown)}</span>`, "依下方等權累積曲線計算")}
    ${tile("20 日最大有利／不利幅度", `<span class="${tone(forward.averageMfe)}">${signed(forward.averageMfe)}</span> / <span class="${tone(forward.averageMae)}">${signed(forward.averageMae)}</span>`, `平均 MFE／MAE，${count(forward.excursionCount)} 筆樣本`)}
  </div></section>`;
}

/** Shared SVG frame: y scale in percent with a zero line; returns helpers for one plot. */
function frame(values, width, height, pad = { top: 12, right: 12, bottom: 24, left: 48 }) {
  const finite = values.filter(Number.isFinite);
  let min = Math.min(0, ...finite), max = Math.max(0, ...finite);
  if (min === max) { min -= 1; max += 1; }
  const span = max - min; min -= span * 0.08; max += span * 0.08;
  const y = (value) => pad.top + (max - value) / (max - min) * (height - pad.top - pad.bottom);
  const ticks = [max - (max - min) * 0.08, 0, min + (max - min) * 0.08].filter((tick, index, all) =>
    index === 1 || Math.abs(y(tick) - y(0)) > 14).map((tick) => Number(tick.toFixed(1)));
  const grid = ticks.map((tick) => `<line class="backtest-grid${tick === 0 ? " zero" : ""}" x1="${pad.left}" x2="${width - pad.right}" y1="${y(tick)}" y2="${y(tick)}"/><text class="backtest-axis" x="${pad.left - 6}" y="${y(tick) + 4}" text-anchor="end">${tick > 0 ? "+" : ""}${tick}%</text>`).join("");
  return { y, grid, pad, plotWidth: width - pad.left - pad.right };
}

function equityChart(points, width) {
  if (points.length < 2) return `<p class="backtest-empty">完成的模擬交易少於 2 個樣本日，暫不繪製累積曲線。</p>`;
  const height = 220;
  const { y, grid, pad, plotWidth } = frame(points.flatMap((point) => [point.cumulativeReturn, point.drawdown]), width, height);
  const x = (index) => pad.left + index / (points.length - 1) * plotWidth;
  const line = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.cumulativeReturn).toFixed(1)}`).join("");
  const drawdown = `M${x(0)},${y(0)}${points.map((point, index) => `L${x(index).toFixed(1)},${y(point.drawdown).toFixed(1)}`).join("")}L${x(points.length - 1)},${y(0)}Z`;
  const band = plotWidth / points.length;
  const hits = points.map((point, index) => `<rect class="backtest-hit" x="${(x(index) - band / 2).toFixed(1)}" y="${pad.top}" width="${band.toFixed(1)}" height="${height - pad.top - pad.bottom}" data-cross-x="${x(index).toFixed(1)}" data-cross-y="${y(point.cumulativeReturn).toFixed(1)}" data-tip="${point.date}｜累積 ${signed(point.cumulativeReturn)}｜回撤 ${signed(point.drawdown)}｜當日 ${point.trades} 筆平均 ${signed(point.averageReturn)}"/>`).join("");
  const last = points.at(-1);
  return `<svg class="backtest-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="等權累積報酬曲線，最終 ${signed(last.cumulativeReturn)}">${grid}
    <path class="backtest-drawdown" d="${drawdown}"/><path class="backtest-line" d="${line}"/>
    <text class="backtest-axis" x="${pad.left}" y="${height - 6}">${points[0].date.slice(5).replace("-", "/")}</text><text class="backtest-axis" x="${width - pad.right}" y="${height - 6}" text-anchor="end">${last.date.slice(5).replace("-", "/")}</text>
    <text class="backtest-label" x="${x(points.length - 1) - 4}" y="${y(last.cumulativeReturn) - 8}" text-anchor="end">${signed(last.cumulativeReturn)}</text>
    <line class="backtest-cross" x1="0" x2="0" y1="${pad.top}" y2="${height - pad.bottom}" visibility="hidden"/><circle class="backtest-cross-dot" r="4" visibility="hidden"/>${hits}</svg>
    <p class="backtest-legend"><span class="backtest-key line"></span>累積報酬 <span class="backtest-key area"></span>距前高回撤</p>`;
}

function columnChart(items, { label, value, tip, signedColor = false, ariaLabel, width }) {
  if (!items.length) return `<p class="backtest-empty">沒有可繪製的資料。</p>`;
  const height = 180, pad = { top: 16, right: 8, bottom: 26, left: 8 };
  const max = Math.max(...items.map(value), 1);
  const slot = (width - pad.left - pad.right) / items.length, bar = Math.max(2, Math.min(28, slot - 2));
  const plotHeight = height - pad.top - pad.bottom;
  const columns = items.map((item, index) => {
    const h = value(item) / max * plotHeight, x = pad.left + index * slot + (slot - bar) / 2, top = pad.top + plotHeight - h;
    const radius = Math.min(4, bar / 2, h);
    const shape = h > 0 ? `<path class="backtest-column ${signedColor ? signedColor(item) : ""}" d="M${x},${pad.top + plotHeight}V${top + radius}Q${x},${top} ${x + radius},${top}H${x + bar - radius}Q${x + bar},${top} ${x + bar},${top + radius}V${pad.top + plotHeight}Z"/>` : "";
    const every = Math.ceil(items.length / Math.max(2, Math.floor(width / 64)));
    const showLabel = index % every === 0 || index === items.length - 1 && (items.length - 1) % every >= every / 2;
    return `${shape}${showLabel ? `<text class="backtest-axis" x="${x + bar / 2}" y="${height - 8}" text-anchor="middle">${label(item)}</text>` : ""}<rect class="backtest-hit" x="${pad.left + index * slot}" y="${pad.top}" width="${slot}" height="${plotHeight}" data-tip="${tip(item)}"/>`;
  }).join("");
  return `<svg class="backtest-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${ariaLabel}"><line class="backtest-grid zero" x1="${pad.left}" x2="${width - pad.right}" y1="${pad.top + plotHeight}" y2="${pad.top + plotHeight}"/>${columns}</svg>`;
}

const binLabel = ({ from, to }) => from === null ? `< ${to}%` : to === null ? `≥ ${from}%` : `${from}～${to}%`;

/** Rows with an inline bar for the average return, so the table is also the chart. */
function barTable(caption, rows, horizon) {
  const period = horizon ? `（${horizon} 日）` : "", forwardHead = horizon ? `收盤後 ${horizon} 日平均` : "收盤後同期平均";
  const scale = Math.max(1, ...rows.flatMap((row) => [Math.abs(row.trades.averageReturn ?? 0), Math.abs(row.forward.averageReturn ?? 0)]));
  const bar = (value) => `<span class="backtest-bar-track" aria-hidden="true">${Number.isFinite(value) ? `<span class="backtest-bar ${tone(value)}" style="--bar:${(Math.abs(value) / scale * 50).toFixed(1)}%"></span>` : ""}</span>`;
  return `<div class="backtest-table-wrap"><table class="backtest-table"><caption>${caption}</caption><thead><tr><th scope="col">分組</th><th scope="col">樣本</th><th scope="col">模擬交易</th><th scope="col">勝率</th><th scope="col">平均報酬${period}</th><th scope="col">${forwardHead}</th></tr></thead><tbody>${rows.map((row) => `<tr${row.trades.insufficient ? ' class="thin"' : ""}><th scope="row">${row.label}${row.trades.insufficient ? '<small>樣本不足</small>' : ""}</th><td>${count(row.samples)}</td><td>${count(row.trades.count)}</td><td>${plain(row.trades.winRate)}</td><td class="backtest-bar-cell">${bar(row.trades.averageReturn)}<span class="${tone(row.trades.averageReturn)}">${signed(row.trades.averageReturn)}</span></td><td>${signed(row.forward.averageReturn)}<small>${count(row.forward.count)} 筆</small></td></tr>`).join("")}</tbody></table></div>`;
}

/** Every 2% bin between the lowest and highest observed one, so empty bins keep their place. */
function continuousBins(distribution) {
  if (!distribution.length) return [];
  // The open-ended lowest bin (< -18%) sits in the -20 slot.
  const byFrom = new Map(distribution.map((bin) => [bin.from ?? -20, bin]));
  const low = distribution[0].from ?? -20, high = distribution.at(-1).from ?? 20;
  const bins = [];
  for (let from = low; from <= high; from += 2) bins.push(byFrom.get(from) ?? { from, to: from + 2, count: 0 });
  return bins;
}

function chartsMarkup({ data, meta }, width) {
  const horizon = meta.horizon;
  const buckets = data.readinessBuckets.map((row) => ({ ...row, label: `${row.min}–${row.max}` }));
  const setups = data.setups.map((row) => ({ ...row, label: SETUP_LABELS[row.setupType] }));
  const horizons = data.horizons.map((row) => ({ ...row, label: `持有 ${row.days} 日`, samples: row.forward.count }));
  return `<section class="backtest-section" aria-labelledby="backtest-equity-title"><h2 id="backtest-equity-title">累積報酬與回撤 <small>資金分成持有天數等份，每個樣本日投入一份、平均分配給當日成交的候選；不考慮單日資金上限</small></h2>${equityChart(data.equity, width)}
    ${data.equity.length ? `<details class="backtest-data"><summary>曲線資料表</summary><div class="backtest-table-wrap"><table class="backtest-table"><thead><tr><th scope="col">樣本日</th><th scope="col">交易筆數</th><th scope="col">當日平均</th><th scope="col">累積</th><th scope="col">回撤</th></tr></thead><tbody>${data.equity.map((point) => `<tr><th scope="row">${point.date}</th><td>${point.trades}</td><td>${signed(point.averageReturn)}</td><td>${signed(point.cumulativeReturn)}</td><td>${signed(point.drawdown)}</td></tr>`).join("")}</tbody></table></div></details>` : ""}</section>
  <section class="backtest-section" aria-labelledby="backtest-buckets-title"><h2 id="backtest-buckets-title">準備度分組表現</h2>${barTable("依進場準備度分組（只有通過初步門檻的樣本才有分數）", buckets, horizon)}</section>
  <section class="backtest-section" aria-labelledby="backtest-setups-title"><h2 id="backtest-setups-title">策略比較</h2>${barTable("順勢回踩恢復與整理區間突破", setups, horizon)}</section>
  <section class="backtest-section" aria-labelledby="backtest-horizons-title"><h2 id="backtest-horizons-title">持有 5／10／20 日比較</h2>${barTable("同一批樣本在不同持有天數的表現", horizons, null)}</section>
  <section class="backtest-section" aria-labelledby="backtest-distribution-title"><h2 id="backtest-distribution-title">報酬分布 <small>持有 ${horizon} 日的模擬交易淨報酬，每 2% 一組</small></h2>${columnChart(continuousBins(data.distribution), { width,
    label: binLabel, value: (item) => item.count, signedColor: (item) => (item.from ?? -1) >= 0 ? "up" : "down",
    tip: (item) => `${binLabel(item)}｜${item.count} 筆`, ariaLabel: "模擬交易淨報酬分布" })}
    ${data.distribution.length ? `<p class="backtest-legend"><span class="backtest-key up"></span>獲利（右側） <span class="backtest-key down"></span>虧損（左側）</p>` : ""}</section>
  <section class="backtest-section" aria-labelledby="backtest-daily-title"><h2 id="backtest-daily-title">每日樣本分布 <small>各交易日的明日進場候選數</small></h2>${columnChart(data.daily, { width,
    label: (item) => item.date.slice(5).replace("-", "/"), value: (item) => item.candidates,
    tip: (item) => `${item.date}｜樣本 ${item.samples}｜門檻通過 ${item.gatePass}｜明日候選 ${item.candidates}`, ariaLabel: "每日明日進場候選數" })}</section>`;
}

function sampleRows(samples, horizon) {
  return samples.map((sample) => {
    const trade = sample.outcome.trade?.netReturns?.[horizon], forward = sample.outcome.returns?.[horizon];
    return `<tr data-backtest-sample="${sample.symbol}" data-backtest-date="${sample.tradeDate}" tabindex="0" aria-label="查看 ${sample.symbol} ${sample.tradeDate} 的研究說明"><td>${sample.tradeDate}</td><th scope="row">${sample.symbol}<small>${sample.name ?? ""}</small></th><td>${sample.gate.passed} / 5</td><td>${Number.isFinite(sample.readiness.score) ? Math.round(sample.readiness.score) : "—"}</td><td>${ENTRY_RESEARCH_STATUS_LABELS[sample.entryStatus] ?? sample.entryStatus}${sample.setupType ? `<small>${SETUP_LABELS[sample.setupType]}</small>` : ""}</td><td>${NEXT_DAY_STATUS_LABELS[sample.nextDay.status] ?? sample.nextDay.status}</td><td class="${tone(trade)}">${Number.isFinite(trade) ? signed(trade) : sample.outcome.status === "PENDING" ? "待結果" : "—"}</td><td class="${tone(forward)}">${signed(forward)}</td></tr>`;
  }).join("");
}

function samplesMarkup(state) {
  const { samples, total, horizon, loadingMore, loadingIcon } = state;
  return `<section class="backtest-section" aria-labelledby="backtest-samples-title"><h2 id="backtest-samples-title">研究樣本 <small>共 ${count(total)} 筆，依日期新到舊；點選查看當日保存的說明</small></h2>
    ${samples.length ? `<div class="backtest-table-wrap"><table class="backtest-table backtest-samples"><thead><tr><th scope="col">日期</th><th scope="col">股票</th><th scope="col">門檻</th><th scope="col">準備度</th><th scope="col">研究狀態</th><th scope="col">明日狀態</th><th scope="col">模擬 ${horizon} 日</th><th scope="col">收盤後 ${horizon} 日</th></tr></thead><tbody>${sampleRows(samples, horizon)}</tbody></table></div>
    ${samples.length < total ? `<button type="button" class="outline-button backtest-more" data-backtest-more${loadingMore ? " disabled" : ""}>${loadingMore ? loadingIcon("樣本載入中") : `載入更多（還有 ${count(total - samples.length)} 筆）`}</button>` : ""}`
    : `<p class="backtest-empty">目前條件沒有研究樣本。</p>`}</section>`;
}

/** The saved explanation of one sample, as stored on its trading date. */
export function backtestSampleMarkup(sample, esc) {
  const detail = sample.detail ?? {}, research = detail.research ?? {}, plan = detail.nextDayPlan ?? {};
  const list = (items) => items?.length ? `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : "";
  const price = (value) => Number.isFinite(value) ? value.toFixed(2) : "—";
  const version = sample.modelVersion === "entry-research-v1" ? "v1" : "v2";
  const gates = Object.entries(detail.gate?.conditions ?? {}).map(([key, item]) =>
    `<li class="research-gate-item ${item.status === "PASS" ? "pass" : item.status === "FAIL" ? "fail" : "unknown"}"><div class="research-gate-head"><strong>${GATE_LABELS[version][key] ?? esc(key)}</strong><span class="research-gate-status">${GATE_STATUS[version][item.status] ?? esc(item.status)}</span></div><p>${esc(item.reason ?? "")}</p></li>`).join("");
  const gateHeading = version === "v1" ? `五大核心門檻 <small>${sample.gate.passed} / 5</small>` : "初步門檻（否決條件）";
  const gateFact = version === "v1" ? `${sample.gate.passed} / 5` : sample.gate.status === "PASS" ? "通過" : sample.gate.status === "FAIL" ? `觸發 ${Object.values(sample.gate.conditions ?? {}).filter((status) => status === "FAIL").length} 項` : "待確認";
  const outcome = sample.outcome ?? {}, trade = outcome.trade ?? {};
  const outcomeRows = outcome.status === "PENDING" && !outcome.returns ? "<p>後續交易日尚未完整，結果待更新。</p>"
    : `<dl class="research-plan-table">${[1, 5, 10, 20].map((days) => `<div><dt>收盤後 ${days} 日</dt><dd class="${tone(outcome.returns?.[days])}">${signed(outcome.returns?.[days])}</dd></div>`).join("")}
      <div><dt>20 日最大有利／不利</dt><dd>${signed(outcome.mfe20)} / ${signed(outcome.mae20)}</dd></div>
      <div><dt>模擬交易</dt><dd>${esc(TRADE_STATUS[trade.status] ?? trade.status ?? "—")}${trade.fillDate ? `<small>${esc(trade.fillDate)} 開盤 ${price(trade.fillPrice)}</small>` : ""}</dd></div>
      ${trade.status === "FILLED" ? [5, 10, 20].map((days) => `<div><dt>持有 ${days} 日淨報酬</dt><dd class="${tone(trade.netReturns?.[days])}">${signed(trade.netReturns?.[days])}</dd></div>`).join("") : ""}</dl>`;
  return `<h2 id="dialog-heading">${esc(sample.symbol)} ${esc(sample.name ?? "")}<small class="backtest-dialog-date">${esc(sample.tradeDate)} 收盤後保存</small></h2>
    <p class="dialog-intro">以下為當日保存的研究結果，不會依之後的資料重新計算。模型 ${esc(sample.modelVersion)}${detail.provisional ? "，參數暫定" : ""}。</p>
    <section class="research-plan-card" aria-labelledby="backtest-sample-plan"><p class="research-eyebrow">明日進場評估</p><h3 id="backtest-sample-plan">${esc(NEXT_DAY_STATUS_LABELS[sample.nextDay.status] ?? sample.nextDay.status)}</h3>
      <dl class="research-plan-facts"><div><dt>進場準備度</dt><dd>${Number.isFinite(sample.readiness.score) ? `${Math.round(sample.readiness.score)} / 100` : "—"}</dd></div><div><dt>初步門檻</dt><dd>${gateFact}</dd></div><div><dt>研究狀態</dt><dd>${esc(ENTRY_RESEARCH_STATUS_LABELS[sample.entryStatus] ?? sample.entryStatus)}</dd></div><div><dt>技術型態</dt><dd>${esc(SETUP_LABELS[sample.setupType] ?? "—")}</dd></div></dl>
      ${list(research.status === "TRIGGERED" ? research.triggeredConditions : research.pendingConditions ?? detail.gate?.reasons)}</section>
    ${Number.isFinite(plan.entryReferencePrice) ? `<section class="research-price-plan"><h3>當日價格計畫</h3><dl class="research-plan-table"><div><dt>參考收盤價</dt><dd>${price(plan.referenceClose)}</dd></div><div><dt>進場參考價格</dt><dd>${price(plan.entryReferencePrice)}</dd></div><div><dt>可接受價格上限</dt><dd>${price(plan.entryPriceUpper)}</dd></div><div><dt>策略失效價格</dt><dd>${price(plan.invalidationPrice)}</dd></div><div><dt>預估風險距離</dt><dd>${Number.isFinite(plan.riskPercent) ? `${plan.riskPercent.toFixed(2)}%` : "—"}</dd></div></dl></section>` : ""}
    <section class="research-gates"><h3>${gateHeading}</h3><ol>${gates}</ol></section>
    <section class="research-price-plan"><h3>後續表現</h3>${outcomeRows}<p class="helper-text">報酬以未還原價格計算；期間有除權息、停牌或缺少行情時不比較，也不以 0 補值。</p></section>`;
}

/**
 * Owns the page's filters, requests and rendering. `client` is MarketApiClient; `openSample`
 * shows a sample's saved explanation (markup or a pending promise) in the shared dialog.
 */
export function createBacktestController({ client, apiMode, esc, openSample, loadingIcon }) {
  const root = () => document.querySelector("#backtest-page");
  const state = { filters: { ...DEFAULT_BACKTEST_FILTERS }, result: null, error: null, loading: false, samples: [], total: 0,
    request: 0, loadingMore: false, loaded: false };

  function render() {
    const content = root().querySelector("#backtest-content"), scope = root().querySelector("#backtest-scope");
    root().querySelectorAll("[data-backtest-horizon]").forEach((button) =>
      button.setAttribute("aria-pressed", String(button.dataset.backtestHorizon === state.filters.horizon)));
    if (!apiMode) {
      scope.textContent = "";
      content.innerHTML = `<div class="backtest-empty-state panel"><h2>示範模式沒有研究樣本</h2><p>策略回測只使用正式模式每日收盤後保存的全市場研究樣本與後續實際行情，不以模擬資料產生回測結果。</p><p>${RETENTION_NOTE}</p></div>`;
      return;
    }
    if (state.loading && !state.result) { scope.textContent = ""; content.innerHTML = `<div class="backtest-loading">${loadingIcon("回測資料載入中")}</div>`; return; }
    if (state.error) {
      scope.textContent = "";
      content.innerHTML = `<div class="backtest-empty-state panel" role="alert"><h2>回測資料載入失敗</h2><p>${esc(state.error)}</p><button type="button" class="outline-button" data-backtest-retry>重新載入</button></div>`;
      return;
    }
    const result = state.result;
    scope.textContent = scopeText(result, state.filters);
    content.classList.toggle("is-updating", state.loading);
    if (!result.data.totals.samples) {
      content.innerHTML = `<div class="backtest-empty-state panel"><h2>${Object.entries(state.filters).some(([name, value]) => value && name !== "horizon") ? "目前條件沒有研究樣本" : "尚未累積研究樣本"}</h2><p>每個交易日收盤資料發布後，系統會保存全市場的研究結果；需要再經過 5～20 個交易日，才會有完整的後續表現可供統計。</p><p>${RETENTION_NOTE}</p></div>`;
      return;
    }
    state.width = chartWidth(content);
    content.innerHTML = `${tilesMarkup(result.data, result.meta)}${chartsMarkup(result, state.width)}${samplesMarkup({ ...state, loadingIcon, horizon: result.meta.horizon })}<p class="backtest-note">${RETENTION_NOTE} 回測僅供研究模型參數，不代表未來報酬，也不是買賣建議。</p>`;
  }

  async function load() {
    if (!apiMode) { render(); return; }
    const request = ++state.request, query = backtestQuery(state.filters);
    state.loading = true; state.error = null; render();
    try {
      const [backtest, samples] = await Promise.all([client.backtest(query), client.researchSamples(sampleQuery(0))]);
      if (request !== state.request) return;
      state.result = backtest.data; state.samples = samples.data.data; state.total = samples.data.meta.total;
    } catch (error) {
      if (request !== state.request) return;
      state.error = error.message || "無法取得回測資料";
    }
    state.loading = false; state.loaded = true; render();
  }

  function sampleQuery(offset) {
    const { horizon, ...filters } = state.filters;
    const params = backtestQuery(filters);
    params.set("limit", String(SAMPLE_PAGE)); params.set("offset", String(offset));
    return params;
  }

  async function loadMore() {
    const request = state.request;
    state.loadingMore = true; render();
    try {
      const { data } = await client.researchSamples(sampleQuery(state.samples.length));
      if (request === state.request) state.samples = [...state.samples, ...data.data];
    } catch (error) { if (request === state.request) state.error = error.message; }
    state.loadingMore = false; render();
  }

  function openDetail(symbol, date) {
    const params = new URLSearchParams({ symbol, from: date, to: date, detail: "1", limit: "1" });
    if (state.result?.meta.modelVersion) params.set("model", state.result.meta.modelVersion);
    openSample(client.researchSamples(params).then(({ data }) => {
      const sample = data.data[0];
      if (!sample) throw new Error("找不到這筆研究樣本，可能已超過保留期間。");
      return backtestSampleMarkup(sample, esc);
    }));
  }

  function readForm(form) {
    const values = Object.fromEntries(new FormData(form));
    state.filters = { ...state.filters, ...Object.fromEntries(Object.keys(DEFAULT_BACKTEST_FILTERS)
      .filter((name) => name !== "horizon").map((name) => [name, String(values[name] ?? "").trim()])) };
  }

  // Charts are drawn at the section's pixel width so text keeps its size on every screen.
  const chartWidth = (content) => Math.max(260, Math.round(content.getBoundingClientRect().width) -
    (matchMedia("(max-width: 700px)").matches ? 30 : 38));

  const tooltip = () => root().querySelector("#backtest-tooltip");
  function showTip(target) {
    const tip = tooltip(), svg = target.closest("svg");
    tip.textContent = target.dataset.tip.replaceAll("｜", "\n");
    tip.hidden = false;
    const box = target.getBoundingClientRect(), page = root().getBoundingClientRect();
    const left = Math.min(Math.max(box.left + box.width / 2 - page.left, 80), page.width - 80);
    tip.style.left = `${left}px`; tip.style.top = `${box.top - page.top}px`;
    const cross = svg.querySelector(".backtest-cross"), dot = svg.querySelector(".backtest-cross-dot");
    if (cross && target.dataset.crossX) {
      cross.setAttribute("x1", target.dataset.crossX); cross.setAttribute("x2", target.dataset.crossX);
      dot.setAttribute("cx", target.dataset.crossX); dot.setAttribute("cy", target.dataset.crossY);
      cross.setAttribute("visibility", "visible"); dot.setAttribute("visibility", "visible");
    }
  }
  function hideTip() {
    tooltip().hidden = true;
    root().querySelectorAll(".backtest-cross, .backtest-cross-dot").forEach((mark) => mark.setAttribute("visibility", "hidden"));
  }

  function bind() {
    const page = root(), form = page.querySelector("#backtest-filters");
    let typing;
    form.addEventListener("change", () => { readForm(form); void load(); });
    form.addEventListener("input", (event) => {
      if (event.target.name !== "symbol") return;
      clearTimeout(typing);
      typing = setTimeout(() => { readForm(form); if (/^[0-9A-Z]{0,6}$/i.test(state.filters.symbol)) void load(); }, 400);
    });
    form.addEventListener("submit", (event) => event.preventDefault());
    form.addEventListener("reset", () => { state.filters = { ...DEFAULT_BACKTEST_FILTERS }; setTimeout(() => void load()); });
    page.addEventListener("click", (event) => {
      const horizon = event.target.closest("[data-backtest-horizon]");
      if (horizon) { state.filters.horizon = horizon.dataset.backtestHorizon; void load(); return; }
      if (event.target.closest("[data-backtest-retry]")) { void load(); return; }
      if (event.target.closest("[data-backtest-more]")) { void loadMore(); return; }
      const row = event.target.closest("[data-backtest-sample]");
      if (row) openDetail(row.dataset.backtestSample, row.dataset.backtestDate);
      const hit = event.target.closest("[data-tip]");
      if (hit) showTip(hit);
    });
    page.addEventListener("keydown", (event) => {
      const row = event.target.closest?.("[data-backtest-sample]");
      if (row && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openDetail(row.dataset.backtestSample, row.dataset.backtestDate); }
    });
    let resizing;
    addEventListener("resize", () => {
      clearTimeout(resizing);
      resizing = setTimeout(() => {
        const content = page.querySelector("#backtest-content");
        if (!page.hidden && state.result && chartWidth(content) !== state.width) render();
      }, 150);
    });
    page.addEventListener("pointerover", (event) => { const hit = event.target.closest?.("[data-tip]"); if (hit) showTip(hit); });
    page.addEventListener("pointerout", (event) => { if (event.target.closest?.("[data-tip]") && !event.relatedTarget?.closest?.("[data-tip]")) hideTip(); });
  }

  return {
    bind,
    /** Called whenever the page becomes visible; loads once, later visits keep the last result. */
    show() { if (!state.loaded && !state.loading) void load(); else render(); },
    reload: load,
  };
}
