// Liquid joins for the glass split-capsule filters (market list and 自選 filters).
//
// The glass style draws each filter option as a pill; options next to each other share one piece and the
// chosen option detaches into its own capsule (src/glass-preview.css). Joining two pieces used to show a
// hard seam. Here the pill shapes are drawn on a separate layer behind the buttons and passed through an
// SVG "goo" filter (blur, then a sharp alpha threshold): shapes that come within a few pixels of each other
// grow a neck and flow together like drops of water, and separate the same way. The buttons keep their
// text crisp above the layer. The layer follows the buttons frame by frame while they move.
//
// Also marks a phone filter row that is wider than its space (.is-overflowing) so only then does it scroll
// with a fading edge; otherwise the row is centred.

const SVG = "http://www.w3.org/2000/svg";
export const PILL_GOO_FILTER = "pill-goo";
const MOTION_MS = 900; // the longest glass transition (margins .75s) plus the pop

/** One filter definition for the page: goo, then a hairline ring around the merged shape. */
function ensureFilter() {
  if (document.getElementById(PILL_GOO_FILTER)) return;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  svg.innerHTML = `<filter id="${PILL_GOO_FILTER}" x="-5%" y="-30%" width="110%" height="160%" color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur"/>
    <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 36 -17" result="goo"/>
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
  let frame = 0, until = 0;

  const sync = () => {
    const buttons = [...group.querySelectorAll(":scope > button")].filter((button) => button.getClientRects().length);
    while (layer.children.length < buttons.length) layer.append(document.createElement("i"));
    while (layer.children.length > buttons.length) layer.lastElementChild.remove();
    layer.style.width = `${group.scrollWidth}px`;
    // Positions in fractions of a pixel: the buttons glide by sub-pixel steps, and whole-pixel offsets
    // (offsetLeft) made a shape's edge jump a pixel at a time beside its button, which read as the edge
    // trembling. Measured from the rendered boxes, then divided by any scale an ancestor's transform (a page's
    // entry animation) applies, so the shapes still line up during it.
    const area = group.getBoundingClientRect(), scale = group.offsetWidth ? area.width / group.offsetWidth || 1 : 1;
    buttons.forEach((button, index) => {
      // The chosen capsule's own pop is a transform on the button, so the blob takes it over as well.
      const blob = layer.children[index], style = getComputedStyle(button), box = button.getBoundingClientRect();
      const transform = style.transform === "none" ? null : new DOMMatrixReadOnly(style.transform);
      // The box includes the button's own transform; the layout box is what the shape is placed on.
      const width = button.offsetWidth ? (transform ? box.width / transform.a : box.width) / scale : 0;
      const height = button.offsetHeight ? (transform ? box.height / transform.d : box.height) / scale : 0;
      const left = (box.left + box.width / 2 - area.left) / scale - group.clientLeft + group.scrollLeft - width / 2;
      const top = (box.top + box.height / 2 - area.top) / scale - group.clientTop + group.scrollTop - height / 2;
      blob.style.left = `${left.toFixed(2)}px`;
      blob.style.top = `${top.toFixed(2)}px`;
      blob.style.width = `${width.toFixed(2)}px`;
      blob.style.height = `${height.toFixed(2)}px`;
      blob.style.transform = style.transform === "none" ? "" : style.transform;
      // Corners follow the button: square where two options share a piece, so a joined piece is smooth at
      // rest, and rounding as they part or meet, which is when the liquid neck shows.
      blob.style.borderRadius = style.borderRadius;
      blob.classList.toggle("is-chosen", button.getAttribute("aria-pressed") === "true");
    });
    group.classList.toggle("is-overflowing", group.scrollWidth > group.clientWidth + 1);
  };
  /** Follows the buttons every frame while their margins and corners animate. */
  const follow = () => {
    until = performance.now() + MOTION_MS;
    if (frame) return;
    const step = () => {
      sync();
      frame = performance.now() < until ? requestAnimationFrame(step) : 0;
    };
    frame = requestAnimationFrame(step);
  };

  // The layer's own blobs change classes too; only the buttons and the group start a follow.
  new MutationObserver((records) => { if (records.some((record) => !layer.contains(record.target))) follow(); })
    .observe(group, { subtree: true, attributes: true, attributeFilter: ["aria-pressed", "class", "hidden"] });
  new ResizeObserver(sync).observe(group);
  group.addEventListener("scroll", sync, { passive: true });
  group.addEventListener("transitionrun", follow);
  group.gooSync = sync;
  sync();
  return sync;
}
