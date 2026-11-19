// Liquid joins for the glass split-capsule filters (market list and 自選 filters).
//
// The glass style draws each filter option as a pill; options next to each other share one piece and the
// chosen option detaches into its own capsule (src/glass-preview.css). Joining two pieces used to show a
// hard seam. Here the pill shapes are drawn on a separate layer behind the buttons and passed through an
// SVG "goo" filter (blur, then a sharp alpha threshold): shapes that come within a few pixels of each other
// grow a neck and flow together like drops of water, and separate the same way. The buttons keep their
// text crisp above the layer and never move: they sit at a fixed gap, and only the shapes change. Options
// that share a piece reach across the gap to each other; the chosen option's shape stays within its button,
// so a gap opens on each side of it. Changing the choice animates the shapes' edges (a CSS transition), so
// the pieces flow apart and together while the labels stay still.
//
// Also marks a phone filter row that is wider than its space (.is-overflowing) so only then does it scroll
// with a fading edge; otherwise the row is centred.

const SVG = "http://www.w3.org/2000/svg";
export const PILL_GOO_FILTER = "pill-goo";
const MOTION_MS = 700; // the shapes glide .6s (src/glass-preview.css), and the chosen capsule fades in
const RADIUS = 10; // the pills' corner radius (var(--r) in src/glass-preview.css)

/** One filter definition for the page: goo, then a hairline ring around the merged shape. */
function ensureFilter() {
  if (document.getElementById(PILL_GOO_FILTER)) return;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  svg.innerHTML = `<filter id="${PILL_GOO_FILTER}" x="-5%" y="-30%" width="110%" height="160%" color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur"/>
    <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -11" result="goo"/>
    <feComposite in="SourceGraphic" in2="goo" operator="atop" result="fill"/>
    <feMorphology in="goo" operator="dilate" radius="1" result="grown"/>
    <feFlood class="pill-goo-ring"/>
    <feComposite in2="grown" operator="in" result="ring"/>
    <feMerge><feMergeNode in="ring"/><feMergeNode in="fill"/></feMerge>
  </filter>`;
  document.body.append(svg);
}

/** Attaches the liquid layer to one filter group. Safe to call again; returns a `sync` to call after changes. */
export function attachGooPills(group) {
  if (!group || group.querySelector(":scope > .pill-goo-layer")) return group?.gooSync ?? (() => {});
  ensureFilter();
  const layer = document.createElement("div");
  layer.className = "pill-goo-layer";
  layer.setAttribute("aria-hidden", "true");
  group.prepend(layer);
  group.classList.add("has-goo");
  let frame = 0, until = 0, lastChosen = null;

  const sync = () => {
    const buttons = [...group.querySelectorAll(":scope > button")].filter((button) => button.getClientRects().length);
    while (layer.children.length < buttons.length) layer.append(document.createElement("i"));
    while (layer.children.length > buttons.length) layer.lastElementChild.remove();
    layer.style.width = `${group.scrollWidth}px`;
    const chosen = buttons.map((button) => button.getAttribute("aria-pressed") === "true");
    // Two neighbours share a piece unless either is the chosen one.
    const joined = (index) => index > 0 && index < buttons.length && !chosen[index] && !chosen[index - 1];
    buttons.forEach((button, index) => {
      // Layout offsets, which a page's entry animation (a transform on an ancestor) does not distort; the
      // chosen capsule's own pop is a transform on the button, so the blob takes it over as well.
      const blob = layer.children[index], style = getComputedStyle(button), previous = buttons[index - 1], next = buttons[index + 1];
      const before = joined(index) ? (button.offsetLeft - previous.offsetLeft - previous.offsetWidth) / 2 : 0;
      const after = joined(index + 1) ? (next.offsetLeft - button.offsetLeft - button.offsetWidth) / 2 : 0;
      blob.style.left = `${button.offsetLeft - before}px`;
      blob.style.top = `${button.offsetTop}px`;
      blob.style.width = `${button.offsetWidth + before + after}px`;
      blob.style.height = `${button.offsetHeight}px`;
      blob.style.transform = style.transform === "none" ? "" : style.transform;
      // Square where two options share a piece, so a joined piece is smooth at rest; round at a free edge.
      const left = before ? 0 : RADIUS, right = after ? 0 : RADIUS;
      blob.style.borderRadius = `${left}px ${right}px ${right}px ${left}px`;
      blob.classList.toggle("is-chosen", chosen[index]);
    });
    group.classList.toggle("is-overflowing", group.scrollWidth > group.clientWidth + 1);
  };
  /**
   * A change of choice: the shapes glide to their new places (only then; a resize or a font arriving just
   * redraws them in place), and the chosen button's pop is followed every frame.
   */
  const follow = () => {
    // Only a move of the choice from one shown option to another glides; the first drawing, a page coming
    // into view or a resize just places the shapes.
    const buttons = [...group.querySelectorAll(":scope > button")];
    const chosen = buttons.find((button) => button.getAttribute("aria-pressed") === "true") ?? null;
    const moved = lastChosen && chosen && chosen !== lastChosen && group.getClientRects().length > 0;
    lastChosen = chosen;
    if (!moved) { sync(); return; }
    until = performance.now() + MOTION_MS;
    layer.classList.add("is-flowing");
    if (frame) return;
    const step = () => {
      sync();
      frame = performance.now() < until ? requestAnimationFrame(step) : 0;
      if (!frame) layer.classList.remove("is-flowing");
    };
    frame = requestAnimationFrame(step);
  };

  // The layer's own blobs change classes too; only the buttons and the group start a follow.
  new MutationObserver((records) => { if (records.some((record) => !layer.contains(record.target))) follow(); })
    .observe(group, { subtree: true, attributes: true, attributeFilter: ["aria-pressed", "class", "hidden"] });
  // The row and each option: a label changing width (a font arriving, a narrower layout) redraws the shapes.
  const resized = new ResizeObserver(sync);
  resized.observe(group);
  group.querySelectorAll(":scope > button").forEach((button) => resized.observe(button));
  group.addEventListener("scroll", sync, { passive: true });
  group.gooSync = sync;
  lastChosen = group.querySelector(":scope > button[aria-pressed=\"true\"]");
  sync();
  return sync;
}
