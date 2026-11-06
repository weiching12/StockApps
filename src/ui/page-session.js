const KEY = "stock-insight-current-page";
const PAGES = new Set(["home", "market", "favorites", "backtest"]);

export function restorePage(state, storage) {
  try {
    const page = (storage ?? globalThis.sessionStorage)?.getItem(KEY);
    // The institutional ranking page now lives inside the market list.
    if (page === "sectors") state.page = "market";
    else if (PAGES.has(page)) state.page = page;
  } catch { /* Session storage may be disabled. */ }
}

export function rememberPage(page, storage) {
  if (!PAGES.has(page)) return;
  try { (storage ?? globalThis.sessionStorage)?.setItem(KEY, page); } catch { /* Keep navigation usable without storage. */ }
}
