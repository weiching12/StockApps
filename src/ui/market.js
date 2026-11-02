import { filterStocks, getDominantInstitution } from "../../shared/indicators.js";
import { compareResearchStocks, matchesResearchFilter, researchListCells, researchSummaryOf } from "./entry-research.js";

export function entryScoreChangePresentation(stock, number) {
  const entry = stock.entryScore, change = stock.entryScoreChange;
  const date = entry?.asOf ?? "所選日期";
  const reasons = (change?.missingData ?? entry?.missingData ?? []).join("；");
  if (!Number.isFinite(entry?.finalScore)) return { label: "當日資料不足",
    title: `${date} 無法評分${reasons ? `：${reasons}` : ""}` };
  if (Number.isFinite(change?.delta)) return {
    label: `較前期 ${change.delta > 0 ? "+" : ""}${number(change.delta, 2)}`,
    title: `${date} 與 ${change.previousDate} 的株研評分差額`,
  };
  if (change?.status === "no-previous-session" || change?.previousDate === null)
    return { label: "尚無前期資料", title: `${date} 之前沒有可比較的市場交易日` };
  if (change?.status === "missing-previous") return { label: "前期資料不足",
    title: `${change.previousDate} 無法評分${reasons ? `：${reasons}` : ""}` };
  // Older offline summaries may have no reason metadata. Do not guess which data is missing.
  return { label: "前期無法比較", title: "尚無可用的前期比較結果，連線後請重新整理" };
}

export function renderMarketView(context) {
  const { state, snapshots, pendingSymbols, stockMoney, tableState, TABLE_BATCH_SIZE, tableRowCache, loading, loadFailed, dataset, isDemo, esc, icon, number, percent, direction, institutionalMoney, institutionalAmount, loadingIcon, pendingField, updateSegmentedControl } = context;
  const visibleStocks = filterStocks(snapshots, state).filter((stock) => matchesResearchFilter(stock, state.research));
  if (["all", "favorites"].includes(state.view) && (!state.research || state.research === "all")) {
    const query = state.query.trim().toLocaleLowerCase();
    visibleStocks.push(...snapshots.filter((stock) => pendingSymbols.has(stock.symbol) &&
      (state.sector === "all" || stock.sector === state.sector) &&
      (state.view !== "favorites" || state.favorites.includes(stock.symbol)) &&
      (!query || `${stock.symbol} ${stock.name}`.toLocaleLowerCase().includes(query))));
  }
  if (state.sort === "symbol") visibleStocks.sort((a, b) => a.symbol.localeCompare(b.symbol) * state.sortDirection);
  else if (state.sort)
    visibleStocks.sort((a, b) => {
      if (!a.latest) return b.latest ? 1 : 0;
      if (!b.latest) return -1;
      const value = (stock) => state.sort === "readiness" ? researchSummaryOf(stock)?.score ?? null :
        state.sort === "institutionalNet" ? stockMoney(stock, "total", "day") : stock.latest[state.sort] ?? null;
      const av = value(a), bv = value(b);
      if (av === null) return bv === null ? 0 : 1;
      if (bv === null) return -1;
      return (av - bv) * state.sortDirection;
    });
  else visibleStocks.sort(compareResearchStocks);
  const sortSelect = document.querySelector("#market-sort");
  if (sortSelect) sortSelect.value = [...sortSelect.options].some((option) => option.value === state.sort) ? state.sort : "";
  const nextViewKey = [state.date, state.view, state.sector, state.research, state.query, state.sort, state.sortDirection].join("|");
  if (nextViewKey !== tableState.viewKey) {
    tableState.viewKey = nextViewKey;
    tableState.visibleLimit = TABLE_BATCH_SIZE;
  }
  const renderedStocks = visibleStocks.slice(0, tableState.visibleLimit);
  const body = document.querySelector("#stock-rows");
  const rows = new Map([...body.children].map((row) => [row.dataset.symbol, row]));
  const visible = new Set(renderedStocks.map((stock) => stock.symbol));
  for (const [symbol, row] of rows) if (!visible.has(symbol)) row.remove();
  let cursor = body.firstElementChild;
  renderedStocks.forEach((stock) => {
    const favorite = state.favorites.includes(stock.symbol);
    let row = rows.get(stock.symbol);
    const cached = row && tableRowCache.get(row);
    if (!stock.latest) {
      if (!cached || cached.stock !== stock || cached.favorite !== favorite || cached.loading !== loading) {
        row ??= document.createElement("tr");
        row.dataset.symbol = stock.symbol;
        row.innerHTML = `<td><button class="icon-button favorite-button ${favorite ? "is-favorite" : ""}" data-favorite="${stock.symbol}" aria-label="${favorite ? "移除" : "加入"}${esc(stock.name)}自選" aria-pressed="${favorite}">${icon("star")}</button></td><th scope="row"><div class="stock-name"><strong>${stock.symbol}</strong><span>${esc(stock.name)}</span></div></th><td class="entry-cell">${pendingField()}</td><td class="research-cell">${pendingField()}</td><td>${pendingField()}</td><td class="price-volume-cell">${pendingField()}</td><td class="trend-cell">${pendingField()}</td><td class="net-cell-mobile">${pendingField()}</td>${Array.from({ length: 4 }, () => `<td>${pendingField()}</td>`).join("")}<td class="net-cell-desktop">${pendingField()}</td>`;
        tableRowCache.set(row, { stock, favorite, loading });
      }
    } else if (!cached || cached.stock !== stock || cached.favorite !== favorite) {
      const { latest: bar, signal } = stock;
      const leader = isDemo ? getDominantInstitution(bar.institutions) : stock.dominantInstitution;
      const leaderLabel = bar.institutionalNet === null ? "" : !leader ? "合計持平"
        : `${leader.names.join("、")}${leader.direction === "buy" ? "買超" : "賣超"}最多`;
      const netAmount = stockMoney(stock, "total", "day");
      const netCell = `<span class="institution-net">${institutionalMoney(netAmount)}</span><small class="institution-lots">${institutionalAmount(bar.institutionalNet)}</small><small class="institution-leader">${leaderLabel}</small>`;
      const volumeRatio = bar.institutionalNet !== null && Number.isFinite(bar.volume) && bar.volume > 0
        ? bar.institutionalNet / bar.volume * 100 : null;
      const priceVolume = stock.priceVolume?.rvol20 == null ? "資料不足" : stock.priceVolume.label;
      const priceVolumeCell = `<span class="signal-badge price-volume-label ${direction(bar.changePercent)}">${esc(priceVolume)}</span><small class="price-volume-ratio">${stock.priceVolume?.rvol20 == null ? "" : `${number(stock.priceVolume.rvol20, 2)} 倍均量`}</small>`;
      const trend = stock.trend ?? { code: "insufficient", label: "資料不足", reason: "歷史行情不足" };
      const trendCell = `<span class="trend-label ${esc(trend.code)}">${esc(trend.label)}</span><small class="trend-reason">${esc(trend.reason)}</small>`;
      const mobileNetCell = `<span class="institution-net">${institutionalMoney(netAmount)}</span><small class="institution-volume-share" title="法人淨買賣超股數 ÷ 個股當日成交股數 × 100%">${volumeRatio === null ? "" : `占比 ${percent(volumeRatio)}`}</small><small class="institution-leader">${leaderLabel}</small>`;
      const cells = researchListCells(stock, esc, number);
      const html = `<tr data-symbol="${stock.symbol}"><td><button class="icon-button favorite-button ${favorite ? "is-favorite" : ""}" data-favorite="${stock.symbol}" aria-label="${favorite ? "移除" : "加入"}${esc(stock.name)}自選" aria-pressed="${favorite}">${icon("star")}</button></td><th scope="row"><div class="stock-name"><strong>${stock.symbol}</strong><span>${esc(stock.name)}<span class="sector-inline">${esc(stock.sector)}</span></span></div></th><td class="entry-cell">${cells.readiness}</td><td class="research-cell">${cells.research}</td><td class="price-cell"><span class="stock-price-line"><span class="stock-close">${number(bar.close, 2)}</span><span class="mobile-change change-chip ${direction(bar.changePercent)}">${percent(bar.changePercent)}</span></span></td><td class="price-volume-cell">${priceVolumeCell}</td><td class="trend-cell">${trendCell}</td><td class="net-cell-mobile ${direction(bar.institutionalNet)}">${mobileNetCell}</td><td class="change-cell"><span class="change-chip ${direction(bar.changePercent)}">${percent(bar.changePercent)}</span></td><td><span class="k-cell">${number(bar.k, 2)}${bar.k !== null ? `<i style="--k:${Math.max(0, Math.min(100, bar.k))}%"></i>` : ""}</span><small class="kd-detail">D ${number(bar.d, 2)}</small></td><td class="signal-cell"><span class="signal-badge ${signal.tone}" data-signal="${signal.code}">${esc(signal.label)}</span><small class="signal-reason">${esc(signal.reason)}</small></td><td><span class="position-tag ${direction(bar.deviation)}">${bar.deviation === null ? "資料不足" : bar.deviation > 0 ? "季線之上" : bar.deviation < 0 ? "季線之下" : "季線持平"}</span><small class="deviation ${direction(bar.deviation)}">${percent(bar.deviation)}</small></td><td class="net-cell-desktop ${direction(bar.institutionalNet)}">${netCell}</td></tr>`;
      const holder = document.createElement("tbody");
      holder.innerHTML = html;
      if (row) row.replaceChildren(...holder.firstElementChild.childNodes);
      else row = holder.firstElementChild;
      tableRowCache.set(row, { stock, favorite });
    }
    row.setAttribute("aria-busy", String(!stock.latest && loading));
    row.tabIndex = 0;
    row.setAttribute("aria-label", `查看${stock.name}進場研究`);
    if (row === cursor) cursor = cursor.nextElementSibling;
    else body.insertBefore(row, cursor);
  });
  if (loading && !dataset.stocks.length) body.innerHTML = `<tr class="initial-field-row" aria-busy="true"><td></td><th scope="row">股票資料</th>${Array.from({ length: 11 }, () => `<td>${loadingIcon()}</td>`).join("")}</tr>`;
  document.querySelector("#table-empty").hidden = visibleStocks.length !== 0 || loading || loadFailed;
  document.querySelector("#favorite-count").textContent =
    state.favorites.length;
  const trigger = document.querySelector("#table-load-trigger");
  trigger.hidden = renderedStocks.length >= visibleStocks.length;
  // A tall viewport may still contain the trigger after one batch. Recheck its
  // position after layout instead of waiting for it to leave and re-enter view.
  if (tableState.observer) {
    tableState.observer.unobserve(trigger);
    if (!trigger.hidden) tableState.observer.observe(trigger);
  }
  document.querySelector("#table-summary").textContent =
    `顯示 ${renderedStocks.length} / ${visibleStocks.length} 檔${isDemo ? "示範" : "觀察"}標的 · ${state.date}`;
  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active);
  });
  updateSegmentedControl(document.querySelector(".filter-tabs"));
  document
    .querySelectorAll("[data-sort-heading]")
    .forEach((heading) =>
      heading.setAttribute(
        "aria-sort",
        heading.dataset.sortHeading === state.sort
          ? state.sortDirection === 1
            ? "ascending"
            : "descending"
          : "none",
      ),
    );
}

