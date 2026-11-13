/**
 * Glass preview: when a list's content is swapped in place (the market list for
 * another sector, the sector ranking for another sort or period), only its rows
 * refresh: from top to bottom each row fades in from a light blur. Nothing rolls
 * or moves, and only rows on screen animate.
 */
const MAX_ROWS = 18;
const ROW_STAGGER = 35;

export function refreshRows(rowElements) {
  if (!document.documentElement.classList.contains("glass-preview") ||
      matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  rowElements.filter((row) => {
    const box = row.getBoundingClientRect();
    return box.height > 0 && box.bottom > 0 && box.top < innerHeight;
  }).slice(0, MAX_ROWS).forEach((row, index) => {
    row.animate(
      [{ opacity: 0, filter: "blur(6px)" }, { opacity: 1, filter: "blur(0)" }],
      { duration: 380, delay: index * ROW_STAGGER, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "backwards" },
    );
  });
}
