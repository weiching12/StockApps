// 株研分析說明: how the app's own research reads a stock, one section per stage. It starts with the
// preliminary gate (初步門檻); the rules and thresholds come from the live model (shared/entry-research.js),
// so the explanation always matches what the lists show.
import { vetoGateGuide } from "../../shared/entry-research.js";

// Why each veto exists, in a sentence; the rule itself comes from the model.
const WHY = {
  trend: "均線空頭排列或季線下彎時，「順勢」的前提不存在。收盤暫時跌破月線不否決，因為回踩本來就是在等拉回。",
  distribution: "放量下跌代表明顯賣壓；在收盤站回那天的最高價之前，不視為賣壓已消化。",
  extension: "以 ATR（平均真實波幅）衡量距離，高低波動的股票用同一把尺；離月線太遠時追價，短期表現通常較差。",
  institutional: "只排除明顯出貨，小幅賣超不否決；自營商含避險部位、雜訊大，所以不計入。",
  liquidity: "成交金額太低時價差大、不易成交，回測的成交假設也不可靠。",
};

/** Section ids, for links that open the guide at a section (data-analysis="…"). */
export const ANALYSIS_SECTIONS = Object.freeze({ gate: "analysis-gate" });

export function analysisGuideMarkup(esc) {
  const vetoes = vetoGateGuide().map(({ key, label, rule }, index) => `<div class="analysis-veto"><dt><span>G${index + 1}</span>${esc(label)}</dt><dd><p>${esc(rule)}。</p><p class="analysis-why">${esc(WHY[key] ?? "")}</p></dd></div>`).join("");
  return `<h2 id="dialog-heading">株研分析說明</h2>
<p class="dialog-intro">株研以固定規則逐日研讀每檔上市股票，分成三步：先過初步門檻，再看是否出現進場訊號，最後評估下一交易日能否進場並列出價格計畫。結果是條件判讀，並非買賣指令。</p>
<article class="guide-item" id="${ANALYSIS_SECTIONS.gate}"><span>01</span><div><h3>初步門檻</h3>
<p>第一步只回答一件事：這檔股票是否出現讓「波段順勢進場」前提失效的情況。門檻只放<strong>否決條件</strong>，出現即排除；不判斷強弱高低，也不打分數，明日候選之間不分高下。</p>
<dl class="analysis-vetoes">${vetoes}</dl>
<h4>怎麼判定</h4>
<dl class="signal-rules"><div><dt>通過</dt><dd>五項都沒有觸發，才進入進場訊號與價格計畫的評估。</dd></div><div><dt>未通過</dt><dd>任一項觸發即未通過，不評估進場。清單以徽章列出觸發的項目，3 項以內逐項列出，更多時顯示「共 N 項」。</dd></div><div><dt>待確認</dt><dd>沒有觸發，但有項目資料不足（例如交易日數還不夠計算均線）；資料不足不當成未通過，也不補零。</dd></div></dl>
<p>所有計算只使用該交易日及以前的資料；價格未還原，期間有除權息時以參考價調整。ETF 不做進場研究。</p></div></article>`;
}
