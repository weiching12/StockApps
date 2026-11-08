import { getSectorGroupOverview, getSectorOverview, getSectorDetail, rankSectors, sortSectors } from "../../shared/sectors.js";

const COLLAPSED_SUB_INDUSTRIES = 10;

/** The ranking opens on its top rows; what matters sorts first, and the rest is one tap away. */
export const visibleSectors = (sectors, expanded) => expanded ? sectors : sectors.slice(0, COLLAPSED_SUB_INDUSTRIES);

/** The market list's sector choices: broader sectors with their sub-industries; ETFs stay a plain choice. */
export function sectorTree(stocks) {
  const groups = new Map(), plain = new Set();
  for (const { sector, sectorGroup } of stocks) {
    if (!sector) continue;
    if (!sectorGroup) { plain.add(sector); continue; }
    if (!groups.has(sectorGroup)) groups.set(sectorGroup, new Set());
    groups.get(sectorGroup).add(sector);
  }
  const byName = (a, b) => a.localeCompare(b, "zh-Hant");
  return { groups: [...groups].sort(([a], [b]) => byName(a, b)).map(([name, subs]) => ({ name, subs: [...subs].sort(byName) })),
    plain: [...plain].sort(byName) };
}

/** First row picks a sector; a sector with several sub-industries opens a second row. */
export function sectorChipsMarkup(stocks, selected, esc) {
  const { groups, plain } = sectorTree(stocks);
  const chip = (value, label, pressed) => `<button type="button" data-sector-chip="${esc(value)}" aria-pressed="${pressed}">${esc(label)}</button>`;
  const group = groups.find(({ name, subs }) => name === selected || subs.includes(selected));
  const first = [chip("all", "全部", selected === "all"), ...groups.map(({ name }) => chip(name, name, name === group?.name)),
    ...plain.map((name) => chip(name, name, name === selected))].join("");
  const second = group && group.subs.length > 1
    ? [chip(group.name, `全部${group.name}`, selected === group.name), ...group.subs.map((name) => chip(name, name, name === selected))].join("") : "";
  return { first, second };
}

const FLOW_WINDOWS = [["day", "當日"], ["5", "5 日"], ["20", "20 日"]];

/** The chosen sector's institutional flows at the level it was chosen, or nothing for 全部 and ETFs. */
export function sectorFlowMarkup(context) {
  const { state, dataset, snapshots, asOf, sectorOverviews, sectorGroupOverviews, direction, esc, institutionalMoney } = context;
  const name = state.sector;
  if (name === "all") return "";
  const { groups } = sectorTree(dataset.stocks);
  const isGroup = groups.some((group) => group.name === name && group.subs.length > 1);
  const overview = (window) => {
    if (sectorOverviews) return (isGroup ? sectorGroupOverviews : sectorOverviews)?.[window] ?? [];
    return (isGroup ? getSectorGroupOverview : getSectorOverview)(snapshots, { window,
      tradingDates: dataset.dates.filter((date) => date <= asOf), asOf });
  };
  const periods = FLOW_WINDOWS.map(([window, label]) => [label, overview(window).find((sector) => sector.name === name)]);
  if (!periods.some(([, sector]) => sector)) return "";
  const cells = periods.map(([label, sector]) => {
    const amount = sector?.estimate?.amount ?? null;
    const breadth = sector?.estimate?.available ? `買超 ${sector.estimate.buying}／${sector.estimate.available} 檔` : "";
    return `<div class="sector-flow-period" data-flow-period="${label}"><span>${label}</span><strong class="${direction(amount)}"${amount === null ? "" : ` data-amount="${amount}"`}>${amount === null ? "資料不足" : institutionalMoney(amount)}</strong><small>${breadth}</small></div>`;
  }).join("");
  const detail = isGroup ? "" : `<button type="button" class="text-button" data-sector-open="${esc(name)}" aria-label="查看${esc(name)}個股法人明細">查看明細</button>`;
  return `<div class="sector-flow-head"><h3>${esc(name)} 法人動向</h3>${detail}</div><div class="sector-flow-periods">${cells}</div>`;
}

/**
 * Choosing a chip only moves the highlight, so the row keeps where it was scrolled sideways; only a
 * different set of chips (another sector's sub-industries) redraws the row and starts it at the left.
 */
function syncChipRow(row, markup) {
  const chips = markup.replace(/ aria-pressed="(true|false)"/g, "");
  if (row.dataset.chips === chips) {
    const pressed = [...markup.matchAll(/aria-pressed="(true|false)"/g)].map((match) => match[1]);
    row.querySelectorAll("button").forEach((button, index) => button.setAttribute("aria-pressed", pressed[index]));
    return;
  }
  row.innerHTML = markup;
  row.dataset.chips = chips;
  row.scrollLeft = 0;
  // A new set of chips fans in from the left; the stagger index drives each chip's delay.
  row.querySelectorAll("button").forEach((button, index) => button.style.setProperty("--chip-index", Math.min(index, 12)));
  replay(row, "is-entering");
}

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function replay(node, className) {
  node.classList.remove(className);
  void node.offsetWidth;
  node.classList.add(className);
}

/** Amounts roll up from zero to their value, formatted the same way at every frame. */
function countUp(block, format, duration = 650) {
  const cells = [...block.querySelectorAll("strong[data-amount]")].map((cell) => [cell, Number(cell.dataset.amount)]);
  if (!cells.length || reducedMotion()) return;
  const start = performance.now();
  const frame = (now) => {
    const progress = Math.min(1, (now - start) / duration), eased = 1 - (1 - progress) ** 3;
    for (const [cell, amount] of cells) cell.textContent = format(progress === 1 ? amount : amount * eased);
    if (progress < 1 && block.isConnected && cells[0][0].isConnected) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

export function renderSectorNavView(context) {
  const { state, dataset, esc } = context;
  const first = document.querySelector("#sector-chips");
  if (!first) return;
  const second = document.querySelector("#sub-sector-chips");
  const markup = sectorChipsMarkup(dataset.stocks, state.sector, esc);
  syncChipRow(first, markup.first);
  syncChipRow(second, markup.second);
  second.hidden = !markup.second;
  const flow = sectorFlowMarkup(context), block = document.querySelector("#sector-flow");
  // Only a newly chosen sector animates; a re-render of the same one (new data, resize) stays still.
  const chosen = flow && block.dataset.sector !== state.sector;
  block.innerHTML = flow;
  block.hidden = !flow;
  block.dataset.sector = flow ? state.sector : "";
  if (chosen) { replay(block, "is-entering"); countUp(block, context.institutionalMoney); }
}

export function renderSectorOverviewView(context) {
  const { state, dataset, loading, loadFailed, snapshots, asOf, sectorOverviews, loadingIcon, updateSegmentedControl, renderSectorDialog, direction, esc, percent, institutionalMoney } = context;
  if (loading || loadFailed) {
    document.querySelector("#sector-grid").innerHTML = loading
      ? `<div class="sector-loading-fields" aria-label="產業統計載入中">${["產業排名", "當日平均漲跌", "法人淨買賣超金額"].map((label) => `<div><span>${label}</span>${loadingIcon()}</div>`).join("")}</div>` : "";
    return;
  }
  const days = state.sectorWindow === "day" ? 1 : Number(state.sectorWindow);
  const sectors = sectorOverviews ? [...(sectorOverviews[state.sectorWindow] ?? [])] : getSectorOverview(snapshots, {
    window: state.sectorWindow, sort: state.sectorSort,
    tradingDates: dataset.dates.filter((date) => date <= asOf), asOf,
  });
  if (sectorOverviews) rankSectors(sortSectors(sectors, state.sectorSort), state.sectorSort);
  document.querySelectorAll("[data-sector-window]").forEach((button) =>
    button.setAttribute("aria-pressed", button.dataset.sectorWindow === state.sectorWindow));
  document.querySelectorAll("[data-sector-sort]").forEach((button) =>
    button.setAttribute("aria-pressed", button.dataset.sectorSort === state.sectorSort));
  document.querySelectorAll(".sector-toolbar .segmented-control").forEach(updateSegmentedControl);
  document.querySelector("#sector-change-label").textContent = days === 1
    ? "當日平均漲跌" : `${days} 日平均漲跌`;
  const maxAmount = Math.max(1, ...sectors.map((sector) => Math.abs(sector.estimate.amount ?? 0)));
  const shown = visibleSectors(sectors, state.sectorExpanded);
  const showAll = shown.length < sectors.length
    ? `<button type="button" class="sector-show-all outline-button" data-sector-expand>顯示全部 ${sectors.length} 個細產業</button>` : "";
  document.querySelector("#sector-grid").innerHTML = shown.map((sector, index) => {
    const { leader, leaderValue, leaderChange } = sector;
    const periodLabel = days === 1 ? "" : `${days} 日 `;
    const leaderText = leaderValue === null ? "" : leader.name;
    // A run of two or more sessions of net buying or selling earns a badge beside the leading stock.
    const streak = leaderValue === null ? 0 : sector.leaderStreak ?? 0;
    const streakBadge = Math.abs(streak) >= 2
      ? ` <span class="sector-streak ${streak > 0 ? "up" : "down"}" data-sector-streak="${streak}" title="三大法人合計連續${streak > 0 ? "淨買超" : "淨賣超"}的交易日數">${streak > 0 ? "連買" : "連賣"} ${Math.abs(streak)} 日</span>` : "";
    const ranked = Number.isFinite(sector.estimate.amount);
    // The 產業 ordering is about trading share, so the net-flow leader line is left out there.
    const leaderLine = state.sectorSort === "activity-desc" ? ""
      : `<p>${periodLabel}<span>${esc(leaderText)}</span> <span class="${direction(leaderChange)}">${leader ? percent(leaderChange) : ""}</span>${streakBadge}</p>`;
    const share = ranked ? Math.max(4, Math.round((Math.abs(sector.estimate.amount) / maxAmount) * 100)) : 0;
    const bar = ranked ? `<i class="${direction(sector.estimate.amount)}" style="--sector-bar:${share}%;--sector-share:${share / 100};--i:${Math.min(index, 12)}"></i>` : "";
    return `<article class="sector-card" data-sector-name="${esc(sector.name)}" data-sector-details="${esc(sector.name)}" role="button" tabindex="0" aria-haspopup="dialog" aria-controls="sector-dialog" aria-label="查看${esc(sector.name)}產業個股與法人買賣超"><div class="sector-main"><span class="sector-rank">${sector.rank ?? ""}</span><span class="sector-marker ${direction(sector.estimate.amount)}"></span><div class="sector-identity"><div class="sector-title"><h3>${esc(sector.name)}</h3><small class="sector-breadth" data-sector-breadth title="所選區間淨買賣超金額為正的家數／金額資料完整的有效家數">${sector.estimate.available ? `買超 ${sector.estimate.buying}／${sector.estimate.available} 檔` : ""}</small></div>${leaderLine}${state.sectorSort === "activity-desc" ? `<small class="sector-activity" data-sector-activity title="法人買進＋賣出金額占全市場法人交易的比重">${Number.isFinite(sector.activity?.share) ? `法人交易占 ${sector.activity.share.toFixed(1)}%` : "法人交易資料不足"}</small>` : ""}</div><strong class="sector-change ${direction(sector.change)}">${percent(sector.change)}</strong><div class="sector-total"><strong class="institution-money ${direction(sector.estimate.amount)}" data-sector-amount>${institutionalMoney(sector.estimate.amount).replace(" 億", '<span class="money-unit"> 億</span>')}</strong>${bar}</div></div></article>`;
  }).join("") + showAll;
  if (document.querySelector("#sector-dialog")?.open) renderSectorDialog(state.sectorName);
}

/** A bar whose length is the amount's share of the stock's largest absolute amount across its periods. */
function flowBar(amount, max) {
  if (!Number.isFinite(amount) || !(max > 0)) return '<span class="sector-stock-bar" aria-hidden="true"></span>';
  const share = Math.max(.02, Math.abs(amount) / max);
  return `<span class="sector-stock-bar" aria-hidden="true"><i class="${amount > 0 ? "up" : amount < 0 ? "down" : "flat"}" style="--share:${share.toFixed(4)}"></i></span>`;
}

export function renderSectorDialogView(name, context) {
  const { dataset, latestSnapshots, sectorDetail, isDemo, esc, number, direction, percent, institutionalMoney, icon } = context;
  // Summary cells pair each amount with its share of the cohort's traded volume.
  const summaryFigures = (amount, ratio, key) => `<strong class="institution-money ${direction(amount)}" data-sector-money="${key}">${institutionalMoney(amount).replace(/ 億$/, "")}</strong><small class="institution-lots" data-sector-ratio="${key}" title="占量：淨買賣超股數／同期成交股數">${Number.isFinite(ratio) ? percent(ratio) : ""}</small>`;
  const detail = sectorDetail ?? (isDemo ? getSectorDetail(latestSnapshots, name, { tradingDates: dataset.dates, asOf: dataset.info.asOf }) : null);
  if (!detail) return;
  const { members, tradingDates } = detail;
  const periods = [["day", "當日"], ["5", "5 日"], ["20", "20 日"]];
  // Each stock's bars share its own scale, so a row's day, 5-day and 20-day lengths compare with each other.
  const stockMax = (values) => Math.max(0, ...periods.map(([key]) => Math.abs(values[key].amount ?? 0)));

  document.querySelector("#sector-dialog-heading").textContent = name;
  document.querySelector("#sector-dialog-meta").textContent = `${isDemo ? "最新完整交易日" : "報表交易日"} ${tradingDates.at(-1)}`;
  document.querySelector("#sector-dialog-content").innerHTML = `
    <section class="sector-detail-summary" aria-labelledby="sector-summary-heading">
      <div class="sector-detail-heading"><div><h3 id="sector-summary-heading">法人淨買賣超金額</h3><p>當日與近 5／20 個交易日累計<span class="sr-only">，金額單位：億</span>。占量＝淨買賣超股數／同期成交股數</p></div></div>
      <div class="sector-summary-grid"><div class="sector-summary-labels" aria-hidden="true"><span class="sector-summary-unit">單位：億</span>${["合計", "外資", "投信", "自營商"].map((label) => `<span>${label}</span>`).join("")}</div>${periods.map(([key, label]) => {
        const { estimate, ratio, institutions } = detail.periods[key];
        return `<article class="sector-summary-period" data-sector-period="${key}" aria-label="${label}法人買賣超"><header><h4>${label}</h4><div class="sector-summary-values"><span class="sr-only">合計</span>${summaryFigures(estimate.amount, ratio, "total")}</div></header><dl>${["外資", "投信", "自營商"].map((institution) => {
          const { amount: money, ratio: share } = institutions[institution];
          return `<div><dt>${institution}</dt><dd>${summaryFigures(money, share, institution)}</dd></div>`;
        }).join("")}</dl></article>`;
      }).join("")}</div>
    </section>
    <section class="sector-stock-section" aria-labelledby="sector-stock-heading">
      <div class="sector-detail-heading"><div><h3 id="sector-stock-heading">產業個股<button type="button" class="sector-note-toggle" aria-expanded="false" aria-controls="sector-chart-note" aria-label="顯示長條與占量說明">${icon("message")}</button></h3><p>依當日淨買賣超金額排序；金額：億，占量為輔</p><p id="sector-chart-note" class="sector-chart-note" hidden>長條：該股當日、5 日、20 日淨買賣超金額的相對大小，各股獨立比例尺。占量＝區間淨買賣超股數／同期成交股數。</p></div></div>
      <div class="sector-stock-scroll" tabindex="0" role="region" aria-label="${esc(name)}個股股價與法人買賣超">
        <table class="sector-stock-table"><caption class="sr-only">${esc(name)}各股最新收盤價、日漲跌幅及當日、5 日、20 日法人淨買賣超金額（億）與占量</caption><colgroup><col class="sector-stock-name-column"><col class="sector-stock-price-column">${periods.map(() => '<col class="sector-stock-net-column">').join("")}</colgroup><thead><tr><th scope="col">股票</th><th scope="col">收盤價／日漲跌</th>${periods.map(([, label]) => `<th scope="col">${label}金額／占量</th>`).join("")}</tr></thead><tbody>${members.map(({ stock, periods: values }) => `<tr data-sector-stock="${stock.symbol}"><th scope="row"><span class="sector-stock-name"><strong>${stock.symbol}</strong><strong>${esc(stock.name)}</strong></span></th><td class="sector-stock-price"><span class="sector-stock-close">${number(stock.latest?.close, 2)}</span><small class="sector-stock-change ${direction(stock.latest?.changePercent)}">${percent(stock.latest?.changePercent)}</small></td>${periods.map(([key, label]) => {
          const { amount, ratio } = values[key];
          // The share of traded volume replaces the lot count under each amount.
          const share = `<small class="institution-lots" data-institution-ratio="${key}" title="${label}三大法人淨買賣超股數 ÷ 同期成交股數 × 100%">${Number.isFinite(ratio) ? percent(ratio) : ""}</small>`;
          return `<td class="sector-stock-net" data-sector-net="${key}"><span class="sector-stock-period-label" aria-hidden="true">${label}</span><strong class="institution-money ${direction(amount)}">${institutionalMoney(amount)}</strong>${share}${flowBar(amount, stockMax(values))}</td>`;
        }).join("")}</tr>`).join("")}</tbody></table>
      </div>
    </section>`;
  const toggle = document.querySelector("#sector-dialog-content .sector-note-toggle");
  toggle?.addEventListener("click", () => {
    const note = document.querySelector("#sector-chart-note");
    const open = note.hidden;
    note.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", `${open ? "隱藏" : "顯示"}長條與占量說明`);
  });
}

