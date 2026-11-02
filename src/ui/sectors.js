import { getSectorOverview, getSectorDetail } from "../../shared/sectors.js";
export function renderSectorOverviewView(context) {
  const { state, dataset, loading, loadFailed, latestSnapshots, sectorOverviews, loadingIcon, updateSegmentedControl, renderSectorDialog, direction, esc, percent, institutionalFigures } = context;
  if (loading || loadFailed) {
    document.querySelector("#sector-grid").innerHTML = loading
      ? `<div class="sector-loading-fields" aria-label="產業統計載入中">${["產業排名", "當日平均漲跌", "法人淨買賣超金額"].map((label) => `<div><span>${label}</span>${loadingIcon()}</div>`).join("")}</div>` : "";
    return;
  }
  const days = state.sectorWindow === "day" ? 1 : Number(state.sectorWindow);
  const sectors = sectorOverviews ? [...(sectorOverviews[state.sectorWindow] ?? [])] : getSectorOverview(latestSnapshots, {
    window: state.sectorWindow, sort: state.sectorSort,
    tradingDates: dataset.dates, asOf: dataset.info.asOf,
  });
  if (sectorOverviews) {
    if (state.sectorSort === "name-asc") sectors.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
    if (state.sectorSort === "net-asc") sectors.sort((a, b) => {
      if (a.estimate.amount === null) return b.estimate.amount === null ? 0 : 1;
      if (b.estimate.amount === null) return -1;
      return a.estimate.amount - b.estimate.amount;
    });
    let rank = 0;
    for (const sector of sectors) sector.rank = Number.isFinite(sector.estimate.amount) ? ++rank : null;
  }
  document.querySelectorAll("[data-sector-window]").forEach((button) =>
    button.setAttribute("aria-pressed", button.dataset.sectorWindow === state.sectorWindow));
  document.querySelectorAll("[data-sector-sort]").forEach((button) =>
    button.setAttribute("aria-pressed", button.dataset.sectorSort === state.sectorSort));
  document.querySelectorAll(".sector-toolbar .segmented-control").forEach(updateSegmentedControl);
  document.querySelector("#sector-change-label").textContent = days === 1
    ? "當日平均漲跌" : `${days} 日平均漲跌`;
  const maxAmount = Math.max(1, ...sectors.map((sector) => Math.abs(sector.estimate.amount ?? 0)));
  document.querySelector("#sector-grid").innerHTML = sectors.map((sector) => {
    const { leader, leaderValue, leaderChange } = sector;
    const periodLabel = days === 1 ? "" : `${days} 日 `;
    const leaderText = leaderValue === null ? "" : `TOP1·${leader.name}`;
    const ranked = Number.isFinite(sector.estimate.amount);
    const bar = ranked ? `<i class="${direction(sector.estimate.amount)}" style="--sector-bar:${Math.max(4, Math.round((Math.abs(sector.estimate.amount) / maxAmount) * 100))}%"></i>` : "";
    return `<article class="sector-card" data-sector-name="${esc(sector.name)}" data-sector-details="${esc(sector.name)}" role="button" tabindex="0" aria-haspopup="dialog" aria-controls="sector-dialog" aria-label="查看${esc(sector.name)}產業個股與法人買賣超"><div class="sector-main"><span class="sector-rank">${sector.rank ?? ""}</span><span class="sector-marker ${direction(sector.estimate.amount)}"></span><div class="sector-identity"><h3>${esc(sector.name)}</h3><p>${periodLabel}<span>${esc(leaderText)}</span> <span class="${direction(leaderChange)}">${leader ? percent(leaderChange) : ""}</span></p><small class="sector-breadth" data-sector-breadth title="所選區間淨買賣超金額為正的家數／金額資料完整的有效家數">${sector.estimate.available ? `買超 ${sector.estimate.buying}／${sector.estimate.available} 檔` : ""}</small></div><strong class="sector-change ${direction(sector.change)}">${percent(sector.change)}</strong><div class="sector-total">${institutionalFigures(sector.estimate.amount, sector.total, 'data-sector-amount', 'data-sector-lots')}${bar}</div></div></article>`;
  }).join("");
  if (document.querySelector("#sector-dialog")?.open) renderSectorDialog(state.sectorName);
}

export function renderSectorDialogView(name, context) {
  const { dataset, latestSnapshots, sectorDetail, isDemo, esc, number, direction, percent, institutionSparkline, institutionalFigures, institutionalMoney } = context;
  // Summary cells pair each amount with its share of the cohort's traded volume.
  const summaryFigures = (amount, ratio, key) => `<strong class="institution-money ${direction(amount)}" data-sector-money="${key}">${institutionalMoney(amount)}</strong><small class="institution-lots" data-sector-ratio="${key}" title="占量：淨買賣超股數／同期成交股數">${Number.isFinite(ratio) ? percent(ratio) : ""}</small>`;
  const detail = sectorDetail ?? (isDemo ? getSectorDetail(latestSnapshots, name, { tradingDates: dataset.dates, asOf: dataset.info.asOf }) : null);
  if (!detail) return;
  const { members, tradingDates } = detail;
  const periods = [["day", "當日"], ["5", "5 日"], ["20", "20 日"]];

  document.querySelector("#sector-dialog-heading").textContent = name;
  document.querySelector("#sector-dialog-meta").textContent = `${isDemo ? "最新完整交易日" : "報表交易日"} ${tradingDates.at(-1)}`;
  document.querySelector("#sector-dialog-content").innerHTML = `
    <section class="sector-detail-summary" aria-labelledby="sector-summary-heading">
      <div class="sector-detail-heading"><div><h3 id="sector-summary-heading">法人淨買賣超金額</h3><p>當日與近 5／20 個交易日累計；金額：億。占量＝淨買賣超股數／同期成交股數</p></div></div>
      <div class="sector-summary-grid"><div class="sector-summary-labels" aria-hidden="true"><span></span>${["合計", "外資", "投信", "自營商"].map((label) => `<span>${label}</span>`).join("")}</div>${periods.map(([key, label]) => {
        const { estimate, ratio, institutions } = detail.periods[key];
        return `<article class="sector-summary-period" data-sector-period="${key}" aria-label="${label}法人買賣超"><header><h4>${label}</h4><div class="sector-summary-values"><span class="sr-only">合計</span>${summaryFigures(estimate.amount, ratio, "total")}</div></header><dl>${["外資", "投信", "自營商"].map((institution) => {
          const { amount: money, ratio: share } = institutions[institution];
          return `<div><dt>${institution}</dt><dd>${summaryFigures(money, share, institution)}</dd></div>`;
        }).join("")}</dl></article>`;
      }).join("")}</div>
    </section>
    <section class="sector-stock-section" aria-labelledby="sector-stock-heading">
      <div class="sector-detail-heading"><div><h3 id="sector-stock-heading">產業個股</h3><p>依當日淨買賣超金額排序；金額：億，張數為輔</p><p class="sector-chart-note">5 日柱圖：每日淨額，左舊右新、各股獨立比例尺。法人占量＝當日淨買賣超股數／成交股數。</p></div></div>
      <div class="sector-stock-scroll" tabindex="0" role="region" aria-label="${esc(name)}個股股價與法人買賣超">
        <table class="sector-stock-table"><caption class="sr-only">${esc(name)}各股最新收盤價、日漲跌幅及當日、5 日、20 日法人淨買賣超金額（億）與張數（張）</caption><colgroup><col class="sector-stock-name-column"><col class="sector-stock-price-column">${periods.map(() => '<col class="sector-stock-net-column">').join("")}</colgroup><thead><tr><th scope="col">股票</th><th scope="col">收盤價／日漲跌</th>${periods.map(([, label]) => `<th scope="col">${label}金額／張數</th>`).join("")}</tr></thead><tbody>${members.map(({ stock, periods: values, volumeRatio }) => `<tr data-sector-stock="${stock.symbol}"><th scope="row"><span class="sector-stock-name"><strong>${esc(stock.name)}</strong><small>${stock.symbol}</small></span></th><td class="sector-stock-price"><span class="sector-stock-close">${number(stock.latest?.close, 2)}</span><small class="sector-stock-change ${direction(stock.latest?.changePercent)}">${percent(stock.latest?.changePercent)}</small></td>${periods.map(([key, label]) => {
          const { shares: value, amount } = values[key];
          const ratio = key === "day" ? volumeRatio : null;
          const extra = key === "day"
            ? `<small class="institution-volume-ratio" data-institution-ratio title="當日三大法人淨買賣超股數 ÷ 當日成交股數 × 100%">${ratio === null ? "" : `法人占量 <span class="${direction(ratio)}">${percent(ratio)}</span>`}</small>`
            : key === "5" ? institutionSparkline(stock, tradingDates) : "";
          return `<td class="sector-stock-net" data-sector-net="${key}"><span class="sector-stock-period-label" aria-hidden="true">${label}</span>${institutionalFigures(amount, value)}${extra}</td>`;
        }).join("")}</tr>`).join("")}</tbody></table>
      </div>
    </section>`;
}

