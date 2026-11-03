const KEY = "stock-insight-current-page";
const PAGES = new Set(["market", "favorites", "sectors", "backtest"]);

export function restorePage(state, storage) {
  try {
    const page = (storage ?? globalThis.sessionStorage)?.getItem(KEY);
    if (PAGES.has(page)) state.page = page;
  } catch { /* Session storage may be disabled. */ }
}

export function rememberPage(page, storage) {
  if (!PAGES.has(page)) return;
  try { (storage ?? globalThis.sessionStorage)?.setItem(KEY, page); } catch { /* Keep navigation usable without storage. */ }
}
