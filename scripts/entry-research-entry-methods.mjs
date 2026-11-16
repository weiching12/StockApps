// Usage: node scripts/entry-research-entry-methods.mjs [signals.json] > report-tables.md
// Reads the dump from scripts/entry-research-signal-dump.mjs and prints three comparisons as Markdown:
// backtests with and without the next-day price plan, why the plan skips v4 signals, and wider max-risk caps.
import { readFileSync } from "node:fs";
const input = process.argv[2] ?? ".backfill/signals-v3.json";
{
// Compare backtests of the same v3 gate-pass signals with and without the next-day price plan.
const rows = JSON.parse(readFileSync(input, "utf8"));
const COST = { buy: 0.1425 + 0.1, sell: 0.1425 + 0.3 + 0.1 };
const net = (buy, sell) => ((sell * (1 - COST.sell / 100)) / (buy * (1 + COST.buy / 100)) - 1) * 100;
const gross = (buy, sell) => (sell / buy - 1) * 100;
const valid = (b) => b && [b.open, b.high, b.low, b.close].every((v) => v > 0);

// method: A (signal close → exit close, no stop), B1 (next open always, no stop),
// B2 (next open always, close below invalidation → next open), C (live plan: open within range, same stop).
function trade(row, method, hold) {
  const bars = row.after.slice(0, hold + 1);
  if (bars.length < hold + 1 || bars.some((b) => !valid(b) || b.action)) return null;
  const next = bars[0], market = gross(row.market[0], row.market[hold + 1]);
  const year = row.asOf < "2026-01-01" ? "2025" : "2026";
  if (method === "A") {
    const g = gross(row.close, bars[hold].close);
    return { year, net: net(row.close, bars[hold].close), gross: g, market, stopped: false };
  }
  // A session locked at limit-up (never trades below ~+9.5%) cannot be bought.
  if (next.low >= row.close * 1.095) return { year, skipped: "limitUp" };
  if (method === "C" && !(row.planStatus === "NEXT_DAY_CANDIDATE" && next.open <= row.upper && next.open > row.stop))
    return { year, skipped: "plan" };
  const fill = next.open, held = bars.slice(1);
  let exit = held.at(-1).close, stopped = false;
  if (method !== "B1") {
    const at = held.findIndex((b) => b.close < row.stop);
    if (at >= 0 && at < held.length - 1) { exit = held[at + 1].open; stopped = true; }
  }
  return { year, net: net(fill, exit), gross: gross(fill, exit), market, stopped };
}

const pct = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
function stats(list) {
  const done = list.filter((t) => t && !t.skipped);
  if (!done.length) return null;
  const mean = (key) => done.reduce((s, t) => s + t[key], 0) / done.length;
  const wins = done.filter((t) => t.net > 0), losses = done.filter((t) => t.net <= 0);
  const avgWin = wins.reduce((s, t) => s + t.net, 0) / (wins.length || 1), avgLoss = losses.reduce((s, t) => s + t.net, 0) / (losses.length || 1);
  return { n: done.length, net: mean("net"), gross: mean("gross"), win: wins.length / done.length * 100,
    excess: done.reduce((s, t) => s + t.net - t.market, 0) / done.length, avgWin, avgLoss,
    stopped: done.filter((t) => t.stopped).length / done.length * 100, skipped: list.filter((t) => t?.skipped).length };
}
const METHODS = [["A", "A. 訊號日收盤買（做不到）"], ["B1", "B1. 隔日開盤直接買、不停損"], ["B2", "B2. 隔日開盤直接買、跌破失效價停損"], ["C", "C. 現行計畫（開盤在範圍內才買）"]];
const SETS = [["v3（流動性 1,000 萬）", () => true], ["v4（流動性 3 億）", (r) => r.avgValue20 >= 3e8]];

console.log(`訊號：${rows.length} 筆（v3 門檻通過且觸發訊號；含收盤已高於上限或風險超過 8% 而未列入候選者 ${rows.filter((r) => r.planStatus !== "NEXT_DAY_CANDIDATE").length} 筆）\n`);
for (const hold of [10, 20]) {
  for (const [setLabel, filter] of SETS) {
    const set = rows.filter(filter);
    console.log(`### ${setLabel}，持有 ${hold} 日（扣成本）\n`);
    console.log("| 方式 | 筆數 | 平均淨報酬 | 勝率 | 平均賺／賠 | 超額 | 停損出場 | 2025 | 2026 |");
    console.log("|---|---|---|---|---|---|---|---|---|");
    for (const [key, label] of METHODS) {
      const list = set.map((r) => trade(r, key, hold)), s = stats(list);
      const y = (year) => { const t = stats(list.filter((x) => x?.year === year)); return t ? `${pct(t.net)}／勝 ${t.win.toFixed(0)}%` : "—"; };
      console.log(`| ${label} | ${s.n} | ${pct(s.net)} | ${s.win.toFixed(0)}% | ${pct(s.avgWin)}／${pct(s.avgLoss)} | ${pct(s.excess)} | ${key === "A" || key === "B1" ? "—" : `${s.stopped.toFixed(0)}%`} | ${y("2025")} | ${y("2026")} |`);
    }
    console.log("");
  }
}
}
{
const rows = JSON.parse(readFileSync(input, "utf8")).filter((r) => r.avgValue20 >= 3e8);
const net = (b, s) => ((s * (1 - 0.5425 / 100)) / (b * (1 + 0.2425 / 100)) - 1) * 100;
const valid = (b) => b && [b.open, b.high, b.low, b.close].every((v) => v > 0);
const groups = {};
for (const r of rows) {
  const bars = r.after.slice(0, 21);
  if (bars.length < 21 || bars.some((b) => !valid(b) || b.action) || bars[0].low >= r.close * 1.095) continue;
  const o = bars[0].open;
  const key = r.planStatus !== "NEXT_DAY_CANDIDATE" ? (r.close > r.upper ? "收盤已高於上限" : "風險超過 8%")
    : o > r.upper ? "候選：開盤高於上限" : o <= r.stop ? "候選：開盤低於失效價" : "候選：開盤在範圍內（C）";
  const t = net(o, bars[20].close), y = r.asOf < "2026" ? 0 : 1;
  (groups[key] ??= [[], []])[y].push(t);
}
const f = (l) => l.length ? `${pct(l.reduce((a, b) => a + b, 0) / l.length)}／勝 ${(l.filter((x) => x > 0).length / l.length * 100).toFixed(0)}%／n ${l.length}` : "—";
const pct = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
console.log("\n## 2. 現行計畫為什麼不買：v4、隔日開盤直接買、不停損、持有 20 日\n");
console.log("| 分組 | 全期 | 2025 | 2026 |");
console.log("|---|---|---|---|");
for (const [k, [a, b]] of Object.entries(groups)) console.log(`| ${k} | ${f([...a, ...b])} | ${f(a)} | ${f(b)} |`);
}
{
// Relax or remove the plan's 8% max-risk cap on the same v3 gate-pass signals; the rest of the live
// plan (close and next open at or below the upper bound, open above invalidation, close-below-stop exit) stays.
const rows = JSON.parse(readFileSync(input, "utf8"));
const net = (b, s) => ((s * (1 - 0.5425 / 100)) / (b * (1 + 0.2425 / 100)) - 1) * 100;
const valid = (b) => b && [b.open, b.high, b.low, b.close].every((v) => v > 0);
const maxRisk = (r) => (r.upper - r.stop) / r.upper * 100;
const quarter = (d) => `${d.slice(0, 4)} Q${Math.ceil(Number(d.slice(5, 7)) / 3)}`;

function trade(r, cap, hold, stop = true) {
  if (!(r.close <= r.upper) || (cap !== null && maxRisk(r) > cap)) return null;
  const bars = r.after.slice(0, hold + 1);
  if (bars.length < hold + 1 || bars.some((b) => !valid(b) || b.action)) return null;
  const o = bars[0].open;
  if (!(o <= r.upper && o > r.stop) || bars[0].low >= r.close * 1.095) return null;
  const held = bars.slice(1);
  let exit = held.at(-1).close, stopped = false;
  const at = stop ? held.findIndex((b) => b.close < r.stop) : -1;
  if (at >= 0 && at < held.length - 1) { exit = held[at + 1].open; stopped = true; }
  const ret = net(o, exit);
  // R: the result in units of the risk taken from the fill to invalidation.
  return { asOf: r.asOf, ret, r: ret / ((o - r.stop) / o * 100), risk: (o - r.stop) / o * 100, stopped,
    excess: ret - (r.market[hold + 1] / r.market[0] - 1) * 100 };
}
const pct = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
function summary(list) {
  if (!list.length) return null;
  const m = (k) => list.reduce((s, t) => s + t[k], 0) / list.length;
  const losses = list.filter((t) => t.ret <= 0);
  // Signal-day cohorts: one mean per day, so same-day trades count once for the t statistic.
  const byDay = new Map();
  for (const t of list) (byDay.get(t.asOf) ?? byDay.set(t.asOf, []).get(t.asOf)).push(t.ret);
  const days = [...byDay.values()].map((v) => v.reduce((a, b) => a + b, 0) / v.length);
  const dm = days.reduce((a, b) => a + b, 0) / days.length;
  const sd = Math.sqrt(days.reduce((s, v) => s + (v - dm) ** 2, 0) / (days.length - 1));
  return { n: list.length, ret: m("ret"), win: list.filter((t) => t.ret > 0).length / list.length * 100,
    loss: losses.reduce((s, t) => s + t.ret, 0) / (losses.length || 1), worst: Math.min(...list.map((t) => t.ret)),
    r: m("r"), risk: m("risk"), excess: m("excess"), stopped: list.filter((t) => t.stopped).length / list.length * 100,
    days: days.length, perDay: list.length / 415, t: dm / (sd / Math.sqrt(days.length)) };
}
console.log("\n## 3. 放寬風險上限：其餘照現行計畫（開盤在範圍內才買、跌破失效價停損）");
const CAPS = [8, 10, 12, 15, 20, null];
const label = (cap) => cap === null ? "不設上限" : `${cap}%${cap === 8 ? "（現行）" : ""}`;
for (const [setLabel, minValue] of [["v4（流動性 3 億）", 3e8], ["v3（流動性 1,000 萬）", 0]]) {
  const set = rows.filter((r) => r.avgValue20 >= minValue);
  for (const hold of [20, 10]) {
    console.log(`\n### ${setLabel}，持有 ${hold} 日（扣成本，跌破失效價停損）\n`);
    console.log("| 風險上限 | 每日筆數 | 平均淨報酬 | 勝率 | 平均虧損 | 最差一筆 | 平均風險 | 每單位風險（R） | 超額 | 停損出場 | 日均 t | 2025 | 2026 |");
    console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const cap of CAPS) {
      const list = set.map((r) => trade(r, cap, hold)).filter(Boolean), s = summary(list);
      const y = (p) => { const t = summary(list.filter((x) => x.asOf.startsWith(p))); return t ? `${pct(t.ret)}／勝 ${t.win.toFixed(0)}%` : "—"; };
      console.log(`| ${label(cap)} | ${s.perDay.toFixed(1)} | ${pct(s.ret)} | ${s.win.toFixed(0)}% | ${pct(s.loss)} | ${pct(s.worst)} | ${s.risk.toFixed(1)}% | ${s.r >= 0 ? "+" : ""}${s.r.toFixed(2)} | ${pct(s.excess)} | ${s.stopped.toFixed(0)}% | ${s.t.toFixed(1)} | ${y("2025")} | ${y("2026")} |`);
    }
  }
}
// Only the signals each wider cap adds, by quarter, for v4 at 20 days.
const set = rows.filter((r) => r.avgValue20 >= 3e8);
console.log("\n### v4 持有 20 日：只看 8% 上限擋掉的訊號（風險 > 8%）與現行 8% 以內，依季度\n");
console.log("| 季度 | 現行 8% 以內 | 風險 8～12% | 風險 12% 以上 |");
console.log("|---|---|---|---|");
const all = set.map((r) => ({ r, t: trade(r, null, 20) })).filter((x) => x.t);
const band = (lo, hi) => all.filter(({ r }) => maxRisk(r) > lo && maxRisk(r) <= hi).map((x) => x.t);
const groups = [band(-1, 8), band(8, 12), band(12, Infinity)];
for (const q of [...new Set(all.map((x) => quarter(x.t.asOf)))].sort()) {
  const cell = (list) => { const s = summary(list.filter((t) => quarter(t.asOf) === q)); return s ? `${pct(s.ret)}／勝 ${s.win.toFixed(0)}%／n ${s.n}` : "—"; };
  console.log(`| ${q} | ${groups.map(cell).join(" | ")} |`);
}
}
