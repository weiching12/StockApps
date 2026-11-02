/** All prices use TWD and all volumes use shares. Input must be oldest first. */
export const DEFAULT_SETTINGS = Object.freeze({
  period: 9,
  kSmooth: 3,
  dSmooth: 3,
});

export function analyzeHistory(history, settings = DEFAULT_SETTINGS) {
  const { period, kSmooth, dSmooth } = settings;
  if (![period, kSmooth, dSmooth].every((n) => Number.isInteger(n) && n > 0)) {
    throw new RangeError("指標週期必須是正整數");
  }
  let k = 50;
  let d = 50;
  return history.map((bar, index) => {
    const ma = (days) =>
      index + 1 < days
        ? null
        : history
            .slice(index + 1 - days, index + 1)
            .reduce((sum, row) => sum + row.close, 0) / days;
    let rsv = null;
    let currentK = null;
    let currentD = null;
    if (index + 1 >= period) {
      const window = history.slice(index + 1 - period, index + 1);
      const high = Math.max(...window.map((row) => row.high));
      const low = Math.min(...window.map((row) => row.low));
      // A flat window has no relative price position; use a neutral RSV of 50.
      rsv = high === low ? 50 : ((bar.close - low) / (high - low)) * 100;
      k = (k * (kSmooth - 1)) / kSmooth + rsv / kSmooth;
      d = (d * (dSmooth - 1)) / dSmooth + k / dSmooth;
      currentK = k;
      currentD = d;
    }
    const previousClose = history[index - 1]?.close ?? null;
    const ma60 = ma(60);
    return {
      ...bar,
      ma5: ma(5),
      ma20: ma(20),
      ma60,
      rsv,
      k: currentK,
      d: currentD,
      change: previousClose === null ? null : bar.close - previousClose,
      changePercent:
        previousClose === null || previousClose === 0
          ? null
          : (bar.close / previousClose - 1) * 100,
      deviation:
        ma60 === null || ma60 === 0 ? null : (bar.close / ma60 - 1) * 100,
      institutionalNet: getInstitutionalNet(bar.institutions),
    };
  });
}
export function getInstitutionNet(institutions, name) {
  const rows = Array.isArray(institutions)
    ? institutions.filter((item) => item?.name === name) : [];
  const item = rows[0];
  return rows.length === 1 && [item.buy, item.sell].every((n) => Number.isFinite(n) && n >= 0)
    ? item.buy - item.sell : null;
}

export function getInstitutionalNet(institutions) {
  const values = ["外資", "投信", "自營商"].map((name) => getInstitutionNet(institutions, name));
  return values.every(Number.isFinite) ? values.reduce((sum, n) => sum + n, 0) : null;
}

const PRICE_VOLUME_LABELS = Object.freeze({
  "price-up-volume-up": "價漲量增",
  "price-up-volume-flat": "價漲量平",
  "price-up-volume-down": "價漲量縮",
  "price-down-volume-up": "價跌量增",
  "price-down-volume-flat": "價跌量平",
  "price-down-volume-down": "價跌量縮",
  "volume-up-price-stagnant": "量增價滯",
  "price-volume-flat": "量價持平",
  "volume-down-range": "量縮盤整",
});

/** Classify already-computed RVOL20 and close-to-close percentage change. */
export function classifyPriceVolume(rvol20, changePercent) {
  if (!Number.isFinite(rvol20) || rvol20 < 0 || !Number.isFinite(changePercent))
    return { code: "insufficient", label: "資料不足" };
  const volume = rvol20 >= 1.2 ? "up" : rvol20 >= 0.8 ? "flat" : "down";
  const price = changePercent > 0.5 ? "up" : changePercent < -0.5 ? "down" : "range";
  const code = price === "range"
    ? { up: "volume-up-price-stagnant", flat: "price-volume-flat", down: "volume-down-range" }[volume]
    : `price-${price}-volume-${volume}`;
  return { code, label: PRICE_VOLUME_LABELS[code] };
}

/** Today's volume against the preceding 20 market sessions, in shares. */
export function getPriceVolumeSignal(history, tradingDates, asOf, changePercent) {
  const index = tradingDates?.indexOf(asOf) ?? -1;
  const insufficient = () => ({ rvol20: null, ...classifyPriceVolume(null, changePercent) });
  if (index < 20 || !Number.isFinite(changePercent)) return insufficient();
  const bars = new Map(history.map((bar) => [bar.date, bar]));
  if (!Number.isFinite(bars.get(asOf)?.close) || bars.get(asOf).close <= 0) return insufficient();
  const volumes = tradingDates.slice(index - 20, index + 1).map((date) => bars.get(date)?.volume);
  if (volumes.length !== 21 || !volumes.every((volume) => Number.isFinite(volume) && volume >= 0))
    return insufficient();
  const average = volumes.slice(0, 20).reduce((sum, volume) => sum + volume, 0) / 20;
  if (average === 0) return insufficient();
  const rvol20 = volumes[20] / average;
  return { rvol20, ...classifyPriceVolume(rvol20, changePercent) };
}

/** Classify the selected session using existing MA20/MA60 values only. */
export function getTrendStatus(history, tradingDates, asOf) {
  const unknown = { code: "insufficient", label: "資料不足", reason: "歷史行情不足" };
  const index = tradingDates?.indexOf(asOf) ?? -1;
  if (index < 60) return unknown;
  const bars = new Map(history.map((bar) => [bar.date, bar]));
  const window = tradingDates.slice(index - 60, index + 1).map((date) => bars.get(date));
  if (window.length !== 61 || window.some((bar) => !Number.isFinite(bar?.close) || bar.close <= 0))
    return unknown;
  const current = window[60], previous = window[59];
  if (![current.ma20, current.ma60, previous.ma20, previous.ma60].every(Number.isFinite))
    return unknown;
  if (current.close > current.ma20 && current.ma20 > current.ma60 &&
      current.ma20 > previous.ma20 && current.ma60 > previous.ma60)
    return { code: "bullish", label: "偏多", reason: "月線、季線向上" };
  if (current.close < current.ma20 && current.ma20 < current.ma60 &&
      current.ma20 < previous.ma20 && current.ma60 < previous.ma60)
    return { code: "bearish", label: "偏空", reason: "月線、季線向下" };
  return { code: "unclear", label: "方向未明", reason: "趨勢條件不一致" };
}

export function getDominantInstitution(institutions) {
  const total = getInstitutionalNet(institutions);
  if (total === null || total === 0) return null;
  const values = ["外資", "投信", "自營商"].map((name) => {
    const item = institutions.find((row) => row.name === name);
    return { name, net: item.buy - item.sell };
  });
  const extreme = total > 0
    ? Math.max(...values.map((item) => item.net))
    : Math.min(...values.map((item) => item.net));
  return { names: values.filter((item) => item.net === extreme).map((item) => item.name),
    direction: total > 0 ? "buy" : "sell" };
}

/** Pick the strongest same-direction stock for an aggregate sector flow. */
export function getDirectionalLeader(candidates, total) {
  if (!Number.isFinite(total)) return { stock: null, value: null };
  let leader = null;
  const direction = total < 0 ? 1 : -1;
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate?.value)) continue;
    if (!leader || (candidate.value - leader.value) * direction < 0)
      leader = candidate;
  }
  return leader ?? { stock: null, value: null };
}

export function getSnapshot(stock, asOf, settings) {
  const history = analyzeHistory(
    stock.history.filter((bar) => bar.date <= asOf),
    settings,
  );
  const current = history.at(-1)?.date === asOf;
  const sessionIndex = stock.tradingDates?.indexOf(asOf) ?? -1;
  const consecutive = !stock.tradingDates || (sessionIndex > 0 &&
    history.at(-2)?.date === stock.tradingDates[sessionIndex - 1]);
  // Never rank a suspended/unpriced company using its last traded day's price.
  const byDate = new Map(history.map((bar) => [bar.date, bar]));
  const institutionHistory = stock.tradingDates
    ? stock.tradingDates.filter((date) => date <= asOf).map((date) => byDate.get(date) ?? { institutions: [] })
    : history;
  return {
    ...stock,
    history,
    latest: current ? history.at(-1) : null,
    priceVolume: getPriceVolumeSignal(history, stock.tradingDates, asOf,
      current ? history.at(-1).changePercent : null),
    trend: getTrendStatus(history, stock.tradingDates, asOf),
    signal: getTechnicalSignal(current && consecutive ? history : []),
    institutionalSummary: getInstitutionalSummary(institutionHistory),
  };
}

export function getStockInstitutionValue(stock, name, window) {
  if (window === "day") return name === "total"
    ? stock.latest?.institutionalNet ?? null
    : getInstitutionNet(stock.latest?.institutions, name);
  const summary = stock.institutionalSummary;
  return (name === "total" ? summary?.total : summary?.institutions?.[name])?.[`net${window}`] ?? null;
}

/** Use one complete-stock cohort for the total and all three institutions.
 * Missing sessions stay unknown; a stock contributes only its full window.
 */
export function getSectorInstitutionSummary(stocks, window, tradingDates) {
  const names = ["total", "外資", "投信", "自營商"];
  const rows = stocks
    .filter((stock) => !tradingDates || Number.isFinite(getStockInstitutionEstimate(stock, "total", window, tradingDates)))
    .map((stock) => names.map((name) => getStockInstitutionValue(stock, name, window)))
    .filter((values) => values.every(Number.isFinite));
  return { available: rows.length, expected: stocks.length,
    ...Object.fromEntries(names.map((name, index) => [name,
      rows.length ? rows.reduce((sum, values) => sum + values[index], 0) : null])),
  };
}

function institutionMoney(bar, name = "total") {
  if (!Number.isFinite(bar?.close) || bar.close <= 0) return null;
  const net = name === "total" ? getInstitutionalNet(bar.institutions) : getInstitutionNet(bar.institutions, name);
  const amount = net === null ? null : net * bar.close;
  return Number.isFinite(amount) ? amount : null;
}

/** Signed net shares / traded shares. Zero volume is unknown, not zero percent. */
export function getInstitutionVolumeRatio(bar) {
  const net = getInstitutionalNet(bar?.institutions);
  return net !== null && Number.isFinite(bar?.volume) && bar.volume > 0
    ? net / bar.volume * 100 : null;
}

/** Keep exact market sessions, including unknown slots and genuine zero values. */
export function getStockInstitutionSeries(stock, tradingDates) {
  const history = new Map((stock.history ?? []).map((bar) => [bar.date, bar]));
  return tradingDates.slice(-5).map((date) => ({ date, amount: institutionMoney(history.get(date)) }));
}

/** Closing-price estimate in TWD, using complete stock windows only. */
export function getStockInstitutionEstimate(stock, name, window, tradingDates) {
  const days = window === "day" ? 1 : Number(window);
  const dates = tradingDates.slice(-days);
  if (![1, 5, 20].includes(days) || dates.length !== days) return null;
  const history = new Map((stock.history ?? []).map((bar) => [bar.date, bar]));
  const daily = dates.map((date) => institutionMoney(history.get(date), name));
  return daily.every(Number.isFinite) ? daily.reduce((sum, value) => sum + value, 0) : null;
}

/** Gross institutional trading (all three institutions' buys + sells) at each session's close, in TWD.
 * Complete windows only: a missing price or institution row makes the stock's window unknown.
 */
export function getStockInstitutionActivity(stock, window, tradingDates) {
  const days = window === "day" ? 1 : Number(window);
  const dates = tradingDates.slice(-days);
  if (![1, 5, 20].includes(days) || dates.length !== days) return null;
  const history = new Map((stock.history ?? []).map((bar) => [bar.date, bar]));
  let total = 0;
  for (const date of dates) {
    const bar = history.get(date);
    if (!Number.isFinite(bar?.close) || bar.close <= 0) return null;
    for (const name of ["外資", "投信", "自營商"]) {
      const rows = Array.isArray(bar.institutions) ? bar.institutions.filter((item) => item?.name === name) : [];
      if (rows.length !== 1 || ![rows[0].buy, rows[0].sell].every((n) => Number.isFinite(n) && n >= 0)) return null;
      total += (rows[0].buy + rows[0].sell) * bar.close;
    }
  }
  return total;
}

export function getSectorInstitutionEstimate(stocks, window, tradingDates, name = "total") {
  const values = stocks.map((stock) => ({ stock,
    total: getStockInstitutionEstimate(stock, "total", window, tradingDates) }))
    .filter(({ total }) => Number.isFinite(total))
    .map(({ stock, total }) => name === "total" ? total : getStockInstitutionEstimate(stock, name, window, tradingDates))
    .filter(Number.isFinite);
  return { available: values.length, expected: stocks.length, buying: values.filter((value) => value > 0).length,
    amount: values.length ? values.reduce((sum, value) => sum + value, 0) : null };
}

/** Totals stay in shares; rolling windows include the selected session. */
export function getInstitutionalSummary(history) {
  const names = ["外資", "投信", "自營商"];
  const series = Object.fromEntries(names.map((name) => [name, []]));
  const totals = [];
  for (const bar of history) {
    const daily = names.map((name) => {
      const net = getInstitutionNet(bar.institutions, name);
      series[name].push(net);
      return net;
    });
    totals.push(daily.every(Number.isFinite)
      ? daily.reduce((sum, value) => sum + value, 0) : null);
  }

  const summarize = (values) => {
    const rolling = (days) => {
      const window = values.slice(-days);
      return window.length === days && window.every(Number.isFinite)
        ? window.reduce((sum, value) => sum + value, 0) : null;
    };
    const latest = values.at(-1);
    let streak = { direction: "unknown", days: null, atLeast: false };
    if (Number.isFinite(latest)) {
      if (latest === 0) streak = { direction: "neutral", days: 0, atLeast: false };
      else {
        const sign = Math.sign(latest);
        let days = 0;
        while (days < values.length && Number.isFinite(values[values.length - 1 - days]) &&
          Math.sign(values[values.length - 1 - days]) === sign) days++;
        streak = {
          direction: sign > 0 ? "buy" : "sell",
          days,
          // The series start or a missing session may hide an earlier streak.
          atLeast: days === values.length || !Number.isFinite(values[values.length - 1 - days]),
        };
      }
    }
    return { net5: rolling(5), net20: rolling(20), streak };
  };
  const total = summarize(totals);
  return {
    total: { net5: total.net5, net20: total.net20 },
    institutions: Object.fromEntries(names.map((name) => [name, summarize(series[name])])),
  };
}

/** Evaluate only the last two completed sessions in the selected snapshot. */
export function getTechnicalSignal(history) {
  const current = history.at(-1);
  const previous = history.at(-2);
  const signal = (code, tone, label, reason) => ({ code, tone, label, reason });
  const validKd = (row) =>
    row && [row.k, row.d].every((n) => Number.isFinite(n) && n >= 0 && n <= 100);
  if (!validKd(current) || !validKd(previous))
    return signal("insufficient", "neutral", "資料不足", "需連續兩個交易日的有效 K、D 值");

  const crossesUp =
    previous.k <= previous.d && current.k > current.d && current.k > previous.k;
  const crossesDown =
    previous.k >= previous.d && current.k < current.d && current.k < previous.k;
  const lowZone = (row) => row.k < 20 && row.d < 20;
  const highZone = (row) => row.k > 80 && row.d > 80;
  const trendConfirmed =
    Number.isFinite(current.close) &&
    current.close > 0 &&
    Number.isFinite(current.ma20) &&
    current.ma20 > 0 &&
    Number.isFinite(previous.ma20) &&
    previous.ma20 > 0 &&
    current.close >= current.ma20 &&
    current.ma20 >= previous.ma20;

  if (crossesUp && (lowZone(previous) || lowZone(current)))
    return trendConfirmed
      ? signal("buy-watch", "positive", "留意買點", "低檔黃金交叉；收盤站上走平或上彎 MA20")
      : signal("rebound-watch", "caution", "反彈觀察", "低檔黃金交叉；MA20 趨勢尚未確認");
  if (crossesDown && (highZone(previous) || highZone(current)))
    return signal("sell-watch", "negative", "留意賣點", "高檔死亡交叉；留意動能轉弱");
  if (crossesDown)
    return signal("weakening", "negative", "動能轉弱", "K 下穿 D；等待止跌與趨勢確認");
  if (crossesUp)
    return signal("strengthening", "positive", "動能轉強", "K 上穿 D；尚非低檔買點條件");
  if (current.k < 20)
    return signal("oversold-watch", "caution", "低檔觀察", "K 低於 20；當日未出現低檔黃金交叉");
  if (current.k > 80)
    return signal("overbought-watch", "caution", "高檔觀察", "K 高於 80；高檔可能持續鈍化");
  if (current.k > current.d && trendConfirmed)
    return signal("bullish-watch", "positive", "偏多觀察", "K 高於 D；收盤站上走平或上彎 MA20");
  if (current.k < current.d)
    return signal("bearish-watch", "negative", "偏弱觀察", "K 低於 D；暫待動能改善");
  return signal("neutral", "neutral", "中性觀望", "KD 與趨勢尚未形成明確條件");
}

export function filterStocks(
  stocks,
  { query = "", sector = "all", view = "all", favorites = [] } = {},
) {
  const text = query.trim().toLocaleLowerCase();
  return stocks.filter((stock) => {
    if (!stock.latest) return false;
    if (
      text &&
      !`${stock.symbol} ${stock.name}`.toLocaleLowerCase().includes(text)
    )
      return false;
    if (sector !== "all" && stock.sector !== sector) return false;
    if (view === "favorites" && !favorites.includes(stock.symbol)) return false;
    if (view === "above" && !(stock.latest.deviation > 0)) return false;
    if (view === "below" && !(stock.latest.deviation < 0)) return false;
    if (
      view === "oversold" &&
      !(stock.latest.k !== null && stock.latest.k < 20)
    )
      return false;
    return true;
  });
}
