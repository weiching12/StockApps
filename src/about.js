// Each goal's status and progress line say where the app stands today; update them as features ship.
const goals = [
  ["01", "看見數據", "整合每日行情、三大法人、歷史股價及技術指標。", "目前提供", "每日行情、法人籌碼與歷史資料，搭配 KD、均線等技術指標；ETF 另有規模、折溢價、配息與持股資料。"],
  ["02", "理解訊號", "不再孤立判讀 KD、均線，而是分析多項指標之間的關聯。", "持續發展", "進場研究把趨勢、量價、法人與流動性串成三步判讀：初步門檻、進場訊號、下一交易日進場評估與價格計畫；更多指標組合持續研究中。"],
  ["03", "解釋原因", "以自然語言說明為什麼值得觀察、為什麼可能轉強，以及哪些條件尚未成立。", "持續發展", "個股明細逐項寫出門檻結果與原因、尚未成立的條件及價格計畫；「分析說明」公開判讀規則。"],
  ["04", "辨識風險", "除了正向訊號，也主動揭露法人背離、量價異常、趨勢轉弱與資料不足。", "持續發展", "初步門檻標出趨勢遭破壞、近期放量下跌、過度延伸、法人明顯賣壓與流動性不足，資料不足標示待確認；更多風險辨識持續建置。"],
  ["05", "驗證判斷", "透過歷史回測，檢視過去相同訊號出現後的勝率、報酬分布及最大回撤，而非憑感覺宣稱策略有效。", "持續發展", "每日保存全市場研究樣本與後續實際行情，登入後可在「策略回測」檢視勝率、報酬分布與回撤；參數仍暫定，結果僅供研究。"],
];

export const sourceAbout = () => `<section class="source-about about-page" aria-label="關於株研">
    <div class="about-hero"><span class="eyebrow">OUR PURPOSE</span><h2>從數據到洞察，<br>讓每一項投資判斷都有跡可循。</h2>
      <p>株研（Stock Research）不只是呈現股票數據，而是希望透過技術指標、法人籌碼、成交量與基本面的交叉分析，解釋市場正在發生什麼、可能代表什麼，以及還有哪些風險值得留意。</p>
      <p class="about-scope">目前以行情、技術指標與法人資料為研究起點，基本面整合與進階分析將逐步發展。</p></div>
    <h2 class="about-goals-heading">想達成的目標</h2>
    <ol class="about-goals">${goals.map(([number, title, description, status, detail]) => `
      <li class="about-goal"><span class="about-number" aria-hidden="true">${number}</span><div><div class="about-goal-heading"><h3>${title}</h3><span class="about-status ${status === "目前提供" ? "available" : ""}">${status}</span></div><p>${description}</p><p class="about-progress">${detail}</p></div></li>`).join("")}</ol>
    <div class="about-next"><p>從一筆數據開始，建立可以追蹤與驗證的研究過程。</p></div>
  </section>`;
