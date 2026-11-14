/**
 * Interface style from the settings: the glass style (default) or the classic one,
 * plus "reduce effects", which turns off transitions, animations and background
 * blur for phones that stutter. ?glass=1 / ?glass=0 in the URL override the style
 * for testing. The glass modules read effectsReduced() before animating.
 */
export function applyInterfaceStyle(state, root = document.documentElement) {
  const param = new URLSearchParams(location.search).get("glass");
  const glass = param === null ? state.uiStyle !== "classic" : param !== "0";
  root.classList.toggle("glass-preview", glass);
  if (state.reduceEffects) root.dataset.effects = "reduced";
  else delete root.dataset.effects;
}

/** True when the person asked for fewer effects, here or in their system settings. */
export function effectsReduced() {
  return document.documentElement.dataset.effects === "reduced" ||
    matchMedia("(prefers-reduced-motion: reduce)").matches;
}
