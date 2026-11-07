# iPhone 原生版本

使用 Capacitor 8，以現有 Cloudflare API 載入行情。一般網頁／PWA 保留原有行為，
原生 SDK、Preferences 及 APNs 只會進入 `native` 建置。沒有建立 Android 專案。

## 已整合

- App 背景事件儲存設定、研究追蹤基準與所在頁面；回到前景檢查行情版本。
  同版本不重載；進入頁面後的新資料透過不可手動關閉的更新視窗確認，點選更新後先等待設定寫入，再重載並回復所在頁面；新資料載入完成後關閉視窗，失敗保留重試。這是行情資料更新，不是原生二進位檔更新。
  並行檢查共用請求，背景完成的回應不重載畫面，失敗可再試。
- Preferences 在畫面初始化前讀取；UI 寫入經序列化處理，避免舊值覆蓋新值。
  初次使用可複製同一 WebView 中既有的 localStorage，原生儲存已有資料時不再遷移。
  Safari/PWA 與原生 App 是不同儲存空間，不會自動取得 Safari 的自選。
  讀取失敗保留原資料，寫入失敗保留緩衝供重試；移除 App 會清除這些本機資料。
- iOS Push Notifications：使用者點擊後才要求權限；保存通知選擇，啟動／前景時更新 token。
  註冊失敗、拒絕、關閉及 token 更換有獨立處理；通知點擊保留目前頁面並檢查新資料，
  不採用推播內容中的外部 URL 作導向。
- Cloudflare APNs adapter：ES256 provider token、sandbox/production 分流、每日成功去重、
  暫時失敗重試及失效裝置 token 清理。所有 Apple 私密金鑰只存在 Worker Secrets。

- 啟動畫面全程使用深藍 `#14243b`：LaunchScreen 與 `Splash` 圖、`capacitor.config.json` 的
  `backgroundColor`（WebView 首次繪製前的底色）及網頁進場動畫一致，避免啟動時閃白。
  `native` 建置會在 `<html>` 標上 `is-standalone`，一定播放進場動畫。
  iOS 會快取啟動畫面，更換後需移除 App 再重新安裝才看得到。

原生版本以 CapacitorHttp 呼叫設定的 HTTPS API origin；不使用 Service Worker 或瀏覽器推播，
也不登記網頁造訪人數。設定頁「檢查資料」只檢查行情，不宣稱可以更新原生 App 二進位檔。

## 建置及測試

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build:cloudflare
npm.cmd run build:native
node scripts/verify-native-build.mjs
npm.cmd run test:native
npm.cmd run native:sync
```

`dist` 為網頁，`dist-native` 為原生資產，互不覆蓋。
需要改 API 主機時，在原生建置前設定 `STOCKAPPS_NATIVE_API_ORIGIN`，值必須是 HTTPS origin。
`test:native` 使用瀏覽器及可控原生橋接；不等於 iOS 模擬器、簽章或實機測試。

在 Mac 安裝 Xcode 26+ 後執行 `npm run native:ios`，開啟 `ios/App/App.xcodeproj`，
選取自己的 Team、註冊的 Bundle ID，核對 Push Notifications capability。
目前開發用識別碼為 `dev.workers.stockinsighttw.app`，必須與 Apple 註冊及 Worker `APNS_BUNDLE_ID` 一致。
若更改識別碼，同步調整 capacitor.config.json 與 Xcode target。
Debug 使用 development entitlement，Release 使用 production entitlement。
UserDefaults 的 PrivacyInfo.xcprivacy 已加入 Resources，理由為 CA92.1。

## APNs 啟用

目前沒有 Apple Developer、簽章及 APNs 設定，因此通知預設停用，不自動要求權限。
伺服器 `/api/v1/push/native/config` 回覆 `{enabled:false,provider:"apns",environment:"sandbox"}`。

完成 Apple 設定後再啟用：

1. 對目標 D1 僅套用 `cloudflare/migrations/0006_native_push.sql`。這次程式整合沒有套用遠端 migration。
2. Worker Secrets 設定 `APNS_PRIVATE_KEY`（Apple .p8 內容）、`APNS_KEY_ID`、`APNS_TEAM_ID`。
   不放入前端、cap config、Git 或 native assets。
3. Worker vars 設定 `APNS_BUNDLE_ID`、`APNS_ENVIRONMENT`（sandbox 或 production），
   最後才設定 `NATIVE_PUSH_ENABLED=1`。開發機測 sandbox；TestFlight／正式版測 production。
4. 在真實 iPhone 確認同意、拒絕、關閉、重新開啟、token 變更、App 背景及通知點擊，
   並實測 Worker 到 APNs 的傳輸及當日發布通知。通知送達前不可宣稱完成實機推播驗證。

native subscriptions 與瀏覽器 Web Push 使用獨立資料表及端點，不回傳 token 或私密設定。
裝置以本機隨機產生的 secret 取消自己的訂閱，伺服器只保存其 SHA-256；無帳號與跨裝置同步。

官方介面：[App](https://capacitorjs.com/docs/apis/app)、
[Preferences](https://capacitorjs.com/docs/apis/preferences)、
[Push Notifications](https://capacitorjs.com/docs/apis/push-notifications)。
