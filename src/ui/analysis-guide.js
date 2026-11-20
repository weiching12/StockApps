// 株研分析說明: how the app's own research reads a stock, one section per stage. It starts with the
// preliminary gate (初步門檻); the rules and thresholds come from the live model (shared/entry-research.js),
// so the explanation always matches what the lists show.
import { vetoGateGuide } from "../../shared/entry-research.js";
import { ENTRY_RESEARCH_MODEL, ENTRY_RESEARCH_STATUS_LABELS, NEXT_DAY_STATUS_LABELS, SETUP_LABELS } from "../../shared/entry-research-model.js";
import { REFERENCE_NOTE, VETO_ICONS, VETO_SHORT } from "./entry-research.js";

// Why each veto exists, in a sentence; the rule itself comes from the model.
const WHY = {
  trend: "均線空頭排列或季線下彎時，「順勢」的前提不存在。收盤暫時跌破月線不否決，因為回踩本來就是在等拉回。",
  distribution: "放量下跌代表明顯賣壓；在收盤站回那天的最高價之前，不視為賣壓已消化。",
  extension: "以 ATR（平均真實波幅）衡量距離，高低波動的股票用同一把尺；離月線太遠時追價，短期表現通常較差。",
  institutional: "只排除明顯出貨，小幅賣超不否決；自營商含避險部位、雜訊大，所以不計入。",
  liquidity: "成交金額太低時價差大、不易成交，回測的成交假設也不可靠。",
};

/** Section ids, for links that open the guide at a section (data-analysis="…"). */
export const ANALYSIS_SECTIONS = Object.freeze({ gate: "analysis-gate", research: "analysis-research" });

const icon = (key) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${VETO_ICONS[key] ?? '<circle cx="12" cy="12" r="8"/>'}</svg>`;

/**
 * `back` (a stock's code and name) adds a button that returns to that stock when the guide replaced it in the
 * same dialog (phones). `headingId` names the heading for the dialog that labels itself by it.
 */
export function analysisGuideMarkup(esc, back = null, headingId = "dialog-heading") {
  const vetoes = vetoGateGuide().map(({ key, label, rule, references }, index) => {
    const sources = references.map((ref) => `<li><span class="research-reference-kind">${esc(ref.kind)}</span><a href="${esc(ref.url)}" target="_blank" rel="noopener noreferrer">${esc(ref.title)}</a></li>`).join("");
    return `<div class="analysis-veto" id="analysis-gate-${key}" data-gate="${key}"><dt><span class="analysis-veto-icon">${icon(key)}</span><span class="analysis-veto-name"><strong>${esc(VETO_SHORT[key] ?? label)}</strong><small>G${index + 1} ${esc(label)}</small></span></dt><dd><p>${esc(rule)}。</p><p class="analysis-why">${esc(WHY[key] ?? "")}</p>${sources ? `<h5>參考依據</h5><ul class="research-references">${sources}</ul>` : ""}</dd></div>`;
  }).join("");
  const backButton = back ? `<button type="button" class="analysis-back" data-entry-score="${esc(back.symbol)}">← 返回 ${esc(back.symbol)} ${esc(back.name ?? "")}</button>` : "";
  return `${backButton}<h2 id="${headingId}">株研分析說明</h2>
<p class="dialog-intro">株研以固定規則逐日研讀每檔上市股票，分成三步：先過初步門檻，再看是否出現進場訊號，最後評估下一交易日能否進場並列出價格計畫。結果是條件判讀，並非買賣指令。</p>
<article class="guide-item" id="${ANALYSIS_SECTIONS.gate}"><span>01</span><div><h3>初步門檻</h3>
<p>第一步只回答一件事：這檔股票是否出現讓「波段順勢進場」前提失效的情況。門檻只放<strong>否決條件</strong>，出現即排除；不判斷強弱高低，也不打分數，明日候選之間不分高下。</p>
<dl class="analysis-vetoes">${vetoes}</dl>
<h4>怎麼判定</h4>
<dl class="signal-rules"><div><dt>通過</dt><dd>五項都沒有觸發，才進入進場訊號與價格計畫的評估。</dd></div><div><dt>未通過</dt><dd>任一項觸發即未通過，不評估進場。清單以徽章列出觸發的項目，3 項以內逐項列出，更多時顯示「共 N 項」。</dd></div><div><dt>待確認</dt><dd>沒有觸發，但有項目資料不足（例如交易日數還不夠計算均線）；資料不足不當成未通過，也不補零。</dd></div></dl>
<p>所有計算只使用該交易日及以前的資料；價格未還原，期間有除權息時以參考價調整。ETF 不做進場研究。</p>
<p class="research-gate-note">${esc(REFERENCE_NOTE)}</p></div></article>
${researchSection(esc)}`;
}

/**
 * 02 進場研究: the two entry signals, what the list's 進場研究 column says, and the next-day plan. Every number
 * comes from the live model (shared/entry-research-model.js), so the text follows a change of parameters.
 */
function researchSection(esc) {
  const { pullback, breakout, signal, plan } = ENTRY_RESEARCH_MODEL;
  const list = (items) => `<ol class="analysis-steps">${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ol>`;
  const validity = signal.validSessions === 1 ? "只在觸發當天有效，隔天起即視為過期" : `觸發日起 ${signal.validSessions} 個交易日內有效`;
  const statuses = [
    ["明日可進場", `訊號今天觸發，收盤沒有超過開盤上限，且以開盤上限買進的停損虧損不超過 ${plan.maxRiskPercent}%：成為「${NEXT_DAY_STATUS_LABELS.NEXT_DAY_CANDIDATE}」。`],
    ["訊號觸發・不進場", `訊號觸發了，但收盤已高於開盤上限（不追價），或停損距離太遠（以上限買進會虧損超過 ${plan.maxRiskPercent}%）。`],
    ["訊號觸發・資料不足", "訊號觸發了，但 ATR14 或停損價無法建立，不提供看似精確的價格。"],
    [ENTRY_RESEARCH_STATUS_LABELS.WAIT_TRIGGER, `門檻通過，但近 ${signal.lookbackSessions} 個交易日沒有出現進場訊號。`],
    [ENTRY_RESEARCH_STATUS_LABELS.SIGNAL_EXPIRED, `訊號已經觸發過，但超過有效期間（${validity}）。`],
    [ENTRY_RESEARCH_STATUS_LABELS.SIGNAL_INVALIDATED, "觸發後有收盤跌破停損價（失效價），原本的進場理由不成立。"],
    [ENTRY_RESEARCH_STATUS_LABELS.NOT_ELIGIBLE, "初步門檻有否決條件觸發，不評估進場。"],
    [ENTRY_RESEARCH_STATUS_LABELS.DATA_INSUFFICIENT, "門檻待確認，或 ATR14 無法計算。"],
  ];
  return `<article class="guide-item" id="${ANALYSIS_SECTIONS.research}"><span>02</span><div><h3>進場研究</h3>
<p>門檻通過後，第二步看是否出現兩種進場訊號之一；觸發當天，第三步才評估下一交易日能否進場並列出價格。訊號與價格只用收盤後的日線資料判斷，不是盤中訊號。</p>
<h4>進場訊號一：${esc(SETUP_LABELS.PULLBACK_RECOVERY)}</h4>
<p>上升趨勢中股價拉回月線附近，再重新轉強。以下全部成立的那一天觸發：</p>
${list([
    `形成：前 ${pullback.lookbackSessions} 個交易日內，曾有一天最低價回到 MA20 ＋ ${pullback.touchAtrBand} × ATR14 以內（回踩）`,
    "形成：回踩期間每天收盤都沒有跌破 MA60（結構沒有破壞）",
    "觸發：當天收盤重新站上 MA20",
    "觸發：當天收盤高於前一交易日最高價",
    "觸發：當天 K 值較前一交易日上升",
  ])}
<p class="analysis-why">參考買入價為觸發日收盤；停損價為回踩期間最低價 − ${pullback.invalidationAtr} × ATR14。K 值高於 D 值且上升記為 KD 確認、RVOL20 ≥ ${pullback.volumeConfirmRvol} 記為量能確認，兩者不阻擋觸發，只列在明細中。</p>
<h4>進場訊號二：${esc(SETUP_LABELS.RANGE_BREAKOUT)}</h4>
<p>股價在窄幅區間整理後，帶量向上突破。以下全部成立的那一天觸發：</p>
${list([
    `形成：前 ${breakout.rangeSessions} 個交易日的最高價與最低價構成整理區間，振幅不超過 ${breakout.maxRangeAtr} × ATR14`,
    "觸發：當天收盤首次突破區間上緣（前一天收盤還在上緣以下）",
    `觸發：當天 RVOL20 ≥ ${breakout.minRvol}（成交量至少是近 20 日平均的 ${breakout.minRvol} 倍）`,
    "觸發：當天 K 值高於 D 值",
  ])}
<p class="analysis-why">參考買入價為區間上緣；停損價為「區間上緣 − ${breakout.invalidationAtr} × ATR14」與區間下緣兩者較高的價位。RVOL20 ≥ ${breakout.strongRvol} 記為量能強確認；收盤高於上緣超過 3% 時提示追價風險。</p>
<h4>有效期間</h4>
<p>訊號${esc(validity)}。同一天兩種訊號都觸發時，取明細較完整（KD、量能確認較多）的那一個。</p>
<h4>清單上的「進場研究」</h4>
<dl class="signal-rules">${statuses.map(([label, text]) => `<div><dt>${esc(label)}</dt><dd>${esc(text)}</dd></div>`).join("")}</dl>
<h4>明日進場評估與價格計畫</h4>
<dl class="signal-rules">
<div><dt>參考買入價</dt><dd>訊號的進場參考價（回踩恢復為觸發日收盤，區間突破為區間上緣）。</dd></div>
<div><dt>開盤上限</dt><dd>參考買入價 ＋ ${plan.upperAtr} × ATR14。下一交易日開盤高於上限就不買，不追價。</dd></div>
<div><dt>停損價</dt><dd>訊號的失效價。下一交易日開盤不高於停損價就取消；買進後收盤跌破代表進場理由不成立。</dd></div>
<div><dt>單筆虧損上限</dt><dd>以開盤上限買進、跌到停損價的虧損須不超過 ${plan.maxRiskPercent}%，否則停損距離太遠，不列為候選。</dd></div>
<div><dt>只看開盤</dt><dd>計畫只在下一交易日有效，且只用開盤價判斷是否落在停損價與開盤上限之間；不等待盤中回落，也不因價格變動調整計畫。</dd></div>
</dl>
<p>明日候選之間不排名次，也不打分數（v4 起不計算進場準備度）。研究結果是固定規則的條件判讀，並非買賣指令；參數為暫定，以每日保存的研究樣本與後續行情持續檢驗（見「策略回測」）。</p></div></article>`;
}
