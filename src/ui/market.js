import { filterStocks, getDominantInstitution } from "../../shared/indicators.js";
import { isEtf } from "../../shared/market-codec.js";
import { compareResearchStocks, matchesResearchFilter, researchListCells, researchSummaryOf } from "./entry-research.js";

export function renderMarketView(context) {
  const { state, snapshots, pendingSymbols, stockMoney, tableState, TABLE_BATCH_SIZE, tableRowCache, loading, loadFailed, dataset, isDemo, esc, icon, number, percent, direction, institutionalMoney, institutionalAmount, loadingIcon, pendingField, updateSegmentedControl } = context;
  // Loading the next batch keeps the same list: reuse it instead of filtering and sorting every stock again.
  const listKey = [state.date, state.marketView, state.listQuery, state.view, state.sector, state.research, state.sort, state.sortDirection,
    state.favorites.join(","), pendingSymbols.size, loading].join("|");
  if (tableState.listSource !== snapshots || tableState.listKey !== listKey) {
    tableState.list = sortedMarketList(context);
    tableState.listSource = snapshots;
    tableState.listKey = listKey;
  }
  const visibleStocks = tableState.list;
  const finishBatch = (shown, total) => {
    const trigger = document.querySelector("#table-load-trigger");
    trigger.hidden = shown >= total;
    // A tall viewport may still contain the trigger after one batch. Recheck its
    // position after layout instead of waiting for it to leave and re-enter view.
    if (tableState.observer) {
      tableState.observer.unobserve(trigger);
      if (!trigger.hidden) tableState.observer.observe(trigger);
    }
    document.querySelector("#table-summary").textContent =
      `顯示 ${shown} / ${total} 檔${isDemo ? "示範" : "觀察"}標的 · ${state.date}`;
  };
  const sortSelect = document.querySelector("#market-sort");
  if (sortSelect) sortSelect.value = [...sortSelect.options].some((option) => option.value === state.sort) ? state.sort : "";
  const nextViewKey = [state.date, state.marketView, state.listQuery, state.view, state.sector, state.research, state.sort, state.sortDirection].join("|");
  // On phones the list scrolls inside its own box and only the rows in view are drawn.
  const scroller = document.querySelector(".stocks-panel.is-fitted .table-scroll");
  if (nextViewKey !== tableState.viewKey) {
    tableState.viewKey = nextViewKey;
    tableState.visibleLimit = TABLE_BATCH_SIZE;
    if (scroller) scroller.scrollTop = 0;
  }
  const renderedStocks = visibleStocks.slice(0, tableState.visibleLimit);
  const body = document.querySelector("#stock-rows");
  const drawRow = (stock, existing) => {
    const favorite = state.favorites.includes(stock.symbol);
    let row = existing;
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
      // Phone cards hide the indicator columns; this row repeats them as chips that scroll sideways.
      const chip = (label, value, tone = "") => `<span class="mobile-chip ${tone}"><small>${label}</small>${value}</span>`;
      const position = bar.deviation === null ? "資料不足" : bar.deviation > 0 ? "之上" : bar.deviation < 0 ? "之下" : "持平";
      const extras = `<td class="mobile-extras"><div class="mobile-extras-scroll">${[
        chip("量價", `${esc(priceVolume)}${stock.priceVolume?.rvol20 == null ? "" : ` ${number(stock.priceVolume.rvol20, 2)} 倍`}`, direction(bar.changePercent)),
        chip("趨勢", esc(trend.label)),
        chip("法人", `${institutionalMoney(netAmount)}${volumeRatio === null ? "" : ` · ${percent(volumeRatio)}`}`, direction(bar.institutionalNet)),
        chip("KD", `${number(bar.k, 2)} / ${number(bar.d, 2)}`),
        chip("建議", esc(signal.label)),
        chip("季線", `${position}${bar.deviation === null ? "" : ` ${percent(bar.deviation)}`}`, direction(bar.deviation)),
      ].join("")}</div></td>`;
      const html = `<tr data-symbol="${stock.symbol}"><td><button class="icon-button favorite-button ${favorite ? "is-favorite" : ""}" data-favorite="${stock.symbol}" aria-label="${favorite ? "移除" : "加入"}${esc(stock.name)}自選" aria-pressed="${favorite}">${icon("star")}</button></td><th scope="row"><div class="stock-name"><strong>${stock.symbol}</strong><span>${esc(stock.name)}</span><small class="sector-inline">${esc(stock.sector)}</small></div></th><td class="entry-cell">${cells.readiness}</td><td class="research-cell">${cells.research}</td><td class="price-cell"><span class="stock-price-line"><span class="stock-close">${number(bar.close, 2)}</span><span class="mobile-change change-chip ${direction(bar.changePercent)}">${percent(bar.changePercent)}</span></span></td><td class="price-volume-cell">${priceVolumeCell}</td><td class="trend-cell">${trendCell}</td><td class="net-cell-mobile ${direction(bar.institutionalNet)}">${mobileNetCell}</td><td class="change-cell"><span class="change-chip ${direction(bar.changePercent)}">${percent(bar.changePercent)}</span></td><td><span class="k-cell">${number(bar.k, 2)}${bar.k !== null ? `<i style="--k:${Math.max(0, Math.min(100, bar.k))}%"></i>` : ""}</span><small class="kd-detail">D ${number(bar.d, 2)}</small></td><td class="signal-cell"><span class="signal-badge ${signal.tone}" data-signal="${signal.code}">${esc(signal.label)}</span><small class="signal-reason">${esc(signal.reason)}</small></td><td><span class="position-tag ${direction(bar.deviation)}">${bar.deviation === null ? "資料不足" : bar.deviation > 0 ? "季線之上" : bar.deviation < 0 ? "季線之下" : "季線持平"}</span><small class="deviation ${direction(bar.deviation)}">${percent(bar.deviation)}</small></td><td class="net-cell-desktop ${direction(bar.institutionalNet)}">${netCell}</td>${extras}</tr>`;
      const holder = document.createElement("tbody");
      holder.innerHTML = html;
      if (row) row.replaceChildren(...holder.firstElementChild.childNodes);
      else row = holder.firstElementChild;
      tableRowCache.set(row, { stock, favorite });
    }
    row.setAttribute("aria-busy", String(!stock.latest && loading));
    row.tabIndex = 0;
    row.setAttribute("aria-label", `查看${stock.name}進場研究`);
    return row;
  };
  if (scroller) {
    drawVisibleRows({ list: visibleStocks, body, scroller, drawRow, tableState });
    tableState.drawn = null;
  } else {
    body.style.removeProperty("padding-top"); body.style.removeProperty("padding-bottom"); body.style.removeProperty("--market-row-height");
    // The next batch of the same list only adds rows: skip revisiting every row already drawn.
    const drawn = tableState.drawn;
    if (drawn && drawn.listKey === tableState.listKey && drawn.source === snapshots && drawn.count < renderedStocks.length &&
        body.children.length === drawn.count && body.lastElementChild?.dataset.symbol === renderedStocks[drawn.count - 1]?.symbol) {
      const added = document.createDocumentFragment();
      for (const stock of renderedStocks.slice(drawn.count)) added.append(drawRow(stock));
      body.append(added);
      drawn.count = renderedStocks.length;
      finishBatch(renderedStocks.length, visibleStocks.length);
      return;
    }
    const rows = new Map([...body.children].map((row) => [row.dataset.symbol, row]));
    const visible = new Set(renderedStocks.map((stock) => stock.symbol));
    for (const [symbol, row] of rows) if (!visible.has(symbol)) row.remove();
    let cursor = body.firstElementChild;
    for (const stock of renderedStocks) {
      const row = drawRow(stock, rows.get(stock.symbol));
      if (row === cursor) cursor = cursor.nextElementSibling;
      else body.insertBefore(row, cursor);
    }
    tableState.drawn = loading ? null : { listKey: tableState.listKey, source: snapshots, count: renderedStocks.length };
  }
  if (loading && !dataset.stocks.length) body.innerHTML = `<tr class="initial-field-row" aria-busy="true"><td></td><th scope="row">股票資料</th>${Array.from({ length: 11 }, () => `<td>${loadingIcon()}</td>`).join("")}</tr>`;
  document.querySelector("#table-empty").hidden = visibleStocks.length !== 0 || loading || loadFailed;
  document.querySelector("#favorite-count").textContent =
    state.favorites.length;
  finishBatch(scroller ? visibleStocks.length : renderedStocks.length, visibleStocks.length);
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

/** The ETF view lists only ETFs and ignores sector choices; the market list leaves them out. */
export const marketListStocks = (snapshots, marketView) =>
  snapshots.filter((stock) => marketView === "etf" ? isEtf(stock) : !isEtf(stock));

function sortedMarketList({ state, snapshots: allSnapshots, pendingSymbols, stockMoney }) {
  const snapshots = marketListStocks(allSnapshots, state.marketView);
  const query = (state.listQuery ?? "").trim();
  // The ETF view has a search field only: no filters, no research, listed by code.
  if (state.marketView === "etf") {
    const found = filterStocks(snapshots, { query });
    if (!query) found.push(...snapshots.filter((stock) => pendingSymbols.has(stock.symbol)));
    return found.sort((a, b) => a.symbol.localeCompare(b.symbol));
  }
  const sector = state.sector;
  const research = state.research;
  const visibleStocks = filterStocks(snapshots, { ...state, sector, query }).filter((stock) => matchesResearchFilter(stock, research));
  if (!query && ["all", "favorites"].includes(state.view) && (!research || research === "all")) {
    visibleStocks.push(...snapshots.filter((stock) => pendingSymbols.has(stock.symbol) &&
      (sector === "all" || stock.sector === sector || stock.sectorGroup === sector) &&
      (state.view !== "favorites" || state.favorites.includes(stock.symbol))));
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
  return visibleStocks;
}

const OVERSCAN_ROWS = 6, ROW_POOL_LIMIT = 300;

/**
 * Phone list virtualisation: rows share one measured height, so the rows in view follow from the
 * scroll position; padding above and below stands in for the rest. Rows that scroll out are kept
 * in a small pool and reused when they come back.
 */
function drawVisibleRows({ list, body, scroller, drawRow, tableState }) {
  if (tableState.rowWidth !== scroller.clientWidth) {
    // A new width can change the card's height: measure again from a natural row.
    tableState.rowWidth = scroller.clientWidth;
    tableState.rowHeight = null;
    body.style.removeProperty("--market-row-height");
  }
  const rowHeight = tableState.rowHeight ?? 140;
  const bodyTop = body.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  const first = Math.max(0, Math.min(list.length, Math.floor((scroller.scrollTop - bodyTop) / rowHeight)) - OVERSCAN_ROWS);
  const last = Math.min(list.length, first + Math.ceil(scroller.clientHeight / rowHeight) + OVERSCAN_ROWS * 2);
  const wanted = list.slice(first, last), wantedSymbols = new Set(wanted.map((stock) => stock.symbol));
  const pool = tableState.rowPool ??= new Map();
  const current = new Map();
  for (const row of [...body.children]) {
    if (row.dataset.symbol && wantedSymbols.has(row.dataset.symbol)) { current.set(row.dataset.symbol, row); continue; }
    row.remove();
    if (row.dataset.symbol) { pool.delete(row.dataset.symbol); pool.set(row.dataset.symbol, row); }
  }
  while (pool.size > ROW_POOL_LIMIT) pool.delete(pool.keys().next().value);
  let cursor = body.firstElementChild;
  for (const stock of wanted) {
    const row = drawRow(stock, current.get(stock.symbol) ?? pool.get(stock.symbol));
    pool.delete(stock.symbol);
    if (row === cursor) cursor = cursor.nextElementSibling;
    else body.insertBefore(row, cursor);
  }
  body.style.paddingTop = `${first * rowHeight}px`;
  body.style.paddingBottom = `${(list.length - last) * rowHeight}px`;
  if (!tableState.rowHeight && body.firstElementChild?.dataset.symbol) {
    tableState.rowHeight = Math.max(1, body.firstElementChild.getBoundingClientRect().height);
    body.style.setProperty("--market-row-height", `${tableState.rowHeight}px`);
    if (Math.abs(tableState.rowHeight - rowHeight) > 1) drawVisibleRows({ list, body, scroller, drawRow, tableState });
  }
}
