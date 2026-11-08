import { onAccountChange, startAccountMenu } from "./account.js";
import { renderMarketView } from "./ui/market.js";
import "./styles.css";
import "./typography.css";
import { loadDataset, loadMarketSummary } from "./provider.js";
import { MarketApiClient } from "./api/market-client.js";
import { RequestCache } from "./api/request-cache.js";
import { startPresence } from "./presence.js";
import { startPwa } from "./pwa.js";
import { createUpdateFlow } from "./update-flow.js";
import { createUpdateDialog } from "./ui/update-dialog.js";
import { startPushNotifications } from "./push.js";
import { startUpdateCountdown } from "./update-countdown.js";
import { sourceAbout } from "./about.js";
import { isEtf } from "./market-codec.js";
import { createState } from "./ui/state.js";
import { loadPreferences, persistPreferences, preferenceStorage } from "./ui/preferences.js";
import { restorePage, rememberPage } from "./ui/page-session.js";
import { shellMarkup } from "./ui/shell.js";
import { renderPageView } from "./ui/navigation.js";
import { renderSectorDialogView, renderSectorNavView, renderSectorOverviewView } from "./ui/sectors.js";
import { renderHomeView } from "./ui/home.js";
import { renderSearchView } from "./ui/search.js";
import { bindInputMode, bindPullToRefresh } from "./ui/gestures.js";
import { createControlsController } from "./ui/controls.js";
import { createDialogController } from "./ui/dialogs.js";
import { bindKeyboardNavigation } from "./ui/keyboard.js";
import { createTableBatchController } from "./ui/table-batches.js";
import { calculateMarketSentiment } from "../shared/sentiment.js";
import { getEntryScore } from "../shared/entry-score.js";
import { evaluateEntryResearch } from "../shared/entry-research.js";
import { addResearchPeriod, loadResearchStore, persistResearchStore, removeResearchPeriod } from "./ui/research-store.js";
import { renderResearchCenter } from "./ui/research.js";
import { dailyCloseSeries } from "../shared/price-history.js";
import { priceBaseline } from "../shared/research-review.js";
import { entryScoreDialogMarkup, selectEntryChartPoint, restoreEntryChartTitle } from "./ui/entry-score.js";
import { moodStyleChoices, renderSentiment } from "./ui/sentiment.js";
import { createBacktestController } from "./ui/backtest.js";
import {
  DEFAULT_SETTINGS,
  getSnapshot,
  getStockInstitutionEstimate,
  getStockInstitutionSeries,
} from "./indicators.js";

const icons = {
  chart: '<path d="M4 19V9m8 10V4m8 15v-7"/>',
  home: '<path d="M4 11.5 12 5l8 6.5"/><path d="M6.5 10v9h11v-9"/><path d="M10 19v-5h4v5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  star: '<path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.5l-5.7 3 1.1-6.3-4.6-4.5 6.4-.9Z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  arrow: '<path d="m7 17 10-10M7 7h10v10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  book: '<path d="M12 5v15M3 4c4-1 6-1 9 1 3-2 5-2 9-1v15c-4-1-6-1-9 1-3-2-5-2-9-1Z"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  sort: '<path class="sort-up" d="m8 9 4-4 4 4"/><path class="sort-down" d="m8 15 4 4 4-4"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  message: '<path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z"/><path d="M8 9h8M8 13h5"/>',
};
const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.chart}</svg>`;
const loadingIcon = (label = "資料載入中") => `<span class="field-loading" role="status" aria-label="${label}"><svg class="loading-spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 9 9"/></svg></span>`;
const pendingField = () => loading ? loadingIcon() : '<span class="field-load-error">載入失敗</span>';
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const number = (value, digits = 0) =>
  value === null || value === undefined
    ? "—"
    : value.toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
const signed = (value, digits = 2) =>
  value === null || value === undefined
    ? "—"
    : `${value > 0 ? "+" : ""}${number(value, digits)}`;
const direction = (value) =>
  value > 0 ? "up" : value < 0 ? "down" : "neutral";
const percent = (value) =>
  value === null || value === undefined ? "—" : `${signed(value)}%`;
const institutionalAmount = (value) => value === null
  ? ""
  : `${signed(value / 1000, Number.isInteger(value / 1000) ? 0 : 2)} 張`;
const institutionalMoney = (value) => value === null ? "" : `${signed(value / 100000000)} 億`;
const stockMoney = (stock, name, window, asOf = state.date) => apiMode
  ? stock?.money?.[window]?.[name] ?? null : getStockInstitutionEstimate(stock, name, window,
  dataset.dates.filter((date) => date <= asOf));
const institutionalFigures = (amount, shares, moneyAttribute = "", sharesAttribute = "") =>
  `<strong class="institution-money ${direction(amount)}" ${moneyAttribute}>${institutionalMoney(amount)}</strong><small class="institution-lots" ${sharesAttribute}>${institutionalAmount(shares)}</small>`;
const state = createState();
const controls = createControlsController();
const dialogs = createDialogController();

let dataset, snapshots, latestSnapshots;
const apiMode = import.meta.env.VITE_DATA_MODE === "api";
const nativeMode = import.meta.env.VITE_APP_TARGET === "native";
const marketClient = new MarketApiClient();
const backtest = createBacktestController({ client: marketClient, apiMode, esc, loadingIcon, openSample: openBacktestSample });
const summaryCache = new RequestCache(), sectorDetailCache = new RequestCache(), stockDetailCache = new RequestCache();
let researchStore;
let researchSort = "readiness", researchFilter = "all";
let selectedSummary, latestSummary, summaryRequest = 0;
const latestCache = new Map(), historicalCache = new Map();
const tableRowCache = new WeakMap();
const TABLE_BATCH_SIZE = 30;
let loading = false, loadFailed = false, loadProgress = { loaded: 0, total: 0 };
const tableState = { visibleLimit: TABLE_BATCH_SIZE, viewKey: "", observer: undefined };
const tableBatches = createTableBatchController({ state: tableState, batchSize: TABLE_BATCH_SIZE, render: () => renderTable() });
let toastTimer;
let isDemo;
let presence, accountMenu, settingsAccountMenu, stopAccountWatch, stopUpdateCountdown, usingCachedData = false, backtestRestore = false;
let nativeStorage, nativePush;
let checkPwaUpdate = async () => false;
let startupVersionCheck = Promise.resolve(false);
let touchInteraction = false;
const ENTRY_CHART_HOLD_MS = 300, ENTRY_CHART_TOUCH_SLOP = 10;
let entryTouch = null;
// Once a hold has started scrubbing, keep the finger's movement from scrolling the page.
const preventEntryTouchScroll = (event) => event.preventDefault();
const pendingSymbols = new Set();
let updateFlow;
const showUpdateState = createUpdateDialog({ onUpdate: () => updateFlow.apply(), isBlocking: () => updateFlow?.isBlocking() ?? true });
let updateSession;
try { updateSession = sessionStorage; } catch {}
updateFlow = createUpdateFlow({ storage: updateSession, onState: showUpdateState,
  beforeReload: async () => {
    rememberPage(state.page, nativeMode ? nativeStorage : undefined);
    savePreferences();
    if (researchStore) saveResearch();
    await nativeStorage?.flush?.();
  }, reload: () => window.location.reload() });

const appStorage = () => nativeMode ? nativeStorage : preferenceStorage();
function readPreferences() { loadPreferences(state, appStorage()); }
function savePreferences() { persistPreferences(state, toast, appStorage()); }
function saveResearch() { return persistResearchStore(appStorage(), researchStore); }

/**
 * Each page's views render only while that page shows: opening the app builds home alone, and
 * the market list, 自選 and search catch up from the latest data when they are opened.
 */
const staleViews = new Set();
function shownOrStale(page, view) {
  if (state.page === page) { staleViews.delete(view); return true; }
  staleViews.add(view);
  return false;
}

function renderStaleViews() {
  for (const view of [...staleViews]) {
    if (view === "table" && state.page === "market") renderTable();
    if (view === "sectors" && state.page === "market") renderSectorOverview();
    if (view === "research" && state.page === "favorites") renderResearch();
    if (view === "search" && state.page === "search") renderSearch();
    if (view === "home" && state.page === "home") renderHome();
  }
}

function renderResearch() {
  if (!shownOrStale("favorites", "research")) return;
  if (!researchStore || !document.querySelector("#research-list")) return;
  const result = renderResearchCenter({ favorites: state.favorites, stocks: snapshots,
    store: researchStore, date: state.date, previousDate: dataset.dates[dataset.dates.indexOf(state.date) - 1] ?? null,
    sort: researchSort, filter: researchFilter, esc });
  document.querySelector("#research-date").textContent = `交易日 ${dataset.info.asOf || "—"}`;
  document.querySelector("#research-stats").innerHTML = result.stats;
  document.querySelector("#research-list").innerHTML = result.cards;
  document.querySelector("#research-sort").value = researchSort;
  document.querySelector("#research-filter").value = researchFilter;
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.dataset.moodStyle = state.moodStyle;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", state.theme === "dark" ? "#0b1220" : "#14243b");
}

function toast(message) {
  const node = document.querySelector("#toast");
  node.textContent = message;
  node.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("visible"), 3000);
}

// Web builds load the stylesheet without blocking the first paint; the shell still needs it.
function stylesheetReady() {
  const link = document.querySelector("#app-styles");
  if (!link || link.media === "all") return Promise.resolve();
  return new Promise((resolve) => {
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener("error", resolve, { once: true });
  });
}

// The launch animation stays up until the first data has arrived, so the home page opens complete;
// a cold server summary can take several seconds, and the cap keeps a stalled request from trapping it.
const SPLASH_MIN_MS = 1800, SPLASH_DATA_CAP_MS = 10000;
async function finishAppSplashBeforeLoading(pendingData = Promise.resolve()) {
  const splash = document.querySelector("#app-splash");
  if (!splash || !document.documentElement.classList.contains("is-standalone") ||
      document.documentElement.classList.contains("app-splash-seen")) return;
  const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  await Promise.all([wait(SPLASH_MIN_MS), startupVersionCheck,
    Promise.race([pendingData.catch(() => {}), wait(SPLASH_DATA_CAP_MS)])]);
  splash.classList.add("is-leaving");
  await new Promise((resolve) => window.setTimeout(resolve, 320));
  document.documentElement.classList.add("app-splash-seen");
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", "light");
  splash.remove();
}

function shell() {
  accountMenu?.stop(); settingsAccountMenu?.stop();
  document.querySelector("#app").innerHTML = shellMarkup({ dataset, state, isDemo, icon, loadingIcon, esc });
  presence?.stop();
  if (nativeMode) {
    document.querySelector("#online-count").hidden = true;
    document.querySelector("#account-menu").hidden = true;
  }
  else {
    presence = startPresence(document.querySelector("#online-count"), { demo: isDemo });
    accountMenu = startAccountMenu(document.querySelector("#account-menu"));
    stopAccountWatch?.();
    stopAccountWatch = onAccountChange(applyBacktestAccess);
  }
}

/** The backtest shows only to signed-in accounts; a restored backtest page waits on the home page until that is known. */
function applyBacktestAccess(user) {
  const allowed = Boolean(user && !user.mustChangePassword);
  document.querySelector('[data-page="backtest"]').hidden = !allowed;
  if (allowed && backtestRestore) state.page = "backtest";
  backtestRestore = false;
  if (!allowed && state.page === "backtest") state.page = "home";
  renderPage();
}

function refreshData() {
  if (apiMode) {
    latestSnapshots = latestSummary?.data.stocks ?? [];
    snapshots = selectedSummary?.data.stocks ?? [];
    if (selectedSummary?.data.sentiment) renderSentiment(selectedSummary.data.sentiment);
    renderTable(); renderSectorOverview(); renderHome(); renderSearch(); renderPage(); renderResearch();
    return;
  }
  const forDisplay = (stock, date) => {
    const snapshot = getSnapshot({ ...stock, tradingDates: dataset.dates }, date, state.settings);
    snapshot.entryScore = getEntryScore(snapshot, dataset.dates, date);
    // Demo data has no server; the same shared research model runs here instead.
    snapshot.entryResearch = evaluateEntryResearch({ stock: snapshot, tradingDates: dataset.dates, asOf: date,
      settings: state.settings, score: snapshot.entryScore });
    snapshot.priceHistory = dailyCloseSeries(snapshot.history, dataset.dates, date);
    // The sentiment series needs 60 closes at its oldest point.
    snapshot.history = snapshot.history.slice(-80);
    return snapshot;
  };
  const settingsKey = [state.settings.period, state.settings.kSmooth, state.settings.dSmooth].join(":");
  const cached = (date, cache) => dataset.stocks.map((stock) => {
    const prior = cache.get(stock.symbol);
    const key = `${date}:${settingsKey}`;
    if (prior?.stock === stock && prior.key === key) return prior.snapshot;
    const snapshot = forDisplay(stock, date);
    cache.set(stock.symbol, { stock, key, snapshot });
    return snapshot;
  });
  latestSnapshots = cached(dataset.info.asOf, latestCache);
  snapshots = state.date === dataset.info.asOf ? latestSnapshots
    : cached(state.date, historicalCache);
  renderSentiment(calculateMarketSentiment(snapshots, state.date, 20, dataset.dates));
  renderTable();
  renderSectorOverview();
  renderHome();
  renderSearch();
  renderPage();
  renderResearch();
}

const summaryKey = (date) => `${dataset.info.generation}:${date}:${state.settings.period}:${state.settings.kSmooth}:${state.settings.dSmooth}`;
async function selectSummary(date) {
  if (!apiMode) { refreshData(); return; }
  const request = ++summaryRequest;
  const key = summaryKey(date);
  const settings = { ...state.settings };
  let result = summaryCache.get(key);
  // A cached selection must also clear a superseded network request's spinner.
  loading = !result;
  renderLoadState();
  try {
    if (!result) {
      result = await summaryCache.load(key, async () => {
        const response = await marketClient.summary(date, settings, { cache: "no-cache" });
        if (response.response.headers.get("X-PWA-Cache") === "fallback") usingCachedData = true;
        const body = response.data;
        if (body.meta?.generation !== dataset.info.generation || body.meta?.asOf !== date ||
            body.data?.stocks?.length !== dataset.stocks.length) throw new Error("Invalid market summary");
        return body;
      });
    }
  } catch (error) {
    if (request !== summaryRequest) return;
    throw error;
  } finally {
    if (request === summaryRequest) { loading = false; renderLoadState(); }
  }
  if (request !== summaryRequest) return;
  selectedSummary = result;
  if (date === dataset.info.asOf) latestSummary = result;
  loadFailed = false;
  refreshData(); renderConnectionState();
}

function renderLoadState() {
  const status = document.querySelector("#load-status");
  status.hidden = !loadFailed;
  status.querySelector("span").textContent = loadFailed
    ? loadProgress.total ? "資料尚未完整載入，請重新載入再試一次。"
      : "無法取得股票資料，請重新載入再試一次。"
    : "";
  status.querySelector("button").hidden = !loadFailed;
  let dateIcon = document.querySelector("#date-loading");
  if (!dateIcon) {
    dateIcon = document.createElement("span"); dateIcon.id = "date-loading";
    dateIcon.innerHTML = loadingIcon("交易日載入中");
    document.querySelector(".date-control").append(dateIcon);
  }
  dateIcon.hidden = !loading;
  for (const panel of document.querySelectorAll("[data-page-panel]")) panel.setAttribute("aria-busy", String(loading));
}

function renderConnectionState(online = navigator.onLine) {
  const status = document.querySelector("#app-status");
  if (!status) return;
  const message = !online
    ? `目前離線${dataset?.info?.asOf ? `，顯示 ${dataset.info.asOf} 已保存資料` : ""}`
    : usingCachedData ? `連線不穩定，顯示 ${dataset?.info?.asOf || "上次"} 已保存資料` : "";
  status.querySelector("span").textContent = message;
  status.hidden = !message;
}

function startVersionChecks() {
  if (nativeMode) return;
  const checkUpdate = startPwa({
    onConnection: (online) => renderConnectionState(online),
    getDataVersion: () => dataset?.info?.generation,
    onUpdateRequired: (update) => updateFlow.offer(update),
  });
  checkPwaUpdate = (force = false) => {
    void presence?.refresh?.(force);
    return checkUpdate(force);
  };
  startupVersionCheck = Promise.race([
    checkPwaUpdate(true).catch((error) => { console.warn("Startup version check failed", error); return false; }),
    new Promise((resolve) => setTimeout(() => resolve(false), 4000)),
  ]);
}

function enablePwa() {
  if (nativeMode) {
    void enableNativeApp().catch((error) => console.error("Native lifecycle setup failed", error));
    return;
  }
  const reminder = document.querySelector(".date-notification-button");
  const notificationStatus = document.querySelector("#settings-notifications > div > span");
  notificationStatus.setAttribute("role", "status");
  const pushButton = document.querySelector("#push-notifications");
  if (!apiMode) {
    reminder.hidden = true;
    pushButton.disabled = true;
    pushButton.querySelector("span").textContent = "正式版可開啟更新通知";
    notificationStatus.textContent = "本機示範模式不提供更新通知";
  } else startPushNotifications(pushButton, { onMessage: toast,
    onStatus: ({ supported, subscribed, permission, error }) => {
      const hidden = !supported || subscribed;
      reminder.hidden = hidden;
      notificationStatus.textContent = !supported ? "此瀏覽器無法使用推播通知"
        : subscribed ? "已開啟通知，資料更新完成後會提醒你"
          : error ? error
          : permission === "denied" ? "瀏覽器已封鎖通知，請在網站權限中允許通知後重試"
            : permission === "granted" ? "瀏覽器已允許通知，但尚未完成訂閱；請按下開啟更新通知"
              : "尚未開啟通知";
    } });
  stopUpdateCountdown?.();
  stopUpdateCountdown = startUpdateCountdown(document.querySelector("#update-countdown"));
}

async function enableNativeApp() {
  const { startNativeApp, enableNativePush } = await import("./native/bootstrap.js");
  const notifications = document.querySelector("#settings-notifications");
  notifications.querySelector(".settings-version-title").textContent = "資料更新";
  notifications.querySelector("#check-update").textContent = "檢查資料";
  const native = await startNativeApp({
    getDataVersion: () => dataset?.info?.generation,
    onDataUpdate: (latest) => updateFlow.offer({ kind: "data", generation: latest.generation }),
    onPause: async () => {
      savePreferences();
      if (researchStore) saveResearch();
      rememberPage(state.page, nativeStorage);
      await nativeStorage?.flush?.();
    },
    beforeResume: () => nativePush?.refresh(),
    onBack: () => {
      if (updateFlow.isBlocking()) return true;
      const dialog = document.querySelector("#info-dialog[open]") ?? document.querySelector("dialog[open]");
      if (dialog) { dialog.close(); return true; }
      if (state.page !== "home") {
        document.querySelector('.sidebar [data-page="home"]').click();
        return true;
      }
      return false;
    },
    onHistoryBack: () => window.history.back(),
    onError: (error) => console.warn("Native lifecycle action failed", error),
  });
  checkPwaUpdate = native.checkForUpdates;
  window.addEventListener("pagehide", () => { void native.stop(); void nativePush?.stop(); }, { once: true });
  nativePush = await enableNativePush({ storage: nativeStorage, onMessage: toast,
    onOpen: () => {
      void checkPwaUpdate(true).catch(() => toast("資料更新檢查失敗，請稍後重試"));
    },
    onStatus: ({ enabled, subscribed, busy, message }) => {
      const button = notifications.querySelector("#push-notifications");
      button.disabled = !enabled || busy;
      button.setAttribute("aria-pressed", String(subscribed));
      button.setAttribute("aria-label", subscribed ? "關閉每日資料更新通知" : "開啟每日資料更新通知");
      button.querySelector("span").textContent = subscribed ? "關閉更新通知" : "開啟更新通知";
      notifications.querySelector("div > span").textContent = message;
    } });
  notifications.querySelector("#push-notifications").addEventListener("click", () => {
    void nativePush?.toggle().catch((error) => toast(error.message));
  });
  stopUpdateCountdown?.();
  stopUpdateCountdown = startUpdateCountdown(document.querySelector("#update-countdown"));
}

let refreshingApp = false;
async function refreshWithVersionCheck() {
  if (refreshingApp) return;
  refreshingApp = true;
  try {
    const updated = await checkPwaUpdate(true);
    if (!updated) await updateFlow.reloadCurrent();
  } catch (error) {
    console.warn("Version check before refresh failed", error);
    await updateFlow.reloadCurrent();
  }
  finally { refreshingApp = false; }
}

/** Home and 自選 read the latest session, so open a stock's dialog with its data rather than a browsed one. */
function showLatestPage(page) {
  state.page = page;
  if (["favorites", "search"].includes(page) && state.date !== dataset.info.asOf) {
    state.date = dataset.info.asOf;
    void selectSummary(state.date).catch((error) => toast(error.message));
  }
  renderPage();
}

function renderPage() {
  renderPageView({ state, dataset, renderLoadState, updateSegmentedControls });
  renderStaleViews();
  if (state.page === "backtest") backtest.show();
  rememberPage(state.page, nativeMode ? nativeStorage : undefined);
  fitMarketPanel();
}

/**
 * On phones the market list fills the screen down to its footer and only its rows scroll,
 * so a long list never scrolls the page away from the filters.
 */
function fitMarketPanel() {
  const panel = document.querySelector(".stocks-panel");
  if (!panel) return;
  const fit = matchMedia("(max-width: 700px)").matches && state.page === "market" && state.marketView === "list";
  const changed = panel.classList.contains("is-fitted") !== fit;
  panel.classList.toggle("is-fitted", fit);
  document.documentElement.classList.toggle("market-fitted", fit);
  tableBatches.sync();
  let resized = false;
  if (fit) {
    if (window.scrollY) window.scrollTo(0, 0);
    const top = panel.getBoundingClientRect().top;
    // Below a few rows of room (a short phone with a sector's flows open) the page scrolls instead.
    const height = `${Math.max(220, Math.floor(window.innerHeight - top - 12))}px`;
    resized = panel.style.getPropertyValue("--market-panel-height") !== height;
    panel.style.setProperty("--market-panel-height", height);
  }
  // The box must have its height before the list works out which rows are in view.
  if (changed || resized) renderTable();
}

const updateSegmentedControl = controls.updateSegmented;
const updateSegmentedControls = controls.updateSegmentedAll;

function renderSearch() {
  if (!shownOrStale("search", "search")) return;
  renderSearchView({ query: state.searchQuery, stocks: latestSnapshots, loading, asOf: dataset.info.asOf, loadingIcon, esc, number, percent, direction });
}

/** Search reads the latest session and takes the keyboard straight away. */
function openSearch() {
  closeEntryDrawer();
  showLatestPage("search");
  document.querySelector("#stock-search").focus();
}

function renderHome() {
  if (!shownOrStale("home", "home")) return;
  renderHomeView({ state, stocks: snapshots, loading, loadFailed, asOf: state.date, loadingIcon, esc, number, percent, direction });
}

function sectorContext() { return { state, dataset, loading, loadFailed, latestSnapshots,
  // The market list's chips, flows and ranking follow its selected session; the detail dialog reads the latest.
  snapshots, asOf: state.date,
  sectorOverviews: apiMode ? selectedSummary?.data.sectors : null,
  sectorGroupOverviews: apiMode ? selectedSummary?.data.sectorGroups : null,
  sectorDetail: apiMode ? sectorDetailCache.get(`${summaryKey(dataset.info.asOf)}:${state.sectorName}`) : null,
  loadingIcon, stockMoney, updateSegmentedControl, renderSectorDialog, direction, esc, percent, institutionalFigures, institutionalMoney, isDemo, number, icon }; }
function renderSectorOverview() {
  if (!shownOrStale("market", "sectors")) return;
  renderSectorOverviewView(sectorContext()); renderSectorNavView(sectorContext()); fitMarketPanel();
}
function renderSectorDialog(name) { renderSectorDialogView(name, sectorContext()); }

// Up to tablet width the sector detail is a pull-down sheet with no close button.
const SECTOR_SHEET = "(max-width: 899px)";

function openSectorDialog(name, focusHandle = true, stockSymbol = null) {
  const dialog = document.querySelector("#sector-dialog");
  state.sectorName = name;
  dialog.dataset.stockTarget = stockSymbol ?? "";
  const locateStock = () => {
    if (!stockSymbol || !dialog.open || state.sectorName !== name || dialog.dataset.stockTarget !== stockSymbol) return;
    const target = dialog.querySelector(`[data-sector-stock="${CSS.escape(stockSymbol)}"]`);
    if (!target) return;
    target.setAttribute("data-sector-target", "true");
    target.tabIndex = -1;
    target.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    target.focus({ preventScroll: true });
  };
  if (apiMode) {
    const date = dataset.info.asOf, key = `${summaryKey(date)}:${name}`;
    if (sectorDetailCache.has(key)) renderSectorDialog(name);
    else {
      document.querySelector("#sector-dialog-content").innerHTML = loadingIcon();
      const settings = { ...state.settings };
      const isCurrent = () => document.querySelector("#sector-dialog").open && state.sectorName === name &&
        key === `${summaryKey(dataset.info.asOf)}:${name}`;
      sectorDetailCache.load(key, async () => {
        const { data } = await marketClient.sector(name, date, settings);
        if (data.meta?.generation !== dataset.info.generation || data.meta?.asOf !== date)
          throw new Error("產業資料版本不一致，請重新載入");
        return data.data;
      }).then(() => {
        if (isCurrent()) { renderSectorDialog(name); locateStock(); }
      }).catch((error) => {
        if (isCurrent()) document.querySelector("#sector-dialog-content").textContent = error.message;
      });
    }
  } else renderSectorDialog(name);
  dialogs.open(dialog, {
    focus: focusHandle,
    mobileTarget: ".sector-dialog-handle",
    desktopTarget: "#close-sector-dialog",
    sheetQuery: SECTOR_SHEET,
  });
  locateStock();
}


function renderTable() {
  // The nav's 自選 count shows on every page, so it stays current even while the list waits.
  if (!shownOrStale("market", "table")) { const count = document.querySelector("#favorite-count"); if (count) count.textContent = state.favorites.length; return; }
  renderMarketView({ state, snapshots, pendingSymbols, stockMoney, tableState, TABLE_BATCH_SIZE, tableRowCache, loading, loadFailed, dataset, isDemo, esc, icon, number, percent, direction, institutionalMoney, institutionalAmount, loadingIcon, pendingField, updateSegmentedControl });
}

function technicalSignalGuide() {
  return `<p class="dialog-intro">依資料日 KD 交叉與 MA20 趨勢判讀；${isDemo ? "模擬資料技術提示" : "技術提示僅供觀察"}，需搭配風險控管。使用目前 KD (${state.settings.period}, ${state.settings.kSmooth}, ${state.settings.dSmooth}) 設定，僅比較資料日與前一交易日。買賣提示只標示當日新交叉，每日重新判讀。</p>
    <dl class="signal-rules">
      <div><dt>留意買點</dt><dd>低檔黃金交叉，且收盤價 ≥ MA20、MA20 ≥ 前日 MA20。</dd></div>
      <div><dt>反彈觀察</dt><dd>低檔黃金交叉，但 MA20 趨勢條件未齊備，包含均線資料不足。</dd></div>
      <div><dt>留意賣點</dt><dd>高檔死亡交叉，留意動能反轉與部位風險。</dd></div>
      <div><dt>動能轉強／轉弱</dt><dd>其他區間的黃金／死亡交叉，仍需搭配價量觀察。</dd></div>
      <div><dt>低檔／高檔觀察</dt><dd>當日沒有上述交叉，K &lt; 20 為低檔，K &gt; 80 為高檔；留意持續鈍化。</dd></div>
      <div><dt>偏多／偏弱／中性</dt><dd>其餘情況：K &gt; D 且 MA20 趨勢確認為偏多；K &lt; D 為偏弱；其餘中性。</dd></div>
    </dl>
    <p class="helper-text">黃金交叉：前日 K ≤ D、當日 K &gt; D 且 K 上升；死亡交叉反之。低／高檔交叉要求當日或前日 K、D 同時低於 20／高於 80。依上列順序判讀；K 恰為 20 或 80 不屬極端區間。缺少連續兩日有效 KD 時顯示「資料不足」。</p>
    <p class="helper-text">這是本網站訂定、尚未回測的觀察規則；${isDemo ? "目前使用模擬行情；" : ""}沒有預測報酬或交易保證。概念參考：<a class="signal-source" href="https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/slow-stochastic" target="_blank" rel="noopener noreferrer">Fidelity 隨機指標說明 ↗</a>；本網站沿用原有遞迴 KD 算法，MA20 確認為額外條件。</p>`;
}

function marketScope() {
  const etfs = dataset.stocks.filter(isEtf).length;
  return `${dataset.stocks.length - etfs} 家上市公司（含存託憑證）及 ${etfs} 檔新臺幣交易 ETF；不含上櫃與外幣交易櫃檯。法人買株僅統計產業個股，不含 ETF；ETF 歷史自加入日起逐日累積。`;
}


function openDialog(type, focusClose = true) {
  settingsAccountMenu?.stop(); settingsAccountMenu = null;
  const infoDialog = document.querySelector("#info-dialog");
  if (!type.startsWith("entry:") || infoDialog.dataset.entrySymbol !== type.slice(6)) delete infoDialog.dataset.mobileSheet;
  infoDialog.dataset.entrySymbol = type.startsWith("entry:") ? type.slice(6) : "";
  infoDialog.dataset.request = String(Number(infoDialog.dataset.request ?? 0) + 1);
  const content = document.querySelector("#dialog-content");
  document.querySelector("#settings-notifications").hidden = type !== "settings";
  if (type === "settings") {
    const updateStatus = document.querySelector("#update-check-status");
    updateStatus.hidden = true;
    updateStatus.textContent = "";
    content.innerHTML = `<h2 id="dialog-heading">設定</h2><p class="dialog-intro">顯示設定選擇後立即套用；KD 指標需按「指標儲存」。</p><section class="settings-theme" aria-labelledby="settings-theme-heading"><h3 id="settings-theme-heading">顯示 <span>選擇後立即套用</span></h3><div class="form-field"><label for="theme">色彩主題</label><select id="theme" name="theme"><option value="light"${state.theme === "light" ? " selected" : ""}>淺色</option><option value="dark"${state.theme === "dark" ? " selected" : ""}>深色</option></select></div>${moodStyleChoices(state.moodStyle)}</section><form id="settings-form"><fieldset class="settings-group"><legend>KD 指標</legend><div class="form-field"><label for="period">RSV 回溯週期</label><div><input id="period" name="period" type="number" min="1" max="60" value="${state.settings.period}" required/><span>個交易日</span></div></div><div class="form-field"><label for="kSmooth">K 平滑係數</label><input id="kSmooth" name="kSmooth" type="number" min="1" max="20" value="${state.settings.kSmooth}" required/></div><div class="form-field"><label for="dSmooth">D 平滑係數</label><input id="dSmooth" name="dSmooth" type="number" min="1" max="20" value="${state.settings.dSmooth}" required/></div></fieldset><p class="helper-text">預設 KD (9, 3, 3)。季線固定為 60 個交易日的收盤價平均。</p><div class="dialog-buttons"><button class="outline-button" type="button" id="default-settings">恢復預設</button><button class="primary-button" type="submit">${icon("check")} 指標儲存</button></div></form>`;
    if (!nativeMode) {
      content.querySelector(".dialog-intro").insertAdjacentHTML("afterend",
        `<section class="settings-account" aria-labelledby="settings-account-heading"><h3 id="settings-account-heading">帳號</h3><div id="settings-account-menu" class="account-menu"></div></section>`);
      settingsAccountMenu = startAccountMenu(content.querySelector("#settings-account-menu"), { settings: true });
    }
  } else if (type.startsWith("entry:")) {
    const symbol = type.slice(6);
    const stock = snapshots.find((item) => item.symbol === symbol);
    const detail = stockDetailCache.get(`${summaryKey(state.date)}:${symbol}`);
    content.innerHTML = stock ? entryScoreDialogMarkup(detail ? { ...stock, ...detail } : stock, esc, number, percent,
      state.favorites.includes(symbol), icon, loadingIcon) :
      `<h2 id="dialog-heading">個股進場評估</h2><p>找不到這檔股票。</p>`;
  } else if (type === "backtest-sample") {
    content.innerHTML = `<h2 id="dialog-heading">研究樣本說明</h2><div class="backtest-loading">${loadingIcon("樣本說明載入中")}</div>`;
  } else if (type === "source" && !isDemo && !dataset.info.updatedAt) {
    content.innerHTML = `<h2 id="dialog-heading">關於株研</h2>${sourceAbout()}<section class="source-data" aria-labelledby="source-data-heading"><h3 id="source-data-heading">資料來源與更新規則</h3><p>正在取得資料來源與市場範圍，請稍候。</p></section>`;
  } else if (type === "source" && !isDemo) {
    const syncNote = import.meta.env.VITE_SYNC_NOTE || "平日台灣時間 18:30、20:30 檢核全市場法人報表，驗證通過後分批更新快取，全部完成才發布；失敗保留上一份已驗證資料，基準不足時等待確認。";
    const checkedAt = new Date(dataset.info.updatedAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
    content.innerHTML = `<h2 id="dialog-heading">關於株研</h2>${sourceAbout()}<section class="source-data" aria-labelledby="source-data-heading"><h3 id="source-data-heading">資料來源與更新規則</h3><p class="dialog-intro">株研每日從臺灣證券交易所取得上市公司名錄、收盤行情及三大法人買賣超日報，完成驗證後儲存於 Cloudflare，提供網站與安裝版 App 使用。</p><div class="source-banner">${icon("info")} ${esc(dataset.info.note)}</div><dl class="source-details"><div><dt>市場與標的</dt><dd>${esc(marketScope())}</dd></div><div><dt>資料交易日</dt><dd>${esc(dataset.info.asOf)}</dd></div><div><dt>發布時間</dt><dd>${esc(checkedAt)}（台灣時間）。未提供當日行情的公司不列入當日排行</dd></div><div><dt>價格與指標</dt><dd>價格未還原；KD、MA60 由瀏覽器依選定交易日以前的歷史資料計算，除權息與分割可能影響結果</dd></div><div><dt>法人分類</dt><dd>外資不含外資自營商、投信、自營商自行買賣加避險。原始單位為股，畫面依功能換算為張或億元</dd></div><div><dt>更新規則</dt><dd>${esc(syncNote)}</dd></div><div><dt>異常處理</dt><dd>資料未通過完整性檢核時不發布、不覆蓋既有資料，畫面保留上一份已驗證版本</dd></div><div><dt>自選清單</dt><dd>保存在目前瀏覽器；手機與電腦讀取相同行情，自選清單目前不跨裝置同步</dd></div></dl></section>`;
  } else if (type === "source") {
    content.innerHTML = `<h2 id="dialog-heading">關於株研</h2>${sourceAbout()}<section class="source-data" aria-labelledby="source-data-heading"><h3 id="source-data-heading">資料來源與更新規則</h3><p class="dialog-intro">這是可操作的前端示範版，目前沒有連接交易所或即時行情服務。</p><div class="source-banner">${icon("info")} ${esc(dataset.info.note)}</div><dl class="source-details"><div><dt>市場與標的</dt><dd>14 檔台灣上市、上櫃股票與 ETF 範例</dd></div><div><dt>資料截止日</dt><dd>${dataset.info.asOf}（固定資料，不會自動更新）</dd></div><div><dt>法人資料</dt><dd>模擬外資、投信與自營商買進、賣出股數，畫面依功能換算為張或億元</dd></div><div><dt>指標計算</dt><dd>由模擬 OHLC 歷史資料在瀏覽器計算，並非預先填入指標數值</dd></div><div><dt>正式版本</dt><dd>正式資料須涵蓋交易日曆、除權息還原與法人分類定義；示範資料不可用於實際交易</dd></div></dl></section>`;
  } else {
    content.innerHTML = `<h2 id="dialog-heading">讀懂價格背後的訊號</h2><p class="dialog-intro">指標提供觀察角度。搭配價量與籌碼，建立更完整的判斷。</p><article class="guide-item"><span>01</span><div><h3>季線 MA60</h3><p>最近 60 個交易日收盤價的簡單移動平均，包含選定資料日。股價高於季線時，位置顯示為正值。</p><code>乖離率 = (收盤價 ÷ MA60 − 1) × 100%</code></div></article><article class="guide-item"><span>02</span><div><h3>KD 隨機指標</h3><p>預設以 9 日最高、最低與當日收盤價計算 RSV，再以平滑係數 3 遞推 K、D。K、D 初始值為 50；不足 9 日不顯示。最高與最低相同時 RSV 採 50。</p><code>RSV = (收盤 − 最低) ÷ (最高 − 最低) × 100<br>K = 前日 K × 2/3 + RSV × 1/3<br>D = 前日 D × 2/3 + 當日 K × 1/3</code><p>K &gt; 80 為高檔區，K &lt; 20 為低檔區，不能單獨視為買賣訊號。你可以在指標設定調整參數。</p></div></article><article class="guide-item"><span>03</span><div><h3>三大法人買賣超</h3><p>外資、投信及自營商的買進股數減去賣出股數。正值為買超，負值為賣超。1 張 = 1,000 股；法人買賣量與全市場成交量的統計範圍不同。近 5／20 日累計包含資料日，依實際交易日加總後換算為張；資料不足不補零。外資、投信的連買／連賣日數從資料日回溯，遇反向、持平或缺漏即中止；若回溯到資料起點或缺漏，顯示「至少」。</p></div></article><article class="guide-item"><span>04</span><div><h3>前一交易日</h3><p>目前預設資料日為 ${dataset.info.asOf}。日期選單可回看最近 30 個${isDemo ? "模擬" : "實際"}交易日，所有指標僅使用選定日及之前的資料。</p></div></article><article class="guide-item"><span>05</span><div><h3>KD 技術建議</h3>${technicalSignalGuide()}</div></article><article class="guide-item"><span>06</span><div><h3>今日量價</h3><p>比較選定交易日的成交量與此前 20 個市場交易日的平均成交量；平均量不包含當日。成交量均以股計算，畫面顯示倍數至小數點後兩位。</p><code>RVOL20 = 當日成交量 ÷ 前 20 個交易日平均成交量</code><p>RVOL20 ≥ 1.20 為量增；0.80 ≤ RVOL20 &lt; 1.20 為量平；RVOL20 &lt; 0.80 為量縮。收盤價相對前一有效交易日上漲超過 0.50% 為價漲、下跌超過 0.50% 為價跌，介於 ±0.50%（含邊界）為價格變動有限。依價格與量能的組合顯示量價術語；量增且價格變動有限為「量增價滯」，量平為「量價持平」，量縮為「量縮盤整」。即使 RVOL20 ≥ 2.00，只要價格變動有限仍為「量增價滯」。</p><p>當日或前 20 個市場交易日任一天缺少成交量、歷史不足、前 20 日平均量為 0，或漲跌無法計算時，顯示「資料不足」；不會以更早日期補足缺漏。切換歷史日期時只使用該日及以前的資料。量價狀態僅供觀察，不代表買賣訊號。</p></div></article>`;
  }
  const dialog = document.querySelector("#info-dialog");
  const entryDrawer = type.startsWith("entry:") && matchMedia("(min-width: 900px)").matches;
  if (dialog.open && dialog.dataset.entryDrawer !== String(entryDrawer)) dialog.close();
  dialog.dataset.entryDrawer = String(entryDrawer);
  if (!dialog.open) {
    if (entryDrawer) dialog.show();
    else dialog.showModal();
  }
  dialog.scrollTop = 0;
  content.scrollTop = 0;

  const close = dialog.querySelector(matchMedia("(max-width: 520px)").matches && dialog.querySelector(".entry-dialog")
    ? ".info-dialog-handle" : "#close-dialog");
  if (focusClose) close.focus({ preventScroll: true });
  else if (dialog.contains(document.activeElement)) document.activeElement.blur();
}

/** Shows a backtest sample's saved explanation once its request resolves. */
function openBacktestSample(pending) {
  const dialog = document.querySelector("#info-dialog");
  openDialog("backtest-sample", !touchInteraction);
  const request = dialog.dataset.request;
  pending.then((markup) => markup, (error) => `<h2 id="dialog-heading">研究樣本說明</h2><p role="alert">${esc(error.message || "樣本說明載入失敗")}</p>`)
    .then((markup) => { if (dialog.open && dialog.dataset.request === request) document.querySelector("#dialog-content").innerHTML = markup; });
}

function closeEntryDrawer() {
  const dialog = document.querySelector('#info-dialog[data-entry-drawer="true"]');
  if (dialog?.open) dialog.close();
}

async function openEntryScoreDialog(symbol, focusClose = true) {
  const date = state.date, key = `${summaryKey(date)}:${symbol}`;
  const dialog = document.querySelector("#info-dialog");
  openDialog(`entry:${symbol}`, focusClose);
  const request = dialog.dataset.request;
  const isCurrent = () => dialog.open && dialog.dataset.request === request &&
    dialog.dataset.entrySymbol === symbol && key === `${summaryKey(state.date)}:${symbol}`;
  if (!apiMode || stockDetailCache.has(key)) return;
  const summary = snapshots.find((stock) => stock.symbol === symbol)?.entryScore;
  const settings = { ...state.settings };
  try {
    const entryDetail = await stockDetailCache.load(key, async () => {
      const { data } = await marketClient.analysis(symbol, date, settings);
      const detail = data.data?.entryScore;
      if (data.meta?.asOf !== date || detail?.modelVersion !== summary?.modelVersion ||
          detail?.totalScore !== summary?.totalScore) throw new Error("清單與個股評分版本不一致");
      return data.data;
    });
    if (isCurrent()) {
      document.querySelector("#dialog-content").innerHTML = entryScoreDialogMarkup(
        { ...snapshots.find((stock) => stock.symbol === symbol), ...entryDetail }, esc, number, percent,
        state.favorites.includes(symbol), icon);
    }
  } catch (error) {
    if (isCurrent()) {
      // What the list already showed stays; only the part that could not load says so.
      const message = `<p role="alert">${esc(error.message || "評分明細載入失敗")}</p>`;
      const content = document.querySelector("#dialog-content"), pending = content.querySelector(".entry-pending");
      if (pending) { pending.outerHTML = message; content.querySelector(".entry-pending-body")?.remove(); }
      else content.innerHTML = `<h2 id="dialog-heading">個股進場評估</h2>${message}`;
    }
  }
}

function setResearchFilter(value) {
  state.research = value;
  document.querySelector("#market-research-filter").value = value;
}

function resetFilters() {
  state.sector = "all";
  state.view = "all";
  state.research = "all";
  state.sort = "";
  state.sortDirection = -1;
  document.querySelector("#market-research-filter").value = "all";
  renderTable(); renderSectorOverview();
}

function rememberMarketPosition(button, removing) {
  const row = button.closest("#stock-rows tr");
  if (!row) return null;
  let target = row;
  let top = row.getBoundingClientRect().top;
  if (removing && state.view === "favorites") {
    target = row.nextElementSibling ?? row.previousElementSibling;
    if (!row.nextElementSibling && target) top = target.getBoundingClientRect().top;
  }
  if (!target) top = document.querySelector(".stocks-panel").getBoundingClientRect().top;
  return { symbol: target?.dataset.symbol, top,
    left: document.querySelector(".table-scroll").scrollLeft };
}

function restoreMarketPosition(position, restoreFocus = true) {
  const selector = position.symbol ? `#stock-rows tr[data-symbol="${position.symbol}"]` : ".stocks-panel";
  const target = document.querySelector(selector);
  if (!target) return;
  const focusTarget = target.querySelector("[data-favorite]") ?? document.querySelector('[data-view="favorites"]');
  if (restoreFocus) focusTarget.focus({ preventScroll: true });
  else if (document.activeElement === focusTarget) focusTarget.blur();
  const restore = () => {
    if (restoreFocus && document.activeElement !== focusTarget) return;
    document.querySelector(".table-scroll").scrollLeft = position.left;
    window.scrollBy({ top: target.getBoundingClientRect().top - position.top, behavior: "instant" });
  };
  restore();
  // Also settle the position after mobile browsers finish their layout pass.
  requestAnimationFrame(restore);
}

function syncTableFavorite(symbol) {
  const button = document.querySelector(`#stock-rows [data-favorite="${symbol}"]`);
  if (!button) return;
  const favorite = state.favorites.includes(symbol);
  const stock = snapshots.find((item) => item.symbol === symbol);
  button.classList.toggle("is-favorite", favorite);
  button.setAttribute("aria-pressed", favorite);
  button.setAttribute("aria-label", `${favorite ? "移除" : "加入"}${stock.name}自選`);
  const cached = tableRowCache.get(button.closest("tr"));
  if (cached) cached.favorite = favorite;
}

/** Phone bar: the guides and settings share one menu so the brand fits beside the pages. */
function bindNavMenu() {
  const toggle = document.querySelector(".nav-more-toggle"), menu = document.querySelector("#nav-more-menu");
  const setOpen = (open, focusToggle = false) => {
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) menu.querySelector("button")?.focus();
    else if (focusToggle) toggle.focus();
  };
  toggle.addEventListener("click", () => setOpen(menu.hidden));
  // Menu items keep their data-dialog and are opened by the shared click handler.
  menu.addEventListener("click", (event) => { if (event.target.closest("[data-dialog]")) setOpen(false); });
  document.addEventListener("click", (event) => { if (!menu.hidden && !event.target.closest(".nav-more")) setOpen(false); });
  menu.addEventListener("keydown", (event) => {
    const items = [...menu.querySelectorAll("button")], index = items.indexOf(document.activeElement);
    if (event.key === "Escape") { event.preventDefault(); setOpen(false, true); }
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus();
    }
  });
  matchMedia("(min-width: 521px)").addEventListener("change", () => setOpen(false));
}

function bindEvents() {
  backtest.bind();
  bindNavMenu();
  document.addEventListener("click", (event) => {
    // Info messages close when the reader taps anywhere else.
    document.querySelectorAll(".research-plan-help[open]").forEach((hint) => {
      if (!hint.contains(event.target)) hint.open = false;
    });
  });
  const chartIndexAt = (plot, clientX) => {
    const rect = plot.querySelector("svg").getBoundingClientRect();
    const position = ((clientX - rect.left) / rect.width * 600 - 8) / 584;
    return Math.round(Math.max(0, Math.min(1, position)) * (Number(plot.getAttribute("aria-valuemax")) - 1));
  };
  document.addEventListener("pointerdown", (event) => {
    const plot = event.target.closest(".entry-chart-plot");
    if (!plot) return;
    if (event.pointerType === "touch") {
      // Touch scrubbing starts only after a hold, so a quick swipe still scrolls the page.
      clearTimeout(entryTouch?.timer);
      entryTouch = { plot, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
        x: event.clientX, active: false };
      entryTouch.timer = setTimeout(() => {
        if (!entryTouch || entryTouch.plot !== plot) return;
        entryTouch.active = true;
        // Touch events stay targeted at the plot, so a scoped listener keeps page scrolling passive.
        plot.addEventListener("touchmove", preventEntryTouchScroll, { passive: false });
        plot.focus({ preventScroll: true });
        try { plot.setPointerCapture(entryTouch.pointerId); } catch { /* pointer already released */ }
        selectEntryChartPoint(plot, chartIndexAt(plot, entryTouch.x), number);
      }, ENTRY_CHART_HOLD_MS);
      return;
    }
    plot.focus({ preventScroll: true });
    plot.setPointerCapture(event.pointerId);
    selectEntryChartPoint(plot, chartIndexAt(plot, event.clientX), number);
  });
  document.addEventListener("contextmenu", (event) => {
    if (event.target.closest(".entry-chart-plot")) event.preventDefault();
  });
  document.addEventListener("pointermove", (event) => {
    if (entryTouch?.pointerId === event.pointerId) {
      entryTouch.x = event.clientX;
      if (entryTouch.active) selectEntryChartPoint(entryTouch.plot, chartIndexAt(entryTouch.plot, event.clientX), number);
      else if (Math.hypot(event.clientX - entryTouch.startX, event.clientY - entryTouch.startY) > ENTRY_CHART_TOUCH_SLOP) {
        clearTimeout(entryTouch.timer);
        entryTouch = null;
      }
      return;
    }
    const plot = event.target.closest(".entry-chart-plot");
    if (plot?.hasPointerCapture(event.pointerId))
      selectEntryChartPoint(plot, chartIndexAt(plot, event.clientX), number);
  });
  for (const eventName of ["pointerup", "pointercancel"])
    document.addEventListener(eventName, (event) => {
      if (entryTouch?.pointerId === event.pointerId) {
        const { plot, active, timer, x } = entryTouch;
        clearTimeout(timer);
        plot.removeEventListener("touchmove", preventEntryTouchScroll);
        entryTouch = null;
        // A short tap still selects the touched trading day.
        if (!active && eventName === "pointerup") {
          plot.focus({ preventScroll: true });
          selectEntryChartPoint(plot, chartIndexAt(plot, x), number);
        }
        restoreEntryChartTitle(plot, number);
        return;
      }
      const plot = event.target.closest(".entry-chart-plot");
      if (plot) restoreEntryChartTitle(plot, number);
    });
  document.addEventListener("focusout", (event) => {
    const plot = event.target.closest(".entry-chart-plot");
    if (plot) restoreEntryChartTitle(plot, number);
  });
  document.addEventListener("keydown", (event) => {
    const plot = event.target.closest(".entry-chart-plot");
    if (!plot || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = Number(plot.dataset.index), last = Number(plot.getAttribute("aria-valuemax")) - 1;
    selectEntryChartPoint(plot, event.key === "Home" ? 0 : event.key === "End" ? last :
      index + (event.key === "ArrowRight" ? 1 : -1), number);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.querySelector('#info-dialog[data-entry-drawer="true"]')?.open) {
      document.querySelector("#info-dialog").close();
      return;
    }
    const row = event.target.closest("#stock-rows tr[data-symbol]");
    if (event.target !== row || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    void openEntryScoreDialog(row.dataset.symbol, true);
  });
  tableBatches.observe();
  controls.bind();
  bindInputMode((touch) => { touchInteraction = touch; });
  matchMedia("(min-width: 900px)").addEventListener("change", closeEntryDrawer);
  bindPullToRefresh(document.querySelector("#pull-refresh"));
  window.addEventListener("stockapps:refresh", (event) => {
    event.preventDefault();
    void refreshWithVersionCheck();
  });
  bindKeyboardNavigation({ onSearch: openSearch, onSectorDetails: openSectorDialog });
  // Phone list: draw the rows that scroll into view, at most once a frame.
  let listFrame = 0;
  document.querySelector(".table-scroll").addEventListener("scroll", () => {
    if (listFrame || !document.querySelector(".stocks-panel.is-fitted")) return;
    listFrame = requestAnimationFrame(() => { listFrame = 0; renderTable(); });
  }, { passive: true });
  // The header above the list changes height with the sector flows and the phone's toolbars.
  window.addEventListener("resize", fitMarketPanel);
  new ResizeObserver(() => fitMarketPanel()).observe(document.querySelector(".page-heading"));
  document.addEventListener("click", (event) => {
    const home = event.target.closest("[data-home]");
    if (home) {
      closeEntryDrawer();
      void checkPwaUpdate().catch((error) => console.warn("PWA update check failed", error));
      event.preventDefault();
      showLatestPage("home");
      window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      if (touchInteraction) home.blur();
      else document.querySelector("#main").focus({ preventScroll: true });
      return;
    }
    const sectorCard = event.target.closest("#sector-grid [data-sector-details]");
    if (sectorCard) {
      openSectorDialog(sectorCard.dataset.sectorDetails, !touchInteraction);
      return;
    }
    const stockRow = event.target.closest("#stock-rows tr[data-symbol]");
    if (stockRow && !event.target.closest("button, a, input, select, textarea")) {
      void openEntryScoreDialog(stockRow.dataset.symbol, !touchInteraction);
      return;
    }
    const researchRow = event.target.closest(":is(#research-list, #home-list, #search-results) tr.research-card[data-entry-score]");
    if (researchRow && !event.target.closest("button, a, input, select, textarea")) {
      void openEntryScoreDialog(researchRow.dataset.entryScore, !touchInteraction);
      return;
    }
    const button = event.target.closest("button");
    if (!button) return;
    if (button.closest("#required-update-dialog")) return;
    if (button.dataset.chartSeries) {
      const visible = button.getAttribute("aria-pressed") !== "true";
      button.setAttribute("aria-pressed", String(visible));
      button.closest(".entry-price-chart")
        .classList.toggle(`hide-${button.dataset.chartSeries}`, !visible);
      return;
    }
    if (button.id !== "check-update" && button.id !== "reload-data")
      void checkPwaUpdate().catch((error) => console.warn("PWA update check failed", error));
    if (button.id === "check-update") {
      const status = document.querySelector("#update-check-status");
      status.hidden = false;
      status.textContent = "正在檢查更新…";
      button.disabled = true;
      button.textContent = "檢查中…";
      checkPwaUpdate(true).then((updated) => {
        status.textContent = updated ? "發現更新，請點選更新視窗上的更新"
          : nativeMode ? "已是最新資料" : "已是最新版本";
      }).catch((error) => { status.textContent = error.message || "無法檢查更新"; })
        .finally(() => { button.disabled = false; button.textContent = "檢查更新"; });
      return;
    }
    if (button.id === "reload-data") { void refreshWithVersionCheck(); return; }
    if (button.dataset.institutionSector) {
      const symbol = button.dataset.institutionSector;
      const stock = latestSnapshots.find(item => item.symbol === symbol);
      if (!stock?.sector || isEtf(stock)) { toast("目前沒有可查看的產業法人資料"); return; }
      document.querySelector("#info-dialog").close();
      state.page = "market";
      state.marketView = "list";
      state.sector = stock.sector;
      renderPage(); renderTable(); renderSectorOverview();
      openSectorDialog(stock.sector, !touchInteraction, symbol);
      return;
    }
      if (button.dataset.dialog) openDialog(button.dataset.dialog, !touchInteraction);
    if (button.dataset.entryScore) void openEntryScoreDialog(button.dataset.entryScore, !touchInteraction,
      state.page === "favorites" && Boolean(button.closest("#research-list")));
    if (button.dataset.searchSuggestion) {
      const input = document.querySelector("#stock-search");
      input.value = state.searchQuery = button.dataset.searchSuggestion;
      renderSearch();
      input.focus({ preventScroll: true });
    }
    if (button.dataset.marketViewChoice) {
      state.marketView = button.dataset.marketViewChoice;
      renderPage(); renderSectorOverview();
    }
    if (button.dataset.sectorChip) {
      state.sector = button.dataset.sectorChip;
      renderTable(); renderSectorOverview();
    }
    if (button.dataset.sectorOpen) openSectorDialog(button.dataset.sectorOpen, !touchInteraction);
    if (button.dataset.homeExpand !== undefined) {
      state.homeExpanded = true;
      renderHome();
    }
    if (button.dataset.sectorWindow) {
      state.sectorWindow = button.dataset.sectorWindow;
      renderSectorOverview();
    }
    if (button.dataset.sectorSort) {
      state.sectorSort = button.dataset.sectorSort;
      renderSectorOverview();
    }
    if (button.dataset.sectorExpand !== undefined) {
      state.sectorExpanded = true;
      renderSectorOverview();
    }
    if (button.dataset.page) {
      if (button.dataset.page === "search") openSearch();
      else { closeEntryDrawer(); showLatestPage(button.dataset.page); }
          window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    }
    if (button.id === "close-sector-dialog")
      document.querySelector("#sector-dialog").close();
    if (button.id === "close-dialog")
      document.querySelector("#info-dialog").close();
    if (button.dataset.favorite) {
      const symbol = button.dataset.favorite;
      const wasFavorite = state.favorites.includes(symbol);
      const position = rememberMarketPosition(button, wasFavorite);
      state.favorites = wasFavorite
        ? state.favorites.filter((item) => item !== symbol)
        : [...state.favorites, symbol];
      if (wasFavorite) removeResearchPeriod(researchStore, symbol);
      else {
        const stock = latestSnapshots.find((item) => item.symbol === symbol);
        const joinedPrice = stock?.latest?.date === dataset.info.asOf
          ? priceBaseline(stock.latest, { asOf: dataset.info.asOf,
            capturedAt: new Date().toISOString(), source: apiMode ? "verified-summary" : "demo",
            priceBasis: "unadjusted", revisionId: dataset.info.generation ?? null }) : null;
        addResearchPeriod(researchStore, { symbol, market: stock?.market, baseline: joinedPrice });
      }
      saveResearch();
      savePreferences();
      renderResearch();
      if (state.view === "favorites") renderTable();
      else syncTableFavorite(symbol);
      const dialogFavorite = document.querySelector(`#info-dialog [data-favorite="${symbol}"]`);
      if (dialogFavorite) {
        dialogFavorite.classList.toggle("is-favorite", !wasFavorite);
        dialogFavorite.setAttribute("aria-pressed", String(!wasFavorite));
        dialogFavorite.setAttribute("aria-label", `${wasFavorite ? "加入" : "移除"}${snapshots.find((stock) => stock.symbol === symbol)?.name ?? symbol}自選`);
      }
      if (position) restoreMarketPosition(position, !touchInteraction);
      else {
        const focusTarget = document.querySelector(`#stock-rows [data-favorite="${symbol}"]`) ||
          document.querySelector('[data-view="favorites"]');
        if (!touchInteraction) focusTarget.focus({ preventScroll: true });
      }
      toast(
        wasFavorite ? `已將 ${symbol} 移出自選` : `已將 ${symbol} 加入自選`,
      );
    }
    if (button.dataset.view) {
      // The phone row works as toggles: tapping the active chip or 全部 clears it.
      const phone = matchMedia("(max-width: 700px)").matches;
      state.view = phone && state.view === button.dataset.view ? "all" : button.dataset.view;
      if (phone && button.dataset.view === "all") setResearchFilter("all");
      renderTable();
    }
    if (button.dataset.sort) {
      state.sortDirection =
        state.sort === button.dataset.sort ? -state.sortDirection : -1;
      state.sort = button.dataset.sort;
      renderTable();
    }
    if (button.id === "reset-filters") resetFilters();
    if (button.hasAttribute("data-manage-favorites")) {
      resetFilters();
      state.page = "market";
      renderPage();
      const table = document.querySelector(".table-scroll");
      table.focus({ preventScroll: true });
      table.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    }
    if (button.id === "default-settings") {
      for (const [key, value] of Object.entries(DEFAULT_SETTINGS))
        document.querySelector(`#${key}`).value = value;
    }
  });
  document.querySelector("#stock-search").addEventListener("input", (event) => {
    state.searchQuery = event.target.value;
    renderSearch();
  });
  document.querySelector("#market-research-filter").addEventListener("change", (event) => {
    setResearchFilter(event.target.value);
    renderTable();
  });
  document.querySelector("#market-sort").addEventListener("change", (event) => {
    state.sort = event.target.value;
    state.sortDirection = state.sort === "symbol" ? 1 : -1;
    renderTable();
  });
  document.querySelector("#trade-date").addEventListener("change", (event) => {
    const previousDate = selectedSummary?.meta.asOf ?? state.date;
    const requestedDate = event.target.value;
    state.date = requestedDate;
    void selectSummary(requestedDate).catch((error) => {
      if (state.date !== requestedDate) return;
      state.date = previousDate;
      event.target.value = previousDate;
      refreshData();
      toast(error.message);
    });
  });
  document.addEventListener("change", (event) => {
    if (event.target.id === "research-sort") { researchSort = event.target.value; renderResearch(); return; }
    if (event.target.id === "research-filter") { researchFilter = event.target.value; renderResearch(); return; }
    if (event.target.id !== "theme" && event.target.name !== "moodStyle") return;
    if (event.target.id === "theme") state.theme = event.target.value === "dark" ? "dark" : "light";
    else state.moodStyle = event.target.value === "scale" ? "scale" : "gauge";
    applyTheme();
    savePreferences();
  });
  document.addEventListener("submit", (event) => {
    if (event.target.id !== "settings-form") return;
    event.preventDefault();
    const form = new FormData(event.target);
    const previousSettings = selectedSummary?.meta.settings ?? state.settings;
    state.settings = Object.fromEntries(
      ["period", "kSmooth", "dSmooth"].map((key) => [
        key,
        Number(form.get(key)),
      ]),
    );
    const requestedSettings = state.settings;
    savePreferences();
    void selectSummary(state.date).catch((error) => {
      if (state.settings !== requestedSettings) return;
      state.settings = previousSettings;
      refreshData();
      savePreferences();
      toast(error.message);
    });
    document.querySelector("#info-dialog").close();
    toast("設定已儲存");
  });
  dialogs.bindBackdropDismiss();
  dialogs.bindMobileDismiss(document.querySelector("#info-dialog"), ".info-dialog-handle");
  const sectorDialog = document.querySelector("#sector-dialog");
  dialogs.bindMobileDismiss(sectorDialog, ".sector-dialog-handle", { sheetQuery: SECTOR_SHEET });
  sectorDialog.addEventListener("close", () => {
    const name = state.sectorName;
    state.sectorName = null;
    const trigger = [...document.querySelectorAll("#sector-grid [data-sector-details]")]
      .find((card) => card.dataset.sectorDetails === name);
    if (touchInteraction) {
      if (document.activeElement === trigger) trigger.blur();
    } else trigger?.focus({ preventScroll: true });
  });
}

async function init() {
  if (nativeMode) {
    const { prepareNativeStorage } = await import("./native/bootstrap.js");
    nativeStorage = await prepareNativeStorage({ fallback: preferenceStorage(),
      onError: () => toast("設定暫時無法儲存，請稍後重試") });
  }
  readPreferences();
  restorePage(state, nativeMode ? nativeStorage : undefined);
  if (state.page === "backtest") { state.page = "home"; backtestRestore = true; }
  applyTheme();
  startVersionChecks();
  // Download while the launch animation plays; the splash waits for it (up to a cap) before revealing the page.
  const pendingData = apiMode ? loadMarketSummary(fetch, { settings: state.settings,
    onCacheFallback: () => { usingCachedData = true; renderConnectionState(); } }) : loadDataset();
  pendingData.catch(() => {}); // Failures surface when awaited below, after the splash.
  await Promise.all([finishAppSplashBeforeLoading(pendingData), stylesheetReady()]);
  const prepare = () => {
    state.date = dataset.info.asOf;
    state.favorites = [...new Set(state.favorites)].filter((symbol) => dataset.stocks.some((stock) => stock.symbol === symbol));
    researchStore = loadResearchStore(appStorage(), state.favorites);
    for (const period of researchStore.periods) if (!period.market)
      period.market = dataset.stocks.find((stock) => stock.symbol === period.symbol)?.market ?? null;
    saveResearch();
  };
  if (apiMode) {
    loading = true; isDemo = false;
    dataset = { stocks: [], dates: [], info: { mode: "twse", label: "", asOf: "" } };
    snapshots = []; latestSnapshots = [];
    pendingSymbols.clear();
    shell(); bindEvents(); enablePwa(); refreshData();
    const loaded = await pendingData;
    dataset = loaded.dataset;
    prepare();
    latestSummary = loaded.summary;
    selectedSummary = loaded.summary;
    summaryCache.set(summaryKey(state.date), loaded.summary);
    loadProgress = { loaded: dataset.stocks.length, total: dataset.stocks.length };
    document.querySelector(".demo-badge").innerHTML = `<span></span>${esc(dataset.info.label)}`;
    document.querySelector("#trade-date").innerHTML = dataset.dates.slice(-30).reverse()
      .map((date) => `<option value="${date}">${date.replaceAll("-", "/")}</option>`).join("");
    loading = false;
    refreshData(); renderConnectionState(); savePreferences();
    updateFlow.finishStartup({ fresh: !usingCachedData });
    return;
  }
  dataset = await pendingData;
  isDemo = dataset.info.mode === "demo";
  prepare(); shell(); bindEvents(); enablePwa();
  refreshData();
  renderConnectionState();
  savePreferences();
  updateFlow.finishStartup();
}

init().catch((error) => {
  updateFlow.failStartup();
  console.error("Unable to initialize stock dashboard", error);
  if (document.querySelector("#load-status")) {
    loading = false; loadFailed = true;
    renderLoadState(); renderTable(); renderSectorOverview(); renderHome();
    return;
  }
  document.querySelector("#app").innerHTML =
    '<main class="load-error"><h1>暫時無法載入資料</h1><p>請重新整理頁面再試一次。</p></main>';
});
