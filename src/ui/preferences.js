export function preferenceStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

export function loadPreferences(state, storage) {
  try {
    const saved = JSON.parse(storage.getItem("stock-insight-v1"));
    if (saved && Array.isArray(saved.favorites))
      state.favorites = saved.favorites.filter(
        (item) => typeof item === "string",
      );
    else state.favorites = ["2330", "2317", "0050", "3026", "6488"];
    if (saved && saved.catalogVersion !== 2)
      state.favorites = [...new Set([...state.favorites, "3026", "6488"])];
    if (
      saved?.settings &&
      ["period", "kSmooth", "dSmooth"].every(
        (key) =>
          Number.isInteger(saved.settings[key]) &&
          saved.settings[key] >= 1 &&
          saved.settings[key] <= (key === "period" ? 60 : 20),
      )
    )
      state.settings = saved.settings;
    if (["light", "dark"].includes(saved?.theme)) state.theme = saved.theme;
    if (["gauge", "scale"].includes(saved?.moodStyle)) state.moodStyle = saved.moodStyle;
  } catch {
    state.favorites = ["2330", "2317", "0050", "3026", "6488"];
  }
}

export function persistPreferences(state, toast, storage) {
  try {
    storage.setItem(
      "stock-insight-v1",
      JSON.stringify({ favorites: state.favorites, settings: state.settings, theme: state.theme, moodStyle: state.moodStyle, catalogVersion: 2 }),
    );
  } catch {
    toast("瀏覽器無法保存設定，本次操作仍可使用。");
  }
}

