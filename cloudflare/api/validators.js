import { DEFAULT_SETTINGS } from "../../shared/indicators.js";
import { DomainError } from "../../shared/domain-error.js";
import { validSymbol } from "../../shared/market-codec.js";
import { ENTRY_RESEARCH_MODEL_VERSION } from "../../shared/entry-research-model.js";

const integer = (value, fallback, max) => {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max)
    throw new DomainError("INVALID_QUERY", "分頁參數格式或範圍不正確");
  return Number(value);
};

export function stockCollectionOptions(params) {
  const type = params.get("type");
  if (type && !["stock", "etf"].includes(type)) throw new DomainError("INVALID_QUERY", "type 必須是 stock 或 etf");
  const limit = integer(params.get("limit"), 100, 200);
  if (!limit) throw new DomainError("INVALID_QUERY", "limit 必須大於 0");
  return { offset: integer(params.get("offset"), 0, Number.MAX_SAFE_INTEGER), limit, type,
    sector: params.get("sector"), query: params.get("q") };
}

const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
const oneOf = (params, name, allowed) => {
  const value = params.get(name);
  if (value === null) return undefined;
  if (!allowed.includes(value)) throw new DomainError("INVALID_QUERY", `${name} 必須是 ${allowed.join("、")} 之一`);
  return value;
};
const score = (params, name) => {
  const value = params.get(name);
  if (value === null) return undefined;
  if (!/^\d+(\.\d+)?$/.test(value) || Number(value) > 100) throw new DomainError("INVALID_QUERY", `${name} 必須介於 0 到 100`);
  return Number(value);
};

export function researchSampleOptions(params) {
  const from = params.get("from") ?? undefined, to = params.get("to") ?? undefined;
  for (const date of [from, to]) if (date !== undefined && !validDate(date)) throw new DomainError("INVALID_QUERY", "日期格式不正確");
  if (from && to && from > to) throw new DomainError("INVALID_QUERY", "起始日期不可晚於結束日期");
  const symbol = params.get("symbol") ?? undefined;
  if (symbol !== undefined && !validSymbol(symbol)) throw new DomainError("INVALID_QUERY", "股票代號無效");
  const modelVersion = params.get("model") ?? ENTRY_RESEARCH_MODEL_VERSION;
  if (!/^[a-z0-9.-]{1,40}$/.test(modelVersion)) throw new DomainError("INVALID_QUERY", "模型版本格式不正確");
  const minScore = score(params, "minScore"), maxScore = score(params, "maxScore");
  if (minScore !== undefined && maxScore !== undefined && minScore > maxScore)
    throw new DomainError("INVALID_QUERY", "分數下限不可高於上限");
  const limit = integer(params.get("limit"), 50, 200);
  if (!limit) throw new DomainError("INVALID_QUERY", "limit 必須大於 0");
  return { modelVersion, from, to, symbol, minScore, maxScore, limit,
    offset: integer(params.get("offset"), 0, Number.MAX_SAFE_INTEGER),
    gateStatus: oneOf(params, "gate", ["PASS", "FAIL", "UNKNOWN"]),
    entryStatus: oneOf(params, "status", ["WAIT_TRIGGER", "TRIGGERED", "SIGNAL_EXPIRED", "SIGNAL_INVALIDATED", "DATA_INSUFFICIENT", "NOT_ELIGIBLE"]),
    setupType: oneOf(params, "setup", ["PULLBACK_RECOVERY", "RANGE_BREAKOUT"]),
    nextDayStatus: oneOf(params, "nextDay", ["NEXT_DAY_CANDIDATE", "WAIT_TRIGGER", "PRICE_TOO_HIGH", "PLAN_INVALIDATED", "DATA_INSUFFICIENT", "NOT_ELIGIBLE"]),
    source: oneOf(params, "source", ["daily", "historical-recalculation"]),
    includeDetail: ["1", "true"].includes(params.get("detail") ?? "") };
}

/** The sample filters without paging, plus the holding horizon (5, 10 or 20 sessions). */
export function researchBacktestOptions(params) {
  const { limit, offset, includeDetail, ...filters } = researchSampleOptions(params);
  return { ...filters, horizon: Number(oneOf(params, "horizon", ["5", "10", "20"]) ?? 10) };
}

/** Sessions of price history for the chart: 30 by default, up to the stored 260. */
export function chartDays(params) {
  const raw = params.get("days");
  if (raw === null) return 30;
  if (!["30", "60", "260"].includes(raw)) throw new DomainError("INVALID_QUERY", "days 必須是 30、60 或 260");
  return Number(raw);
}

export function analysisOptions(params) {
  const settings = { ...DEFAULT_SETTINGS };
  for (const name of Object.keys(settings)) {
    const raw = params.get(name);
    if (raw === null) continue;
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > (name === "period" ? 60 : 20))
      throw new DomainError("INVALID_QUERY", "指標參數超出允許範圍");
    settings[name] = Number(raw);
  }
  const asOf = params.get("asOf");
  if (asOf && (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(asOf)) ||
      new Date(asOf).toISOString().slice(0, 10) !== asOf)) throw new DomainError("INVALID_QUERY", "日期格式不正確");
  return { settings, asOf };
}
