// ETF detail sections. ETFs get no entry research, so the dialog shows what is known about them instead:
// the technical read the list already has, how the price moved, institutional flow and the fund's own facts.

const tone = (value) => value > 0 ? "up" : value < 0 ? "down" : "";
const signedPercent = (value) => Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%` : "—";
const shortDate = (date) => date ? date.slice(5).replace("-", "/") : "—";
const signedMoney = (value, number) => {
  if (!Number.isFinite(value)) return "—";
  const size = Math.abs(value);
  return `${value > 0 ? "+" : value < 0 ? "-" : ""}${size >= 1e8 ? `${number(size / 1e8, 2)} 億` : `${number(size / 1e4)} 萬`}`;
};
const tile = (label, value, note = "", className = "") =>
  `<div><dt>${label}</dt><dd class="${className}">${value}</dd>${note ? `<small>${note}</small>` : ""}</div>`;

/** The four reads the market list shows as chips, laid out as the dialog's opening card. */
export function etfSummaryMarkup(stock, { esc, number }) {
  const bar = stock.latest ?? {};
  const trend = stock.trend ?? { label: "資料不足", reason: "歷史行情不足" };
  const volume = stock.priceVolume?.rvol20 == null ? null : stock.priceVolume;
  const kd = Number.isFinite(bar.k) && Number.isFinite(bar.d);
  const deviation = Number.isFinite(bar.deviation) ? bar.deviation : null;
  return `<section class="etf-summary" aria-label="技術摘要"><dl class="etf-tiles">${[
    tile("趨勢", esc(trend.label), esc(trend.reason ?? "")),
    tile("量價", esc(volume?.label ?? "資料不足"), volume ? `${number(volume.rvol20, 2)} 倍均量` : ""),
    tile("KD", kd ? `${number(bar.k, 2)} / ${number(bar.d, 2)}` : "資料不足", esc(stock.signal?.label ?? "")),
    tile("季線", deviation === null ? "資料不足" : deviation > 0 ? "之上" : deviation < 0 ? "之下" : "持平",
      deviation === null ? "" : signedPercent(deviation), tone(deviation)),
  ].join("")}</dl></section>`;
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

export function etfPerformanceMarkup(series) {
  const performance = etfPerformance(series);
  if (!performance) return "";
  const cell = (label, value) => tile(label, signedPercent(value), "", tone(value));
  return `<section class="etf-section etf-performance" aria-labelledby="etf-performance-title"><h3 id="etf-performance-title">區間表現 <small>未還原價格</small></h3><dl class="etf-tiles">${[
    cell("近 5 日", performance.change5), cell("近 20 日", performance.change20),
    cell(`距 ${performance.sessions} 日高點`, performance.fromHigh), cell(`距 ${performance.sessions} 日低點`, performance.fromLow),
  ].join("")}</dl></section>`;
}

/** Net institutional buying over the day, 5 and 20 sessions: net shares × each close, an estimate. */
export function etfFlowMarkup(money, { number }) {
  if (!money) return "";
  const cell = (label, window) => { const value = money[window]?.total; return tile(label, signedMoney(value, number), "", tone(value)); };
  const parts = ["外資", "投信", "自營商"].map((name) => {
    const value = money.day?.[name];
    return `<span>${name} <b class="${tone(value)}">${signedMoney(value, number)}</b></span>`;
  }).join("");
  return `<section class="etf-section etf-flow" aria-labelledby="etf-flow-title"><h3 id="etf-flow-title">三大法人淨買賣 <small>估算</small></h3><dl class="etf-tiles three">${[
    cell("當日", "day"), cell("近 5 日", "5"), cell("近 20 日", "20"),
  ].join("")}</dl><p class="etf-flow-parts">當日 ${parts}</p></section>`;
}

const row = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;

/**
 * Fund facts from the API: `undefined` while loading, `null` when they could not be read.
 * Every figure is optional; a part with nothing known is left out rather than shown as zero.
 */
export function etfFundMarkup(fund, { esc, number }, loadingIcon = () => "") {
  if (fund === undefined) return `<section class="etf-section etf-fund etf-fund-pending">${loadingIcon("基金資料載入中")}</section>`;
  const { profile, nav, size, dividends = [], trailing, upcoming } = fund ?? {};
  if (!profile && !nav && !dividends.length)
    return `<section class="etf-section etf-fund"><h3>基金資料</h3><p class="etf-empty">${fund === null ? "基金資料暫時無法讀取。" : "尚未取得這檔 ETF 的基金資料。"}</p></section>`;
  const premium = nav && Number.isFinite(nav.premiumPercent) ? nav.premiumPercent : null;
  const navBlock = nav ? `<div class="etf-fund-block"><h4>折溢價 <small>${esc(shortDate(nav.date))} 預估淨值</small></h4><dl class="etf-tiles three">${[
    tile("市價", Number.isFinite(nav.marketPrice) ? number(nav.marketPrice, 2) : "—"),
    tile("預估淨值", number(nav.estimated, 2)),
    tile(premium === null ? "折溢價" : premium > 0 ? "溢價" : premium < 0 ? "折價" : "平價", signedPercent(premium), "", tone(premium)),
  ].join("")}</dl></div>` : "";
  const yieldText = trailing && Number.isFinite(trailing.yieldPercent) ? `${trailing.yieldPercent.toFixed(2)}%` : "—";
  const paid = dividends.filter((item) => Number.isFinite(item.amount));
  const dividendBlock = trailing || upcoming || paid.length ? `<div class="etf-fund-block"><h4>配息 <small>近一年配息合計 ÷ 收盤價</small></h4><dl class="etf-tiles three">${[
    tile("近一年殖利率", yieldText),
    tile("近一年配息", trailing ? `${number(trailing.amount, 3)} 元` : "—", trailing ? `${trailing.count} 次` : ""),
    tile("下次除息", upcoming ? esc(shortDate(upcoming.exDate)) : "未公告", upcoming ? (Number.isFinite(upcoming.amount) ? `${number(upcoming.amount, 3)} 元` : "金額未公告") : ""),
  ].join("")}</dl>${paid.length ? `<table class="etf-dividends"><thead><tr><th scope="col">除息日</th><th scope="col">發放日</th><th scope="col">每單位配息</th></tr></thead><tbody>${
    paid.slice(0, 6).map((item) => `<tr><td>${esc(item.exDate)}</td><td>${esc(item.payDate ?? "—")}</td><td>${number(item.amount, 3)}</td></tr>`).join("")}</tbody></table>` : ""}</div>` : "";
  const profileBlock = profile || Number.isFinite(size) ? `<dl class="etf-facts">${[
    profile?.indexName ? row("追蹤指數", esc(profile.indexName)) : "",
    profile?.fundType ? row("基金類型", esc(profile.fundType)) : "",
    profile?.listedDate ? row("上市日期", esc(profile.listedDate)) : "",
    Number.isFinite(size) ? row("規模（估算）", `${number(size / 1e8, size >= 1e10 ? 0 : 2)} 億元`) : "",
  ].join("")}</dl>` : "";
  return `<section class="etf-section etf-fund" aria-labelledby="etf-fund-title"><h3 id="etf-fund-title">基金資料</h3>${profileBlock}${navBlock}${dividendBlock}</section>`;
}
