import { getFlowStreak, getRunDivergence } from "../../shared/sectors.js";

// One industry's institutional flow over the last sessions: each institution's latest run, the
// cumulative net amount of the three and their total, and the sector's price change on the same
// days as a pale area behind them. Markup and binding only; every figure comes from shared/sectors.js.
const W = 600, H = 180, PAD_X = 8, PAD_Y = 14;
// Total is drawn first so the three institutions sit on top of it.
const LINES = [["total", "total", "合計"], ["外資", "foreign", "外資"], ["投信", "trust", "投信"], ["自營商", "dealer", "自營商"]];
const INSTITUTIONS = LINES.filter(([key]) => key !== "total");
const toYi = (amount) => amount / 1e8;
const shortDate = (date) => date.slice(5).replace("-", "/");
const percentOf = (value, total) => `${(value / total * 100).toFixed(2)}%`;
const x = (index, last) => PAD_X + index * (W - 2 * PAD_X) / Math.max(1, last);

/** A zero-anchored vertical scale for values in display units. */
function scale(values, height, pad) {
  const low = Math.min(0, ...values), high = Math.max(0, ...values), span = high - low || 1;
  return { low, high, y: (value) => pad + (high - value) / span * (height - 2 * pad) };
}
const flowScale = (flow) => scale(LINES.flatMap(([key]) => flow.lines[key]).map(toYi), H, PAD_Y);
// The price change gets its own scale on the same plot, spanning its own low and high: only its shape
// and direction compare with the flow, so it is not anchored at zero.
function priceScale(price) {
  const low = Math.min(...price.returns), high = Math.max(...price.returns), span = high - low || 1;
  return { y: (value) => PAD_Y + (high - value) / span * (H - 2 * PAD_Y) };
}

// Whole numbers on an axis; only a scale under 10 needs a decimal to tell its ends apart.
const axisNumber = (value) => `${value > 0 ? "+" : "-"}${Math.abs(value).toFixed(Math.abs(value) < 10 ? 1 : 0)}`;
/** Labels for zero and the two ends; an end too close to zero is left out. */
function axisLabels({ low, high, y }, height, unit = "") {
  const zero = y(0), labels = [`<span style="top:${percentOf(zero, height)}">0${unit}</span>`];
  for (const value of [high, low])
    if (value !== 0 && Math.abs(y(value) - zero) >= height * 0.12) labels.push(`<span style="top:${percentOf(y(value), height)}">${axisNumber(value)}${unit}</span>`);
  return labels.join("");
}
const path = (values, y, last) => values.map((value, index) => `${index ? "L" : "M"}${x(index, last).toFixed(1)} ${y(value).toFixed(1)}`).join(" ");
const signedPercent = (value) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
const tone = (value) => value > 0 ? "up" : value < 0 ? "down" : "";

/** "連賣 6 日", "轉買", "持平": the latest run of one institution's daily amounts. */
export function streakLabel({ direction, length, capped, turned }) {
  if (!direction) return "持平";
  const side = direction > 0 ? "買" : "賣";
  if (length >= 2) return `連${side} ${length}${capped ? "+" : ""} 日`;
  return turned ? `轉${side}` : `${side}超 1 日`;
}

/** "10/06 轉賣" where the run began after the other direction, "10/06 起買超" after a flat day. */
const turnLabel = ({ direction, turned }, date) => `${shortDate(date)} ${turned ? "轉" : "起"}${direction > 0 ? "買" : "賣"}${turned ? "" : "超"}`;

/**
 * Only a run that goes against the sector's price is marked: an institution’s latest run is traced on
 * its line in a wider stroke and the session it began is ringed and badged with its date. The same runs
 * get a badge under their figure. Runs that agree with the price, and every run when there is no price on the same sessions, get
 * nothing. A run reaching back past the window has no turn inside it, so only its trace shows. Labels start
 * on the side the line has just left, below a turn to selling and above a turn to buying; layoutTurnLabels
 * moves any that collide.
 */
function runsMarkup(flow, y, last, price) {
  const runs = INSTITUTIONS.map(([key, toneClass]) => {
    const streak = getFlowStreak(flow.daily[key], flow.dates);
    const start = streak.since ? flow.dates.indexOf(streak.since) : -1;
    return { key, toneClass, streak, start, divergence: getRunDivergence(streak, flow.dates, price), at: start >= 0 ? y(flow.lines[key][start]) : null };
  }).filter(({ divergence }) => divergence);
  const traces = runs.map(({ key, toneClass, start }) => {
    const from = Math.max(0, start - 1);
    return `<path class="${toneClass} sector-flow-run" d="${flow.lines[key].slice(from).map((amount, offset) => `${offset ? "L" : "M"}${x(from + offset, last).toFixed(1)} ${y(amount).toFixed(1)}`).join(" ")}"/>`;
  }).join("");
  const marks = runs.filter(({ streak }) => !streak.capped).map(({ key, toneClass, streak, start, at }) => {
    const side = streak.direction < 0 ? "below" : "above";
    const edge = x(start, last) / W < 0.3 ? "from-left" : "";
    return `<span class="sector-flow-turn ${toneClass} ${side} ${edge}" data-flow-streak="${key}" style="left:${percentOf(x(start, last), W)};top:${percentOf(at, H)}" data-side="${side}"><i></i><b class="sector-flow-badge ${tone(streak.direction)}">${turnLabel(streak, streak.since)}</b></span>`;
  }).join("");
  return { traces, marks };
}

/** The sector's price change as a pale area rising from the plot's floor behind the flow lines, with no axis of its own. */
function priceLayer(price, last) {
  const { y } = priceScale(price), line = path(price.returns, y, last), base = H;
  return `<path class="price-area" d="${line} L${x(last, last).toFixed(1)} ${base} L${x(0, last).toFixed(1)} ${base} Z"/><path class="price" d="${line}"/>`;
}

/** The price line shares the flow's axis only when both cover the same sessions. */
const sameSessions = (flow, price) => Boolean(price) && price.dates.length === flow.dates.length
  && price.dates.every((date, index) => date === flow.dates[index]);

export function flowTrendMarkup(flow, price) {
  const title = `<div class="sector-detail-heading"><div><h3 id="sector-trend-heading">法人累計淨買賣超（億）</h3></div></div>`;
  if (!flow) return `<section class="sector-flow-trend" aria-labelledby="sector-trend-heading">${title}<p class="sector-flow-empty">近 20 個交易日的法人資料不足，無法畫出累計走勢。</p></section>`;
  // A picked day replaces the title with its own readout, as on the stock price chart.
  const heading = `<div class="sector-flow-header"><div class="sector-detail-heading" data-flow-title><div><h3 id="sector-trend-heading">法人累計淨買賣超（億）</h3></div></div><div class="sector-flow-pick" data-flow-pick hidden><strong data-flow-pick-date></strong><span data-flow-pick-price></span></div></div>`;
  const last = flow.dates.length - 1, geo = flowScale(flow), y = (amount) => geo.y(toYi(amount));
  const paths = LINES.map(([key, toneClass]) => `<path class="${toneClass}" d="${path(flow.lines[key], y, last)}"/>`).join("");
  const cells = [...INSTITUTIONS, LINES[0]].map(([key, toneClass, label]) => `<div class="sector-flow-cell ${toneClass}" data-flow-cell="${key}"><span>${label}</span><strong class="institution-money"></strong>${key === "total" ? "" : `<div class="sector-flow-run-slot"><span class="sector-flow-badge" data-flow-run="${key}" hidden></span></div>`}</div>`).join("");
  const dots = LINES.map(([key, toneClass]) => `<i class="sector-flow-dot ${toneClass}" data-flow-dot="${key}"></i>`).join("");
  const withPrice = sameSessions(flow, price);
  const runs = runsMarkup(flow, y, last, withPrice ? price : null);
  return `<section class="sector-flow-trend" aria-labelledby="sector-trend-heading">${heading}
    <p class="sector-flow-date"><span data-flow-date></span>${withPrice ? `<span class="sector-flow-price-read" title="灰色區域：產業內個股自 ${shortDate(price.base)} 收盤起的等權平均漲跌，未還原權息；另用比例尺，高低不與金額對應">平均股價 <strong data-flow-price></strong></span>` : ""}</p><div class="sector-flow-readout">${cells}</div>
    <div class="sector-flow-region"><div class="sector-flow-scale" aria-hidden="true">${axisLabels(geo, H)}</div>
      <div class="sector-flow-plot" role="slider" tabindex="0" aria-label="${flow.dates.length} 個交易日法人累計淨買賣超；點選圖表查看，可用方向鍵" aria-orientation="horizontal" aria-valuemin="1" aria-valuemax="${last + 1}" aria-valuenow="${last + 1}" data-flow-plot>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><line class="sector-flow-zero" x1="${PAD_X}" x2="${W - PAD_X}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>${withPrice ? priceLayer(price, last) : ""}${runs.traces}${paths}</svg>
        <div class="sector-flow-cursor" data-flow-cursor></div>${withPrice ? '<i class="sector-flow-dot price" data-flow-dot="price"></i>' : ""}${runs.marks}${dots}</div></div>
    <div class="sector-flow-dates"><span>${shortDate(flow.dates[0])}</span><span>${shortDate(flow.dates[last])}</span></div>
    <p class="sector-flow-note">法人金額以 ${flow.dates.length} 日資料完整的 ${flow.available}／${flow.expected} 檔計算，為淨買賣股數 × 當日收盤價的估算${withPrice ? `；灰色區域為 ${price.available}／${price.expected} 檔的等權平均股價漲跌，未還原權息，另用比例尺，只比較方向` : ""}。</p></section>`;
}

/**
 * Places each turn label where it fits: its own side first, then the other side, then stepped further out,
 * keeping it inside the plot and clear of the labels already placed. Measured, so it reruns on resize.
 */
function layoutTurnLabels(plot) {
  const bounds = plot.getBoundingClientRect();
  if (!bounds.width) return;
  const placed = [];
  const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  for (const mark of plot.querySelectorAll(".sector-flow-turn")) {
    const label = mark.querySelector("b"), own = mark.dataset.side, other = own === "below" ? "above" : "below";
    const tries = [0, 1, 2, 3].flatMap((lift) => [[own, lift], [other, lift]]);
    let chosen = tries[0];
    for (const [side, lift] of tries) {
      mark.classList.remove("above", "below");
      mark.classList.add(side);
      mark.style.setProperty("--lift", lift);
      const box = label.getBoundingClientRect();
      if (box.top >= bounds.top - 2 && box.bottom <= bounds.bottom + 2 && !placed.some((done) => overlaps(box, done))) { chosen = [side, lift]; break; }
    }
    mark.classList.remove("above", "below");
    mark.classList.add(chosen[0]);
    mark.style.setProperty("--lift", chosen[1]);
    placed.push(label.getBoundingClientRect());
  }
}

/** Wires tap, drag and arrow keys: a press or key picks a day and keeps it until the chart loses focus or leaves the screen. */
export function bindFlowTrend(root, flow, price, { money, direction }) {
  const plot = root.querySelector("[data-flow-plot]");
  if (!plot || !flow) return;
  const last = flow.dates.length - 1, geo = flowScale(flow);
  const priceGeo = root.querySelector('[data-flow-dot="price"]') ? priceScale(price) : null;
  let pinned = last;
  // The runs the chart highlights: the latest one of an institution that goes against the price. A badge
  // shows under its figure only on the days that highlight covers, from the run's first day on.
  const highlighted = {};
  for (const [key] of INSTITUTIONS) {
    const streak = getFlowStreak(flow.daily[key], flow.dates);
    if (priceGeo && getRunDivergence(streak, flow.dates, price)) highlighted[key] = flow.dates.indexOf(streak.since);
  }
  // While a day is picked (tap, drag, arrow keys) the readout replaces the title; leaving the chart
  // returns to the latest session and the title, as the stock price chart does.
  const title = root.querySelector("[data-flow-title]"), pick = root.querySelector("[data-flow-pick]");
  const setPicked = (index) => {
    const picked = index !== null;
    title.hidden = picked;
    pick.hidden = !picked;
    // The small date and price line repeats the readout, so it steps aside (keeping its space) meanwhile.
    root.querySelector(".sector-flow-date").style.visibility = picked ? "hidden" : "";
    if (!picked) return;
    root.querySelector("[data-flow-pick-date]").textContent = `${shortDate(flow.dates[index])} 累計`;
    const change = root.querySelector("[data-flow-pick-price]");
    change.textContent = priceGeo ? `平均股價 ${signedPercent(price.returns[index])}` : "";
    change.className = priceGeo ? tone(price.returns[index]) : "";
  };
  const show = (index) => {
    const date = shortDate(flow.dates[index]), left = percentOf(x(index, last), W);
    root.querySelector("[data-flow-date]").textContent = index === last ? `近 ${flow.dates.length} 日累計 · 至 ${date}` : `累計至 ${date}`;
    const spoken = [];
    for (const [key, , label] of LINES) {
      const amount = flow.lines[key][index];
      const figure = root.querySelector(`[data-flow-cell="${key}"] strong`);
      figure.textContent = money(amount).replace(/ 億$/, "");
      figure.className = `institution-money ${direction(amount)}`;
      const dot = root.querySelector(`[data-flow-dot="${key}"]`);
      dot.style.left = left;
      dot.style.top = percentOf(geo.y(toYi(amount)), H);
      spoken.push(`${label} ${figure.textContent}`);
      // The run as of the day on show, only while that day lies inside the stretch the chart highlights:
      // the first day reads the turn, later days how long it has lasted.
      const run = root.querySelector(`[data-flow-run="${key}"]`);
      if (run) {
        const inside = key in highlighted && index >= highlighted[key];
        const streak = inside ? getFlowStreak(flow.daily[key].slice(0, index + 1), flow.dates.slice(0, index + 1)) : null;
        run.hidden = !inside;
        run.textContent = inside ? streakLabel(streak) : "";
        run.className = `sector-flow-badge ${inside ? tone(streak.direction) : ""}`;
      }
    }
    root.querySelector("[data-flow-cursor]").style.left = left;
    let priceText = "";
    if (priceGeo) {
      const change = price.returns[index], figure = root.querySelector("[data-flow-price]");
      figure.textContent = signedPercent(change);
      figure.className = tone(change);
      const dot = root.querySelector('[data-flow-dot="price"]');
      dot.style.left = left;
      dot.style.top = percentOf(priceGeo.y(change), H);
      priceText = `；平均股價 ${figure.textContent}`;
    }
    plot.setAttribute("aria-valuenow", String(index + 1));
    plot.setAttribute("aria-valuetext", `${date} 累計：${spoken.join("、")} 億${priceText}`);
  };
  const indexAt = (clientX) => {
    const rect = plot.getBoundingClientRect();
    const position = ((clientX - rect.left) / rect.width * W - PAD_X) / (W - 2 * PAD_X);
    return Math.round(Math.max(0, Math.min(1, position)) * last);
  };
  // Like the stock price chart: nothing on hover; a press picks a day and dragging scrubs (the pointer is
  // captured, so the drag keeps going outside the plot). Releasing keeps the day on show.
  const pickAt = (clientX) => { pinned = indexAt(clientX); show(pinned); setPicked(pinned); };
  plot.addEventListener("pointerdown", (event) => {
    pickAt(event.clientX);
    plot.focus({ preventScroll: true });
    try { plot.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
  });
  plot.addEventListener("pointermove", (event) => { if (plot.hasPointerCapture?.(event.pointerId)) pickAt(event.clientX); });
  plot.addEventListener("keydown", (event) => {
    const next = { ArrowLeft: pinned - 1, ArrowRight: pinned + 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    pinned = Math.max(0, Math.min(last, next));
    show(pinned);
    setPicked(pinned);
  });
  // A click or tap anywhere else, or the chart scrolling out of view, returns it to the latest session.
  const reset = () => { if (title.hidden) { pinned = last; show(last); setPicked(null); } };
  plot.addEventListener("focusout", reset);
  // A tap on a phone does not always move focus, so a press anywhere outside the chart resets it as well.
  const outside = (event) => {
    if (!plot.isConnected) { document.removeEventListener("pointerdown", outside, true); return; }
    if (!plot.contains(event.target)) reset();
  };
  document.addEventListener("pointerdown", outside, true);
  globalThis.IntersectionObserver && new IntersectionObserver(([entry]) => { if (!entry.isIntersecting) reset(); }).observe(plot);
  show(pinned);
  layoutTurnLabels(plot);
  globalThis.ResizeObserver && new ResizeObserver(() => layoutTurnLabels(plot)).observe(plot);
}
