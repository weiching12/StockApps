# 程式衝突、未使用內容與重大問題檢查（2026-11-02）

檢查基準：`fc1b5bf`。範圍包含前端、共用計算、Worker、工具腳本、測試、設定檔與文件。

## 修正

- **推播訂閱網址限制（安全性）**：匿名 `POST /api/v1/push/subscriptions` 原本接受任何 HTTPS 網址，每日更新後 Worker 會對所有已存網址送出 POST，可被利用為對任意主機發送請求，也會讓資料庫被灌入無效資料。現在只接受瀏覽器推播服務主機（`fcm.googleapis.com`、`android.googleapis.com`、`*.push.services.mozilla.com`、`web.push.apple.com`、`*.notify.windows.com`），網址最長 1,024 字元、不得含帳密或非預設連接埠。既有不符規則的資料在下次發送時直接移除，不會連線。
- **推播請求大小**：未帶 `Content-Length` 的串流內容原本會先完整讀入再檢查，改為讀到 4 KiB 即中止，與登入、訪客 API 一致。
- **走勢圖觸控**：長按拖曳時阻止捲動的 `touchmove` 非被動監聽器，從整個頁面改為只在啟動拖曳時掛在該圖表上，結束即移除。
- **測試與日期耦合**：管理員訪客統計的 10 項瀏覽器測試資料固定為 2026 年 10 月，頁面預設顯示當月，進入 11 月後全部失敗；改為測試內固定時間。
- **過期測試伺服器**：`test:refactor-browser` 的測試伺服器未提供新增的 `/api/v1/auth/me`，頁面載入即出現 404；已補上匿名回應。
- **過期選擇器**：Cloudflare ETF 瀏覽器測試仍尋找已移除的自選卡片 `data-watch-symbol`；改為現行株研追蹤卡片，並補上研究 API 模擬回應。
- 移除未使用的 `MarketError` 相容匯出，以及無對應元素的 `#apply-update[hidden]` CSS 規則。

## 檢查結果

- 213 個 JavaScript／MJS 檔案：0 缺失引用、0 未使用匯入、0 循環依賴。僅在模組內使用的常數匯出與工具腳本（`bootstrap-history.js`、`benchmark-summary.mjs`、`manage-user.mjs` 等，文件或手動操作使用）保留。
- CSS：除上述一條外，其餘選擇器均有對應元素或動態組成的 class（例如 `hide-${series}`、`${key}-line`）。
- 認證、Session、訪客統計權限、同源檢查、登入次數限制與原生推播驗證未發現問題。
- 正式環境仍保存已不使用的 `FINMIND_TOKEN` secret；程式不再讀取，是否刪除由維護者決定。

## 驗證

- 337 項 Node 單元／整合測試通過。
- 103 項網頁、25 項 PWA、3 項原生瀏覽器測試，以及 sync、presence、auth、auth proxy、T86、summary cache、PWA build、refactor browser 等 runtime 測試通過。
- Cloudflare 瀏覽器測試在本機 Worker 上 19／20 通過；`production.spec.js` 的 2031 比較需要正式資料的完整評分歷史，於部署後對正式網站驗證。
- 網頁／Cloudflare／原生建置、原生資產隔離檢查、`npm audit --omit=dev`（0 個弱點）與 `git diff --check` 通過。

本次未變更評分規則、資料契約、資料庫結構或排程。
