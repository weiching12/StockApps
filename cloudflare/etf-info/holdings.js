// Monthly top-ten holdings of every ETF, from the Securities Investment Trust & Consulting Association
// (SITCA) "基金持股明細（月）" report. It is an ASP.NET form: one GET for the form state, then one POST per
// fund class. Funds are listed by name, not by listed code, so names are matched to the TWSE fund profile.

export const SITCA_HOLDINGS_URL = "https://www.sitca.org.tw/ROC/Industry/IN2629.aspx?pid=IN22601_04";
const FIELD = "ctl00$ContentPlaceHolder1$";
/** ETF classes only: index ETFs (AH) and active ETFs (AL). Feeder funds and ordinary funds are not listed securities. */
export const etfHoldingClass = (label) => /^A[HL]\d/.test(label);

const decode = (text) => String(text ?? "").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
const cellText = (html) => decode(html.replace(/<[^>]+>/g, "")).trim();

/**
 * A fund's name reduced to what both sources agree on: "元大台灣高股息基金(…配息來源…)" in the SITCA
 * report and "元大台灣高股息證券投資信託基金" in the TWSE profile both become "元大台灣高股息".
 */
export function fundNameKey(name) {
  let key = decode(name).normalize("NFKC").replace(/\s/g, "");
  // Disclaimers and share-class notes trail the name in brackets or after a dash.
  key = key.replace(/[（(][^（()）]*[)）]/g, "").replace(/[（(].*$/, "").replace(/-.*$/, "");
  // "…傘型基金之X" is fund X of an umbrella trust.
  if (key.includes("傘型")) key = key.slice(key.lastIndexOf("之") + 1);
  return key.replace(/證券投資信託|期貨信託|指數股票型|交易所交易|基金|ETF/gi, "").replace(/臺/g, "台").replace(/証/g, "證");
}

/** The form's hidden state, the months it offers (oldest first, `month` the latest, `selected` the page's own) and its ETF classes. */
export function parseHoldingsForm(html) {
  const hidden = (name) => new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(html)?.[1];
  const options = (name) => {
    const select = new RegExp(`<select[^>]*name="${(FIELD + name).replaceAll("$", "\\$")}"[^>]*>([\\s\\S]*?)</select>`).exec(html)?.[1] ?? "";
    return [...select.matchAll(/<option([^>]*)value="([^"]*)"[^>]*>([^<]*)/g)].map((option) => ({ value: option[2], label: option[3].trim(), selected: /selected/.test(option[0]) }));
  };
  const state = { __VIEWSTATE: hidden("__VIEWSTATE"), __VIEWSTATEGENERATOR: hidden("__VIEWSTATEGENERATOR"), __EVENTVALIDATION: hidden("__EVENTVALIDATION") };
  const monthOptions = options("ddlQ_YM").filter((option) => /^\d{6}$/.test(option.value));
  const months = monthOptions.map((option) => option.value).sort();
  const classes = options("ddlQ_Class").filter((option) => etfHoldingClass(option.label)).map((option) => option.value);
  if (!state.__VIEWSTATE || !state.__EVENTVALIDATION || !months.length || !classes.length)
    throw new Error("SITCA holdings form unavailable or format changed");
  // The month the page is on: a query for another month is only honoured from that month's own page.
  return { state, month: months.at(-1), selected: monthOptions.find((option) => option.selected)?.value ?? null, months, classes };
}

export const holdingsQuery = (form, fundClass, month = form.month) => new URLSearchParams({ __EVENTTARGET: "", __EVENTARGUMENT: "", ...form.state,
  [`${FIELD}ddlQ_YM`]: month, [`${FIELD}rdo1`]: "rbClass", [`${FIELD}ddlQ_Class`]: fundClass, [`${FIELD}BtnQuery`]: "查詢" });

/**
 * One class's result table → `[{ fundName, holdings: [{ rank, kind, code, name, weight }] }]`.
 * A fund's first row carries its name; the following rows belong to it. A class with no funds has no table.
 */
export function parseEtfHoldings(html) {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((row) => [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((cell) => cellText(cell[1])));
  const header = rows.find((row) => row[0] === "基金名稱");
  if (!header) {
    // The empty result page still carries the form; anything else is not the report.
    if (!html.includes("__VIEWSTATE")) throw new Error("SITCA holdings report unavailable or format changed");
    return [];
  }
  if (header[1] !== "名次" || header[4] !== "標的名稱" || !String(header.at(-1)).startsWith("占基金淨資產價值之比例"))
    throw new Error("SITCA holdings report unavailable or format changed");
  const funds = [];
  for (const row of rows) {
    if (row === header || row.length < header.length - 1) continue;
    // A fund's first row has every column; later rows drop the fund-name cell.
    const named = row.length === header.length, cells = named ? row.slice(1) : row;
    if (named) funds.push({ fundName: row[0], holdings: [] });
    const rank = Number(cells[0]), weight = Number(String(cells.at(-1)).replaceAll(",", ""));
    if (!funds.length || !Number.isInteger(rank) || rank < 1 || !Number.isFinite(weight)) continue;
    funds.at(-1).holdings.push({ rank, kind: cells[1] || null, code: cells[2] || null, name: cells[3] || null, weight });
  }
  return funds.filter((fund) => fund.holdings.length);
}

/**
 * Attach listed codes to the report's funds by name. A name that matches no profile, or a key shared by
 * two different funds, is left out: showing another fund's holdings would be worse than showing none.
 * Share classes of one fund (00636 and 00636K) share a key and both take its holdings.
 */
export function matchHoldingsToSymbols(funds, profileNames) {
  const base = (symbol) => symbol.replace(/[A-Z]$/, "");
  const symbols = new Map(), ambiguous = new Set();
  for (const { symbol, name } of profileNames) {
    const key = fundNameKey(name);
    if (!key) continue;
    const listed = symbols.get(key) ?? [];
    if (listed.length && base(listed[0]) !== base(symbol)) ambiguous.add(key);
    symbols.set(key, [...listed, symbol]);
  }
  const matched = new Map(), unused = [];
  for (const fund of funds) {
    const key = fundNameKey(fund.fundName);
    if (symbols.has(key) && !ambiguous.has(key)) for (const symbol of symbols.get(key)) matched.set(symbol, fund.holdings);
    else unused.push({ key, holdings: fund.holdings });
  }
  // An umbrella trust's profile names its sub-fund without the issuer ("…傘型…之標普500"), while the report
  // writes "元大標普500". Accept the report fund that ends with the profile's key and starts with the same
  // issuer, only when exactly one does.
  for (const [key, listed] of symbols) {
    if (matched.has(listed[0]) || key.length < 3 || ambiguous.has(key)) continue;
    const name = profileNames.find((profile) => profile.symbol === listed[0]).name;
    const issuer = decode(name).normalize("NFKC").replace(/\s/g, "").replace(/臺/g, "台").slice(0, 2);
    const candidates = unused.filter((fund) => fund.key.endsWith(key) && fund.key.startsWith(issuer));
    if (candidates.length === 1) for (const symbol of listed) matched.set(symbol, candidates[0].holdings);
  }
  return matched;
}
