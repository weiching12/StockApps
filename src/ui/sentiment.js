const value = (number) => Number.isFinite(number) ? `${Math.round(number)}` : "—";
const toneStops = [
  [0, [59, 130, 246]], [20, [96, 165, 250]], [40, [142, 169, 188]],
  [50, [196, 157, 105]], [60, [223, 152, 114]], [80, [232, 135, 112]], [100, [232, 102, 102]],
];

export function sentimentTone(score) {
  if (!Number.isFinite(score)) return "#64748b";
  const bounded = Math.min(100, Math.max(0, score));
  const upperIndex = toneStops.findIndex(([point]) => point >= bounded);
  const [upperPoint, upperColor] = toneStops[upperIndex];
  if (upperIndex === 0 || upperPoint === bounded) return `#${upperColor.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  const [lowerPoint, lowerColor] = toneStops[upperIndex - 1];
  const mix = (bounded - lowerPoint) / (upperPoint - lowerPoint);
  return `#${upperColor.map((channel, index) => Math.round(lowerColor[index] + (channel - lowerColor[index]) * mix)
    .toString(16).padStart(2, "0")).join("")}`;
}

// The five score bands, equal width, from fear to greed.
const bandTones = [10, 30, 50, 70, 90].map(sentimentTone);

function arcSegment(index) {
  const point = (degrees) => { const radians = degrees * Math.PI / 180; return `${(60 + 50 * Math.cos(radians)).toFixed(1)} ${(60 - 50 * Math.sin(radians)).toFixed(1)}`; };
  return `M${point(180 - 36 * index - 1)}A50 50 0 0 1 ${point(180 - 36 * (index + 1) + 1)}`;
}

/** Both score styles; the moodStyle setting shows one through CSS, so switching needs no re-render. */
export const moodMeterMarkup = () => `<svg class="sentiment-arc" viewBox="0 0 120 66" aria-hidden="true">${bandTones.map((tone, index) => `<path d="${arcSegment(index)}" stroke="${tone}"/>`).join("")}<line class="sentiment-needle" x1="60" y1="60" x2="60" y2="20"/><circle cx="60" cy="60" r="4"/></svg>
  <div class="sentiment-scale" aria-hidden="true"><div class="sentiment-scale-track">${bandTones.map((tone) => `<i style="background:${tone}"></i>`).join("")}<span class="sentiment-scale-marker"></span></div><div class="sentiment-scale-ends"><span>恐懼</span><span>貪婪</span></div></div>
  <div class="sentiment-readout"><strong class="sentiment-score">—</strong><span class="sentiment-band"></span></div>`;

const count = (number) => Number.isFinite(number) ? number.toLocaleString("zh-TW") : "—";
const decimals = (number, digits) => number.toLocaleString("zh-TW", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const toneOf = (number) => number > 0 ? "up" : number < 0 ? "down" : "";
const escapeText = (text) => String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** Net amount in 億, signed and to two decimals like the rest of the institutional figures. */
export const netAmountText = (amount) => !Number.isFinite(amount) ? "—"
  : `${amount > 0 ? "+" : amount < 0 ? "-" : ""}${decimals(Math.abs(amount) / 1e8, 2)} 億`;

/** An amount in a narrow card cell: whole 億 once it reaches 100. */
export const factAmountText = (amount) => !(Math.abs(amount) >= 1e10) ? netAmountText(amount)
  : `${amount > 0 ? "+" : "-"}${decimals(Math.abs(amount) / 1e8, 0)} 億`;

/** Signed run of sessions on one side: +3 reads 連買 3 日, -2 reads 連賣 2 日. */
export const streakText = (streak) => !Number.isFinite(streak) ? "—"
  : streak === 0 ? "買賣持平" : `${streak > 0 ? "連買" : "連賣"} ${Math.abs(streak)} 日`;

function breadthMarkup({ advancing, unchanged, declining }) {
  const known = Number.isFinite(advancing);
  const part = (tone, number) => `<i class="${tone}" style="flex-grow:${known ? number : 0}"></i>`;
  return `<span class="up" title="上漲 ${count(advancing)} 檔">漲 <b>${count(advancing)}</b></span><div class="sentiment-breadth-bar" title="上漲 ${count(advancing)}、平盤 ${count(unchanged)}、下跌 ${count(declining)} 檔">${part("up", advancing)}${part("flat", unchanged)}${part("down", declining)}</div><span class="down" title="下跌 ${count(declining)} 檔">跌 <b>${count(declining)}</b></span>`;
}

// Inflow points up and outflow down; a flat or unknown amount gets a level line.
const CHIP_ARROWS = { up: "M8 13V3M3.5 7.5 8 3l4.5 4.5", down: "M8 3v10M3.5 8.5 8 13l4.5-4.5" };
const chipArrow = (tone) => `<svg class="sentiment-chip-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${CHIP_ARROWS[tone] ?? "M3.5 8h9"}"/></svg>`;

/** A pill like the unusual-institution ones: a direction arrow, a name, the amount and an optional note. */
function chipMarkup({ amount, name, note = "", attributes, label }) {
  return `<button type="button" class="sentiment-chip ${toneOf(amount)}" ${attributes} aria-label="${escapeText(label)}">${chipArrow(toneOf(amount))}${escapeText(name)} <b>${factAmountText(amount)}</b>${note ? `<small>${escapeText(note)}</small>` : ""}</button>`;
}

/** Each row reads the same way: a label, then its figure or its pills. */
function factsMarkup(market) {
  const { institutionalNet: net, institutionalStreak: streak, inflow, outflow } = market;
  const flow = (row, side) => row ? chipMarkup({ amount: row.amount, name: row.sector,
    attributes: `data-sector-open="${escapeText(row.sector)}"`, label: `查看${row.sector}產業個股；法人${side} ${factAmountText(row.amount)}` }) : "";
  const flows = flow(inflow, "流入") + flow(outflow, "流出");
  return `<div class="sentiment-row" data-fact="institutions" title="僅計上市普通股，淨買賣股數 × 當日收盤價，屬估算值"><span class="sentiment-row-label">法人淨買賣</span><div class="sentiment-row-items"><strong class="${toneOf(net)}">${factAmountText(net)}</strong><small class="${toneOf(streak)}">${escapeText(streakText(streak))}</small></div></div>`
    + `<div class="sentiment-row" data-fact="flows" title="依細產業加總的三大法人淨買賣金額，流入、流出各取最大的一個；只代表三大法人"><span class="sentiment-row-label">資金流向</span><div class="sentiment-row-items">${flows || '<small class="sentiment-row-none">—</small>'}</div></div>`;
}

/** The day's largest unusual buyer and seller, then unusual buying the price did not follow; each pill opens its stock. */
function unusualMarkup({ unusual, quietBuying } = {}) {
  if (!unusual) return "";
  const percent = (value) => `${value > 0 ? "+" : ""}${decimals(value, 2)}%`;
  const quiet = (quietBuying ?? []).map((row) => chipMarkup({ amount: row.amount, name: row.name, note: `股價 ${percent(row.changePercent)}`,
    attributes: `data-entry-score="${escapeText(row.symbol)}"`,
    label: `查看${row.name}進場研究；法人買超 ${factAmountText(row.amount)}，約平常的 ${decimals(row.multiple, 1)} 倍，股價 ${percent(row.changePercent)}` })).join("");
  const chip = (row) => row ? chipMarkup({ amount: row.amount, name: row.name, note: `平常 ${decimals(row.multiple, 1)} 倍`,
    attributes: `data-entry-score="${escapeText(row.symbol)}"`,
    label: `查看${row.name}進場研究；法人${row.amount > 0 ? "買超" : "賣超"} ${factAmountText(row.amount)}，約平常的 ${decimals(row.multiple, 1)} 倍` }) : "";
  const chips = chip(unusual.buy) + chip(unusual.sell);
  return `<div class="sentiment-row" data-fact="unusual"><span class="sentiment-row-label" title="今日三大法人淨買賣金額，達近 20 個交易日每日平均金額 2 倍以上的個股，買超、賣超各取金額最大的一檔">大戶異常</span><div class="sentiment-row-items">${chips || '<small class="sentiment-row-none">今日沒有明顯異常</small>'}</div></div>`
    + `<div class="sentiment-row" data-fact="quiet-buying"><span class="sentiment-row-label" title="今日三大法人買超金額達近 20 個交易日每日平均金額 2 倍以上，但股價收平或下跌的個股，依買超金額取前 3 檔">買超未漲</span><div class="sentiment-row-items">${quiet || '<small class="sentiment-row-none">今日沒有符合的個股</small>'}</div></div>`;
}

const MOOD_SWEEP_MS = 1400;
/** Sweep progress for elapsed 0-1: quick off the mark, slowing as it settles on the score. */
export const moodSweepProgress = (elapsed) => 1 - (1 - Math.min(1, Math.max(0, elapsed))) ** 4;

function showMoodValue(card, score) {
  card.querySelector(".sentiment-score").textContent = value(score);
  card.style.setProperty("--sentiment-score", `${score ?? 0}%`);
  card.style.setProperty("--sentiment-needle", `${((score ?? 50) - 50) * 1.8}deg`);
}

// The sweep plays each time the home page opens: on first sight, and again on returning from
// another page, which hides the card. Scrolling it away and back, or a re-render, does not replay it.
const moodSweep = { state: "waiting", target: null, observer: null, run: 0 };

function playMoodSweep(card) {
  moodSweep.state = "playing";
  const run = ++moodSweep.run, start = performance.now();
  const step = (now) => {
    if (run !== moodSweep.run) return;
    const elapsed = (now - start) / MOOD_SWEEP_MS;
    if (elapsed >= 1) { moodSweep.state = "done"; showMoodValue(card, moodSweep.target); return; }
    showMoodValue(card, moodSweep.target * moodSweepProgress(elapsed));
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderMoodValue(card, score) {
  moodSweep.target = score;
  const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!Number.isFinite(score) || reduced || !globalThis.IntersectionObserver) { moodSweep.run++; showMoodValue(card, score); return; }
  if (moodSweep.state === "playing") return;
  if (moodSweep.state === "done") { showMoodValue(card, score); return; }
  showMoodValue(card, 0);
  if (moodSweep.observer) return;
  moodSweep.observer = new IntersectionObserver(([entry]) => {
    const scoreKnown = Number.isFinite(moodSweep.target);
    if (entry.isIntersecting) { if (moodSweep.state === "waiting" && scoreKnown) playMoodSweep(card); return; }
    // A hidden panel measures zero wide; a card merely scrolled off keeps its size.
    if (entry.boundingClientRect.width > 0) return;
    moodSweep.run++;
    moodSweep.state = "waiting";
    if (scoreKnown) showMoodValue(card, 0);
  });
  moodSweep.observer.observe(card);
}

export function renderSentiment(sentiment) {
  const card = document.querySelector("#market-sentiment"); if (!card) return;
  card.dataset.sentiment = sentiment.band.key;
  card.querySelector(".sentiment-card").style.setProperty("--sentiment-tone", sentimentTone(sentiment.score));
  card.querySelector(".sentiment-band").textContent = sentiment.band.label;
  renderMoodValue(card, sentiment.score);
  card.querySelector(".sentiment-date").textContent = sentiment.status === "insufficient"
    ? sentiment.score === null ? "資料不足 · 等待有效市場資料" : `資料不足 · 沿用 ${sentiment.date} 分數`
    : `${sentiment.components.coverage} 檔上市個股`;
  // A cached response from before these figures existed simply shows the score alone.
  card.querySelector(".sentiment-breadth").innerHTML = sentiment.market ? breadthMarkup(sentiment.market) : "";
  card.querySelector(".sentiment-facts").innerHTML = sentiment.market ? factsMarkup(sentiment.market) : "";
  card.querySelector(".sentiment-unusual").innerHTML = unusualMarkup(sentiment.market ?? undefined);
}
