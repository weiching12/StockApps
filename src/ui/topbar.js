// The desktop top bar (hidden on phones): a search box that lists matching stocks as you type, the data
// status (which trading day is shown and when the next update is due, or when it was last updated), and the
// account. On these widths the countdown under the home page's trading-day menu is hidden: it lives here.
import { searchStocks } from "./search.js";
import { countdownText, updatingDay } from "../update-countdown.js";

const OPTION_LIMIT = 8;
const taipei = (date, options) => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour12: false, ...options }).format(date);
const slash = (date) => date.replaceAll("-", "/");

/**
 * The data status as two parts: `main` names the trading day on show; `detail` is the countdown to the next
 * scheduled update ("預計 18:30 更新 · 01:02:03", the same text as the home page's) while one is due, and
 * otherwise when the data was last updated — with its date when that is not the trading day itself, so
 * "16:17 更新" is never read as a time on the trading day.
 */
export function dataStatusText({ loading, demo, asOf, updatedAt }, now = new Date()) {
  if (loading && !asOf) return { main: "資料載入中", detail: "" };
  if (!asOf) return { main: "", detail: "" };
  if (demo) return { main: `示範資料 · ${slash(asOf)}`, detail: "模擬行情，非交易所資料" };
  const countdown = countdownText(now);
  if (countdown) return { main: `資料日 ${slash(asOf)}`, detail: countdown };
  // After 18:30 on a weekday, until that day's data is published, the run is under way: say so, rather than
  // showing nothing (the countdown has ended) or the previous day's update time.
  const today = updatingDay(now);
  if (today && asOf < today) return { main: `資料日 ${slash(asOf)}`, detail: "今日資料更新中" };
  if (!updatedAt || !Number.isFinite(Date.parse(updatedAt))) return { main: `資料日 ${slash(asOf)}`, detail: "" };
  const at = new Date(updatedAt);
  const day = taipei(at, { year: "numeric", month: "2-digit", day: "2-digit" }).replaceAll("/", "-");
  const date = day === asOf ? "" : `${taipei(at, { month: "numeric", day: "numeric" })} `;
  return { main: `資料日 ${slash(asOf)}`, detail: `${date}${taipei(at, { hour: "2-digit", minute: "2-digit" })} 更新` };
}

/** Writes the status into the bar and refreshes it every second (the countdown ticks); returns a stop function. */
export function startDataStatus(node, read) {
  if (!node) return () => {};
  const render = () => {
    const input = read(), { main, detail } = dataStatusText(input);
    // The demo label must stay readable; a real trading day is left to the menu beside it when that shows.
    node.dataset.kind = input.demo ? "demo" : "date";
    // Rebuilt only when the shape changes, so the ticking countdown does not replace the nodes every second.
    if (!node.querySelector("strong") !== !main || !node.querySelector("small") !== !detail)
      node.innerHTML = main ? `<strong></strong>${detail ? "<small></small>" : ""}` : "";
    if (main) node.querySelector("strong").textContent = main;
    if (detail) node.querySelector("small").textContent = detail;
    node.hidden = !main;
  };
  render();
  const timer = setInterval(render, 1000);
  return Object.assign(() => clearInterval(timer), { render });
}

/**
 * The search box: a combobox whose list shows up to eight matches (code first, then name), with the latest
 * close and change. Arrow keys move through the list, Enter opens the highlighted stock (or the first), Escape
 * closes the list, then clears the box. The last row opens the search page with every match.
 */
export function bindTopbarSearch({ input, list, stocks, isLoading, esc, number, onOpen, onShowAll }) {
  if (!input || !list) return { focus() {} };
  let active = -1, options = [];
  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  };
  const highlight = (index) => {
    options.forEach((option, at) => option.setAttribute("aria-selected", String(at === index)));
    active = index;
    if (index >= 0) {
      input.setAttribute("aria-activedescendant", options[index].id);
      options[index].scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  };
  const render = () => {
    const query = input.value;
    if (!query.trim()) { close(); return; }
    if (isLoading()) {
      list.innerHTML = '<p class="topbar-search-note">股票資料載入中…</p>';
    } else {
      const { matches, total } = searchStocks(stocks(), query, OPTION_LIMIT);
      const change = (value) => Number.isFinite(value) ? `${value > 0 ? "+" : ""}${number(value, 2)}%` : "";
      const tone = (value) => value > 0 ? "up" : value < 0 ? "down" : "";
      list.innerHTML = !total ? '<p class="topbar-search-note">沒有符合的股票</p>'
        : matches.map((stock, index) => `<div role="option" id="topbar-option-${index}" class="topbar-search-option" data-symbol="${esc(stock.symbol)}" aria-selected="false">
            <strong>${esc(stock.symbol)}</strong><span class="topbar-search-name">${esc(stock.name ?? "")}</span>
            <span class="topbar-search-price">${Number.isFinite(stock.latest?.close) ? number(stock.latest.close, 2) : ""}</span>
            <span class="topbar-search-change ${tone(stock.latest?.changePercent)}">${change(stock.latest?.changePercent)}</span></div>`).join("")
          + (total > matches.length ? `<div role="option" id="topbar-option-all" class="topbar-search-option topbar-search-all" data-show-all aria-selected="false">查看全部 ${total} 筆結果</div>` : "");
    }
    options = [...list.querySelectorAll('[role="option"]')];
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    highlight(options.length ? 0 : -1);
  };
  const choose = (option) => {
    if (!option) return;
    const query = input.value;
    input.value = "";
    close();
    input.blur();
    if (option.hasAttribute("data-show-all")) onShowAll(query);
    else onOpen(option.dataset.symbol);
  };
  input.addEventListener("input", render);
  input.addEventListener("focus", () => { if (input.value.trim()) render(); });
  input.addEventListener("blur", () => setTimeout(close, 120));
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (list.hidden) render();
      if (!options.length) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      highlight((active + step + options.length) % options.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (list.hidden) render();
      choose(options[Math.max(active, 0)]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (!list.hidden) close();
      else { input.value = ""; input.blur(); }
    }
  });
  // Keep focus in the box while an option is pressed, so the list does not close before the click.
  list.addEventListener("mousedown", (event) => event.preventDefault());
  list.addEventListener("click", (event) => choose(event.target.closest('[role="option"]')));
  list.addEventListener("mousemove", (event) => {
    const option = event.target.closest('[role="option"]');
    if (option) highlight(options.indexOf(option));
  });
  return {
    /** True when the bar is on screen (wider layouts); the "/" shortcut then focuses it. */
    focus() {
      if (!input.getClientRects().length) return false;
      input.focus();
      input.select();
      return true;
    },
    refresh() { if (!list.hidden) render(); },
  };
}
