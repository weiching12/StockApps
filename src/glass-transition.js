/**
 * Glass preview page switch: the old page blurs and fades out (a view transition
 * snapshot) while the new page's cards frost in underneath. Without the preview,
 * the View Transitions API, with reduced motion or on a wide window, the update runs immediately.
 */
import { effectsReduced } from "./glass-mode.js";

let switchToken = 0;

export const WIDE_WINDOW = "(min-width: 1101px)";

export function withPageTransition(update) {
  const root = document.documentElement;
  // On a wide window the snapshot covers the whole content area and its blurred fade-out
  // drops frames (and its blur makes the frame glass repaint), so the new page only frosts in.
  if (!root.classList.contains("glass-preview") || typeof document.startViewTransition !== "function" || effectsReduced() ||
      matchMedia(WIDE_WINDOW).matches) {
    update();
    return;
  }
  const token = ++switchToken;
  root.classList.add("glass-switching");
  const transition = document.startViewTransition(update);
  // Keep the entry delay until the cards have landed; dropping it mid-animation makes them jump.
  transition.finished.finally(() => setTimeout(() => {
    if (token === switchToken) root.classList.remove("glass-switching");
  }, 700));
}
