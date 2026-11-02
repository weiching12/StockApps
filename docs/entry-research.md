# 進場研究模型 entry-research-v1

`shared/entry-research.js` 的 `evaluateEntryResearch()` 是唯一入口，參數集中在 `shared/entry-research-model.js`。前後端與歷史回測都呼叫同一份程式，前端不自行計算。**所有新參數都是暫定值，尚未經過歷史回測驗證。**

評估某個交易日時，只讀取該日（含）以前的 K 線；`tests/entry-research.test.js` 會比對「提供完整未來資料」與「只提供當日以前資料」的結果必須完全相同。

## 第一階段：五大核心門檻（沿用 V1.2，未改門檻）

直接使用 `evaluateCoreConditions()`，條件見 [entry-score.md](entry-score.md)：

| 構面 | PASS 條件 |
| --- | --- |
| 趨勢結構 | 收盤 > MA20 > MA60，且 MA20、MA60 皆較前一交易日上升 |
| KD 動能 | K > D，且 K 未連續兩日下降 |
| 量價表現 | 未出現跌幅超過 0.50% 且 RVOL20 ≥ 2 |
| 法人籌碼 | 近五日三大法人合計淨額 ≥ 0 |
| 基礎價格風險 | MA20 乖離 ≤ 10%，且前十日最低價 < 收盤 |

門檻總結果：

- **PASS**：五項皆 PASS，且沒有前提資料缺漏（61 個完整交易日、60 日內公司行動已查核）。
- **FAIL**：任一項 FAIL。其他項目再好也不能抵銷。
- **UNKNOWN**：沒有 FAIL，但有 UNKNOWN 或前提資料缺漏。UNKNOWN 永遠不當 PASS。

只有 PASS 進入第二階段；FAIL 的研究狀態為 `NOT_ELIGIBLE`，UNKNOWN 為 `DATA_INSUFFICIENT`，兩者的進場準備度皆為 `null`。

價格基準沿用 V1.2：60 日內有除息且已查核時，使用除息參考價調整後的歷史（`researchPriceHistory()`），門檻、訊號與價格計畫用同一份價格。

## 第二階段：進場訊號（本次新增，暫定參數）

### 順勢回踩恢復 `PULLBACK_RECOVERY`

在交易日 t 觸發，需全部成立：

1. t 之前 5 個交易日內，任一日最低價 ≤ 當日 MA20 + 0.5 × ATR14（回踩）。
2. 這 5 個交易日收盤皆 ≥ 當日 MA60（未破壞結構）。
3. t 日收盤 > MA20。
4. t 日收盤 > 前一交易日最高價。
5. t 日 K 值 > 前一交易日 K 值。

- 進場參考價：t 日收盤。
- 失效價：回踩期間（含 t 日）最低價 − 0.25 × ATR14。
- KD 確認：K > D 且 K 上升；量能確認：RVOL20 ≥ 1（不足時列入風險提示，不阻擋觸發）。

### 整理區間向上突破 `RANGE_BREAKOUT`

1. t 之前 20 個交易日（不含 t）的最高價與最低價構成整理區間，振幅 ≤ 4 × ATR14。
2. t 日收盤 > 區間上緣，且前一日收盤 ≤ 區間上緣（首次突破）。
3. t 日 RVOL20 ≥ 1.5。
4. t 日 K > D。

- 進場參考價：區間上緣。
- 失效價：max(區間上緣 − 1 × ATR14, 區間下緣)。
- RVOL20 ≥ 2 視為量能強確認；收盤高於區間上緣超過 3% 時提示追價風險。

ATR14 一律以 t 日為終點的 61 個交易日計算，與 V1.2 相同。

### 研究狀態

從評估日往回最多 10 個交易日，找最近一次觸發（同日兩種都觸發時取訊號品質較高者）：

| 狀態 | 條件 |
| --- | --- |
| `TRIGGERED` | 觸發日起 3 個交易日內（觸發日＋其後 2 日），且其後收盤未跌破失效價 |
| `SIGNAL_INVALIDATED` | 觸發後任一日收盤低於失效價 |
| `SIGNAL_EXPIRED` | 超過 3 個交易日且未失效 |
| `WAIT_TRIGGER` | 10 個交易日內沒有觸發 |
| `DATA_INSUFFICIENT` | 門檻 UNKNOWN 或評估日 ATR14 無法計算 |
| `NOT_ELIGIBLE` | 門檻 FAIL（本次新增的代碼，前端顯示「未通過五大門檻」） |

## 第二階段：進場準備度 `entryReadinessScore`（本次新增，暫定權重）

僅門檻 PASS 時計算，0～100 分，**不是 V1.2 的株研評分、不是獲利機率、也不是買進指令**。

| 分項 | 權重 | 計算 |
| --- | --- | --- |
| 五大構面強度 | 50% | V1.2 五個構面分數的**簡單平均**（不是 V1.2 的加權最終分數） |
| 進場訊號品質 | 30% | 已觸發：60 ＋ KD 確認 15 ＋ 量能確認 15（突破只達 1.5 倍給 5）＋ 新鮮度（當日 10、隔日 5）；已過期 20；已失效 0；等待中：正在形成的型態 30 ＋ K 上升 10 ＋ 只差一項條件 10，上限 50 |
| 進場位置與時機 | 20% | MA20 乖離 ≤ 3% 為 100、≤ 6% 為 70、≤ 10% 為 30；已觸發時再與「收盤距進場參考價的 ATR 倍數」取較低者（≤ 0.25 為 100、≤ 0.5 為 70、≤ 1 為 30、其餘 0） |

等待中的訊號品質上限為 50、已觸發至少 60，所以分數高的股票若尚未觸發，狀態仍是「等待進場訊號」，不會變成明日候選。結果保留三個分項分數、表現較好與較弱的構面、已成立與尚未成立的條件、風險提示。

## 第三階段：明日進場評估（本次新增，暫定參數）

只有 `TRIGGERED` 會產生價格：

| 欄位 | 計算 |
| --- | --- |
| `referenceClose` | 評估日收盤 |
| `entryReferencePrice` | 訊號的進場參考價 |
| `entryPriceLower` | `null`，第一版策略未定義下限 |
| `entryPriceUpper` | 進場參考價 ＋ 0.5 × ATR14 |
| `invalidationPrice` | 訊號的失效價 |
| `riskPercent` | (進場參考價 − 失效價) ÷ 進場參考價 |
| `maxRiskPercent` | (上限 − 失效價) ÷ 上限 |
| `planExpiresAt` | 下一個交易日；行事曆尚未出現時為 `null`，並以 `planExpiresAfterSessions: 1` 表示 |

狀態：

- `NEXT_DAY_CANDIDATE`：收盤未超過上限，且 `maxRiskPercent` ≤ 8%。
- `PRICE_TOO_HIGH`：收盤已高於上限，或以上限進場的風險超過 8%。
- `PLAN_INVALIDATED`：訊號已失效。
- `WAIT_TRIGGER`：尚未觸發或訊號已過期。
- `DATA_INSUFFICIENT`：門檻 UNKNOWN，或 ATR14／失效價無法建立（此時所有價格為 `null`，不輸出看似精確的價格）。
- `NOT_ELIGIBLE`：門檻 FAIL，前端顯示「尚未評估」。

沒有即時行情，候選一律 `requiresPriceConfirmation: true`。`checkNextDayPlan(plan, nextBar)` 只用下一交易日的**開盤價**判斷：高於上限 `OPEN_ABOVE_UPPER`（不追價）、不高於失效價 `OPEN_BELOW_INVALIDATION`（取消）、其餘 `WITHIN_PLAN`（以開盤價模擬成交）；還沒有隔日行情為 `AWAITING_PRICE`。原計畫的上限與失效價不會因為市場價格而調整。

## 暫定參數總表

全部位於 `ENTRY_RESEARCH_MODEL`，修改任何會影響結果的值時，必須同時更新 `ENTRY_RESEARCH_MODEL_VERSION`：

回踩觀察 5 日、MA20 觸及帶 0.5 × ATR、回踩失效 0.25 × ATR、回踩量能確認 RVOL ≥ 1；突破區間 20 日、振幅 ≤ 4 × ATR、突破 RVOL ≥ 1.5（強確認 2）、突破失效 1 × ATR；訊號有效 3 日、回溯 10 日；價格上限 0.5 × ATR、風險上限 8%；權重 50／30／20；回測成本手續費 0.1425%、證交稅 0.3%、滑價 0.1%；後續表現 1／5／10／20 日。
