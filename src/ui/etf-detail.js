// ETF detail sections. ETFs get no entry research. What an ETF holder asks first is about distributions:
// how often it pays, when it goes ex-dividend, the last day to buy and when the money arrives. Those lead
// the dialog; the fund's own facts follow, and the technical read and institutional flow close it, folded.

const tone = (value) => value > 0 ? "up" : value < 0 ? "down" : "";
const signedPercent = (value) => Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%` : "—";
const shortDate = (date) => date ? date.slice(5).replace("-", "/") : "—";
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const dayText = (date) => date ? `${shortDate(date)}（${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]}）` : "未公告";
const signedMoney = (value, number) => {
  if (!Number.isFinite(value)) return "—";
  const size = Math.abs(value);
  return `${value > 0 ? "+" : value < 0 ? "-" : ""}${size >= 1e8 ? `${number(size / 1e8, 2)} 億` : `${number(size / 1e4)} 萬`}`;
};
const tile = (label, value, note = "", className = "") =>
  `<div><dt>${label}</dt><dd class="${className}">${value}</dd>${note ? `<small>${note}</small>` : ""}</div>`;
const amountText = (amount, number) => Number.isFinite(amount) ? `${number(amount, 3)} 元` : "未公告";

/**
 * The distribution card that leads the dialog. `fund` is `undefined` while loading and `null` when it
 * could not be read. The next announced distribution is shown when there is one; otherwise the latest
 * one already ex-dividend, said to be past so it is not read as a date still ahead.
 */
export function etfDividendCardMarkup(fund, { esc, number }, loadingIcon = () => "") {
  if (fund === undefined) return `<section class="etf-dividend-card etf-pending" aria-label="配息">${loadingIcon("配息資料載入中")}</section>`;
  const { dividends = [], frequency, trailing, upcoming, latest } = fund ?? {};
  const head = (badge) => `<div class="etf-dividend-head"><h3 id="etf-dividend-title">配息</h3>${badge ? `<span class="etf-frequency">${esc(badge)}</span>` : ""}</div>`;
  if (fund === null) return `<section class="etf-dividend-card" aria-labelledby="etf-dividend-title">${head("")}<p class="etf-empty">配息資料暫時無法讀取。</p></section>`;
  const event = upcoming ?? latest;
  if (!event && !dividends.length)
    return `<section class="etf-dividend-card" aria-labelledby="etf-dividend-title">${head("")}<p class="etf-empty">近一年沒有配息紀錄，也沒有已公告的除息日。</p></section>`;
  const badge = frequency?.label ?? (trailing ? `近一年配息 ${trailing.count} 次` : "");
  const eventBlock = event ? `<p class="etf-dividend-when">${upcoming ? "下次配息" : "最近一次配息 <small>已除息，下次尚未公告</small>"}</p>
    <dl class="etf-tiles etf-dividend-dates">${[
    tile("最後買進日", esc(dayText(event.lastBuyDate)), "這天收盤前買進才領得到"),
    tile("除息日", esc(dayText(event.exDate)), "當天起買進不配息"),
    tile("領息日", esc(dayText(event.payDate)), event.payDate ? "配息入帳" : ""),
    tile("每單位配息", amountText(event.amount, number), Number.isFinite(event.amount) ? "" : "金額尚未公告"),
  ].join("")}</dl>` : "";
  const yieldText = trailing && Number.isFinite(trailing.yieldPercent) ? `${trailing.yieldPercent.toFixed(2)}%` : "—";
  const summary = `<dl class="etf-tiles two etf-dividend-year">${[
    tile("近一年殖利率", yieldText, "近一年配息合計 ÷ 收盤價"),
    tile("近一年配息", trailing ? `${number(trailing.amount, 3)} 元` : "—", trailing ? `共 ${trailing.count} 次` : "沒有已除息的配息"),
  ].join("")}</dl>`;
  return `<section class="etf-dividend-card" aria-labelledby="etf-dividend-title">${head(badge)}${eventBlock}${summary}
    <p class="etf-note">最後買進日為除息日前一個交易日，遇休市會再提前；實際日期以投信公告為準。</p></section>`;
}

/** Past and announced distributions, newest first, each with its last day to buy. */
export function etfDividendHistoryMarkup(fund, { esc, number }) {
  const rows = (fund?.dividends ?? []).slice(0, 8);
  if (!rows.length) return "";
  return `<section class="etf-section etf-dividend-history" aria-labelledby="etf-history-title"><h3 id="etf-history-title">配息紀錄</h3>
    <table class="etf-dividends"><thead><tr><th scope="col">最後買進日</th><th scope="col">除息日</th><th scope="col">領息日</th><th scope="col">每單位配息</th></tr></thead><tbody>${
    rows.map((item) => `<tr><td>${esc(shortDate(item.lastBuyDate))}</td><td>${esc(item.exDate)}</td><td>${esc(item.payDate ?? "未公告")}</td><td>${Number.isFinite(item.amount) ? number(item.amount, 3) : "未公告"}</td></tr>`).join("")}</tbody></table></section>`;
}

const monthTitle = (month) => `${month.slice(0, 4)} 年 ${month.slice(5)} 月`;

/** Ex-dividend and payment days by the chart month they fall in; days outside the chart's months are left out. */
export function etfMonthEvents(fund, months) {
  const events = new Map(months.map((month) => [month, []]));
  for (const item of fund?.dividends ?? []) {
    events.get(item.exDate?.slice(0, 7))?.push({ type: "ex", date: item.exDate, amount: item.amount });
    events.get(item.payDate?.slice(0, 7))?.push({ type: "pay", date: item.payDate, amount: item.amount });
  }
  for (const list of events.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return events;
}
const eventText = (event, number) => `${shortDate(event.date)} ${event.type === "ex" ? "除息" : "發息"}${Number.isFinite(event.amount) ? ` ${number(event.amount, 3)} 元` : ""}`;

/**
 * Two lanes under the monthly chart, 除息 and 發息, with a mark at each month that has one. The marks sit at
 * the same horizontal positions as the chart's points (8…592 of its 600-unit width).
 */
export function etfChartEventsMarkup(fund, months, { esc, number }) {
  const events = etfMonthEvents(fund, months);
  if (![...events.values()].some((list) => list.length)) return "";
  const left = (index) => ((8 + index * 584 / Math.max(1, months.length - 1)) / 600 * 100).toFixed(2);
  const lane = (type, label) => `<div class="etf-event-lane ${type}"><span>${label}</span><div>${months.map((month, index) => {
    const marks = events.get(month).filter((event) => event.type === type);
    return marks.length ? `<i style="left:${left(index)}%" title="${esc(marks.map((event) => eventText(event, number)).join("、"))}"></i>` : "";
  }).join("")}</div></div>`;
  return `<div class="etf-chart-events" aria-hidden="true">${lane("ex", "除息")}${lane("pay", "發息")}</div>`;
}

/**
 * One panel per chart month, under the chart: that month's ex-dividend and payment days and its top
 * holdings. Only the chosen month's panel shows; the latest month is chosen first. Holdings come from the
 * fund association's monthly report, which appears weeks after month end: a month without its own report
 * shows the latest earlier one and names it, never passing it off as that month's.
 */
export function etfMonthPanelsMarkup(fund, months, { esc, number }) {
  if (!fund || !months.length) return "";
  const events = etfMonthEvents(fund, months), reports = fund.holdings?.months ?? [];
  const panels = months.map((month, index) => {
    const list = events.get(month);
    const eventLine = list.length ? list.map((event) => esc(eventText(event, number))).join("　·　") : "這個月沒有除息或發息。";
    // Newest first: the first report not after this month, else the oldest one stored.
    const report = reports.find((item) => item.month <= month) ?? reports.at(-1);
    let holdings = `<h4>成分股</h4><p class="etf-empty">投信投顧公會的月報沒有這檔 ETF 的持股（新上市、期貨型或槓桿反向型常見）。</p>`;
    if (report) {
      const top = Math.max(...report.items.map((item) => item.weight), 0), total = report.items.reduce((sum, item) => sum + item.weight, 0);
      const rows = report.items.map((item) => {
        const label = `${esc(item.name ?? "—")}${item.code ? ` <small>${esc(item.code)}</small>` : ""}`;
        const name = item.kind === "國內上市" && /^\d{4}$/.test(item.code ?? "")
          ? `<button type="button" class="etf-holding-name" data-entry-score="${esc(item.code)}" aria-label="查看${esc(item.name ?? item.code)}">${label}</button>`
          : `<span class="etf-holding-name">${label}</span>`;
        return `<li><span class="etf-holding-rank">${item.rank}</span>${name}<span class="etf-holding-weight">${number(item.weight, 2)}%</span>
          <i class="etf-holding-bar" style="--share:${top > 0 ? (Math.max(item.weight, 0) / top * 100).toFixed(1) : 0}%"></i></li>`;
      }).join("");
      const other = report.month === month ? "" : `這個月的月報${report.month < month ? "尚未公布" : "沒有保存"}，顯示 ${esc(monthTitle(report.month))}的持股。`;
      holdings = `<h4>成分股 <small>前 ${report.items.length} 大 · ${esc(monthTitle(report.month))}月報</small></h4><ol class="etf-holding-list">${rows}</ol>
        <p class="etf-note">${other}前 ${report.items.length} 大合計占淨資產 ${number(total, 2)}%。資料為投信投顧公會月報，每月更新一次，不是每日持股。</p>`;
    }
    return `<div class="etf-month-panel" data-etf-month="${esc(month)}"${index === months.length - 1 ? "" : " hidden"}><h3>${esc(monthTitle(month))} <small>點走勢圖上的月份可切換</small></h3>
      <p class="etf-month-events">${eventLine}</p>${holdings}</div>`;
  }).join("");
  return `<section class="etf-section etf-month" aria-label="所選月份的配息與成分股" aria-live="polite">${panels}</section>`;
}

/** Shows the panel of the month chosen on the chart. */
export function showEtfMonth(root, month) {
  const panels = [...(root?.querySelectorAll("[data-etf-month]") ?? [])];
  if (!panels.some((panel) => panel.dataset.etfMonth === month)) return;
  for (const panel of panels) panel.hidden = panel.dataset.etfMonth !== month;
}

const row = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;

/** The fund's own facts and its premium or discount. */
export function etfFundMarkup(fund, { esc, number }) {
  if (!fund) return "";
  const { profile, nav, size, sizeBasis, holders } = fund;
  if (!profile && !nav && !Number.isFinite(size)) return "";
  const premium = nav && Number.isFinite(nav.premiumPercent) ? nav.premiumPercent : null;
  const facts = [
    profile?.indexName && profile.indexName !== "不適用" ? row("追蹤指數", esc(profile.indexName)) : "",
    profile?.fundType ? row("基金類型", esc(profile.fundType)) : "",
    profile?.issuer ? row("發行公司", esc(profile.issuer)) : "",
    profile?.listedDate ? row("上市日期", esc(profile.listedDate)) : "",
    Number.isFinite(size) ? row(sizeBasis === "reported" ? "基金規模" : "規模（估算）", `${number(size / 1e8, size >= 1e10 ? 0 : 2)} 億元`) : "",
    Number.isFinite(holders) ? row("受益人數", `${number(holders)} 人`) : "",
  ].join("");
  const navBlock = nav ? `<div class="etf-fund-block"><h4>折溢價 <small>${esc(shortDate(nav.date))} 預估淨值</small></h4><dl class="etf-tiles three">${[
    tile("市價", Number.isFinite(nav.marketPrice) ? number(nav.marketPrice, 2) : "—"),
    tile("預估淨值", number(nav.estimated, 2)),
    tile(premium === null ? "折溢價" : premium > 0 ? "溢價" : premium < 0 ? "折價" : "平價", signedPercent(premium), "", tone(premium)),
  ].join("")}</dl></div>` : "";
  return `<section class="etf-section etf-fund" aria-labelledby="etf-fund-title"><h3 id="etf-fund-title">基金資料</h3>${facts ? `<dl class="etf-facts">${facts}</dl>` : ""}${navBlock}</section>`;
}

/** Price change over 5 and 20 sessions and the distance to the 30-session closing high and low; unadjusted. */
export function etfPerformance(series) {
  const closes = (series ?? []).map((point) => Number.isFinite(point.close) && point.close > 0 ? point.close : null);
  const last = closes.at(-1);
  if (!last) return null;
  const change = (sessions) => { const base = closes.at(-1 - sessions); return base ? (last / base - 1) * 100 : null; };
  const known = closes.filter(Boolean);
  return { change5: change(5), change20: change(20), sessions: closes.length,
    fromHigh: (last / Math.max(...known) - 1) * 100, fromLow: (last / Math.min(...known) - 1) * 100 };
}

/** Secondary for an ETF: the technical read, period performance and institutional flow, folded by default. */
export function etfTechnicalMarkup(stock, series, { esc, number }) {
  const bar = stock.latest ?? {};
  const trend = stock.trend ?? { label: "資料不足", reason: "歷史行情不足" };
  const volume = stock.priceVolume?.rvol20 == null ? null : stock.priceVolume;
  const kd = Number.isFinite(bar.k) && Number.isFinite(bar.d);
  const deviation = Number.isFinite(bar.deviation) ? bar.deviation : null;
  const read = `<dl class="etf-tiles">${[
    tile("趨勢", esc(trend.label), esc(trend.reason ?? "")),
    tile("量價", esc(volume?.label ?? "資料不足"), volume ? `${number(volume.rvol20, 2)} 倍均量` : ""),
    tile("KD", kd ? `${number(bar.k, 2)} / ${number(bar.d, 2)}` : "資料不足", esc(stock.signal?.label ?? "")),
    tile("季線", deviation === null ? "資料不足" : deviation > 0 ? "之上" : deviation < 0 ? "之下" : "持平",
      deviation === null ? "" : signedPercent(deviation), tone(deviation)),
  ].join("")}</dl>`;
  const performance = etfPerformance(series);
  const cell = (label, value) => tile(label, signedPercent(value), "", tone(value));
  const performanceBlock = performance ? `<div class="etf-fund-block etf-performance"><h4>區間表現 <small>未還原價格</small></h4><dl class="etf-tiles">${[
    cell("近 5 日", performance.change5), cell("近 20 日", performance.change20),
    cell(`距 ${performance.sessions} 日高點`, performance.fromHigh), cell(`距 ${performance.sessions} 日低點`, performance.fromLow),
  ].join("")}</dl></div>` : "";
  const money = stock.money;
  const flowCell = (label, window) => { const value = money[window]?.total; return tile(label, signedMoney(value, number), "", tone(value)); };
  const flowBlock = money ? `<div class="etf-fund-block etf-flow"><h4>三大法人淨買賣 <small>估算</small></h4><dl class="etf-tiles three">${[
    flowCell("當日", "day"), flowCell("近 5 日", "5"), flowCell("近 20 日", "20"),
  ].join("")}</dl></div>` : "";
  return `<details class="etf-section etf-technical"><summary>技術面與法人 <small>趨勢、量價、KD、季線、區間表現</small></summary>${read}${performanceBlock}${flowBlock}</details>`;
}
