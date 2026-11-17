// The 法人轉買 badge shared by the sector sheet's rows and the stock detail (rule: shared/institution-turn.js).
const billions = (amount) => `${(amount / 100_000_000).toFixed(2)} 億`;

/** Why the stock is marked, as one sentence for the badge's tooltip and screen readers. */
export function institutionTurnText(turn) {
  return `三大法人前 ${turn.sellSessions} 日連續賣超共 ${billions(turn.soldAmount)}，今日轉為買超 ${billions(turn.amount)}`
    + `（占成交金額 ${turn.valueShare.toFixed(1)}%）；收盤低於季線，近 ${turn.returnSessions} 日 ${turn.returnPercent.toFixed(2)}%。僅供觀察，非買進訊號。`;
}

export function institutionTurnBadge(turn, esc) {
  if (!turn) return "";
  const text = esc(institutionTurnText(turn));
  return `<span class="institution-turn-badge" title="${text}" aria-label="法人轉買：${text}">法人轉買</span>`;
}
