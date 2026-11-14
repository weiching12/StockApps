/**
 * Glass preview page switch: the old page blurs and fades out (a view transition
 * snapshot) while the new page's cards frost in underneath. Without the preview,
 * the View Transitions API or with reduced motion, the update runs immediately.
 */
import { effectsReduced } from "./glass-mode.js";

let switchToken = 0;

export function withPageTransition(update) {
  const root = document.documentElement;
  if (!root.classList.contains("glass-preview") || typeof document.startViewTransition !== "function" || effectsReduced()) {
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
