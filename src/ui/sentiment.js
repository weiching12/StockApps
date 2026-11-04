const labels = { breadth: "市場漲跌家數", trend: "站上季線", momentum: "20 日動能", institutions: "法人方向", volume: "成交量熱度" };
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
  <div class="sentiment-readout"><strong class="sentiment-score">—</strong><span class="sentiment-band">資料更新中</span></div>`;

const count = (number) => Number.isFinite(number) ? number.toLocaleString("zh-TW") : "—";
const decimals = (number, digits) => number.toLocaleString("zh-TW", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const toneOf = (number) => number > 0 ? "up" : number < 0 ? "down" : "";
const escapeText = (text) => String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** Net amount in 億, signed and to two decimals like the rest of the institutional figures. */
export const netAmountText = (amount) => !Number.isFinite(amount) ? "—"
  : `${amount > 0 ? "+" : amount < 0 ? "-" : ""}${decimals(Math.abs(amount) / 1e8, 2)} 億`;

/** A sector's amount in a narrow cell: whole 億 once it reaches 100. */
export const flowAmountText = (amount) => Math.abs(amount) < 1e10 ? netAmountText(amount)
  : `${amount > 0 ? "+" : "-"}${decimals(Math.abs(amount) / 1e8, 0)} 億`;

/** Signed run of sessions on one side: +3 reads 連買 3 日, -2 reads 連賣 2 日. */
export const streakText = (streak) => !Number.isFinite(streak) ? "—"
  : streak === 0 ? "買賣持平" : `${streak > 0 ? "連買" : "連賣"} ${Math.abs(streak)} 日`;

function breadthMarkup({ advancing, unchanged, declining }) {
  const known = Number.isFinite(advancing);
  const part = (tone, number) => `<i class="${tone}" style="flex-grow:${known ? number : 0}"></i>`;
  return `<span class="up" title="上漲 ${count(advancing)} 檔">漲 <b>${count(advancing)}</b></span><div class="sentiment-breadth-bar" title="上漲 ${count(advancing)}、平盤 ${count(unchanged)}、下跌 ${count(declining)} 檔">${part("up", advancing)}${part("flat", unchanged)}${part("down", declining)}</div><span class="down" title="下跌 ${count(declining)} 檔">跌 <b>${count(declining)}</b></span>`;
}

function factsMarkup(market) {
  const { institutionalNet: net, institutionalStreak: streak, inflow, outflow } = market;
  const flow = (key, label, top) => `<div class="sentiment-fact" data-fact="${key}"><span>${label}</span><strong title="${escapeText(top?.sector ?? "")}">${escapeText(top?.sector ?? "—")}</strong><b class="${toneOf(top?.amount)}">${top ? flowAmountText(top.amount) : ""}</b></div>`;
  return `<div class="sentiment-fact" data-fact="institutions"><span>法人淨買賣</span><strong class="${toneOf(net)}">${netAmountText(net)}</strong><b class="${toneOf(streak)}">${streakText(streak)}</b></div>${flow("inflow", "法人流入", inflow)}${flow("outflow", "法人流出", outflow)}`;
}

export function renderSentiment(sentiment) {
  const card = document.querySelector("#market-sentiment"); if (!card) return;
  card.dataset.sentiment = sentiment.band.key;
  card.querySelector("button").style.setProperty("--sentiment-tone", sentimentTone(sentiment.score));
  card.querySelector(".sentiment-score").textContent = value(sentiment.score);
  card.querySelector(".sentiment-band").textContent = sentiment.band.label;
  card.style.setProperty("--sentiment-score", `${sentiment.score ?? 0}%`);
  card.style.setProperty("--sentiment-needle", `${((sentiment.score ?? 50) - 50) * 1.8}deg`);
  card.querySelector(".sentiment-date").textContent = sentiment.status === "insufficient"
    ? sentiment.score === null ? "資料不足 · 等待有效市場資料" : `資料不足 · 沿用 ${sentiment.date} 分數`
    : `${sentiment.components.coverage} 檔上市個股`;
  // A cached response from before these figures existed simply shows the score alone.
  card.querySelector(".sentiment-breadth").innerHTML = sentiment.market ? breadthMarkup(sentiment.market) : "";
  card.querySelector(".sentiment-facts").innerHTML = sentiment.market ? factsMarkup(sentiment.market) : "";
}
export function sentimentDialogMarkup(sentiment) {
  const segments = [];
  let segment = [];
  sentiment.series.forEach(({ score }, index) => {
    if (Number.isFinite(score)) segment.push(`${index / Math.max(sentiment.series.length - 1, 1) * 100},${100 - score}`);
    else { if (segment.length > 1) segments.push(segment.join(" ")); segment = []; }
  });
  if (segment.length > 1) segments.push(segment.join(" "));
  const descriptions = { breadth: "上漲計 1、平盤計 0.5", trend: "高於 MA60 計 1、相等計 0.5", momentum: "可比較價格的 20 日報酬方向", institutions: "近 5 日法人淨股數占成交量比率", volume: "放量個股的漲跌方向" };
  return `<h2 id="dialog-heading">台股市場情緒</h2><p class="dialog-intro">以最新交易日的當日資料計算，切換清單的歷史日期不會改變此指數。分數以 0–100 呈現市場的恐懼與貪婪程度；這是株研建立的觀察指標，不是交易所官方指數。</p><div class="sentiment-dialog-summary" data-sentiment="${sentiment.band.key}"><strong>${value(sentiment.score)}</strong><span>${sentiment.band.label}</span></div>${sentiment.status === "insufficient" ? `<p class="dialog-intro">資料不足；${sentiment.score === null ? "尚無有效分數" : `沿用 ${sentiment.date} 的最後有效分數`}。最新資料有效權重 ${Math.round(sentiment.latestEffectiveWeight * 100)}%。</p>` : ""}<div class="sentiment-trend" role="img" aria-label="近 ${sentiment.series.length} 個交易日每日市場情緒分數">${segments.length ? `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="50" x2="100" y2="50"/>${segments.map((points) => `<polyline points="${points}"/>`).join("")}</svg>` : "資料累積中"}</div><p class="sentiment-trend-note">折線每個點是該交易日的分數，由下列五項當日指標加權產生；圖表顯示最近 ${sentiment.series.length} 個交易日。</p><dl class="sentiment-components">${Object.entries(labels).map(([key, label]) => `<div><dt>${label}<span>${descriptions[key]}${sentiment.notes?.[key] ? ` · ${sentiment.notes[key]}` : ""}</span></dt><dd>${value(sentiment.components[key])}</dd></div>`).join("")}</dl><p class="helper-text">每個交易日各自計分。權重：漲跌家數 25%、季線位置 20%、20 日動能 20%、法人方向 25%、成交量熱度 10%。僅計上市普通股；各項至少 80% 樣本覆蓋，總有效權重至少 80%。20 日動能使用已查核公司行動的可比較價格；個股資料不完整或事件無法可靠調整時不計入樣本。其餘有效項目按權重換算。每日只使用當日及以前資料。卡片上的法人淨買賣與流入、流出僅計上市普通股，逐檔以當日收盤價換算，屬估算值；流入、流出只代表三大法人，不是全市場資金。版本：${sentiment.version}</p>`;
}
