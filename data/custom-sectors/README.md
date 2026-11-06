# 自訂細產業分類（台股上市公司）

把證交所 33 類官方產業別再細分成 16 個大類、92 個細產業，涵蓋 2026-11-04 出表的全部 1,099 家上市公司。App 透過 `shared/custom-sector-data.js` 使用這份資料。

## 檔案

| 檔案 | 說明 |
|---|---|
| `custom_sectors.json` | 分類結果（給程式讀）。`taxonomy` 是大類 → 細產業 → 股票代號的樹；`companies` 以股票代號為 key |
| `custom_sectors.csv` | 同一份結果的表格版（UTF-8 BOM，Excel 可直接開） |
| `research_notes.tsv` | 人工查詢主要業務後的歸類（`code`、`sub`、`basis`），優先權最高 |
| `custom_sectors_classify.py` | 產生器，含分類樹、官方產業別預設對應與逐家指定 |
| `t187ap03_L.json` | 證交所上市公司基本資料（`https://openapi.twse.com.tw/v1/opendata/t187ap03_L`），產生器的輸入 |

`companies` 每筆欄位：

- `name`：公司簡稱
- `sector`：自訂大類
- `subIndustry`：自訂細產業
- `twseIndustry`：證交所官方產業別
- `needsReview`：`true` 表示歸類仍待確認（目前只有 3593 力銘、6805 富世達）
- `basis`：網路查詢到的主要業務摘要（只有查詢過的公司才有）

## 歸類規則

1. 每家公司只歸一個細產業，讓產業合計不重複計算。
2. 歸類順序：`research_notes.tsv` > 產生器內的 `OVERRIDES` > 官方產業別的預設細產業。
3. 依實際商業模式與題材歸類，不只看官方產業別。例如鴻海放「伺服器與電腦代工」，匯僑放「物流與陸運」。
4. 存託憑證獨立成一類。

## 重新產生

在 repo 根目錄執行：

```bash
python3 -I data/custom-sectors/custom_sectors_classify.py data/custom-sectors/t187ap03_L.json
```

JSON 和 CSV 會寫回這個資料夾。接著執行 `node scripts/build-custom-sectors.mjs` 更新 App 使用的對照表，並更新 `cloudflare/summary-coordinator.js` 的摘要快取版本。調整某家公司的歸類時，修改 `research_notes.tsv` 再重跑；新增或改名細產業時，修改產生器裡的 `SECTORS`。證交所清單更新後，替換 `t187ap03_L.json` 再重跑；新上市的公司會先套用官方產業別的預設細產業；如果屬於半導體業、其他電子業這類範圍較大的官方類別，會標成 `needsReview`。
