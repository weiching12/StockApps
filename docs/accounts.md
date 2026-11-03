# 帳號與管理員權限

共用 `/login.html` 輸入帳號、密碼。一般使用者登入後回研究工作台；管理員登入後可從設定的「管理」進入 `/admin-visitors.html`：查看最新資料日的推播送達狀態（訂閱裝置、已送達、被拒、待發送，依推播服務列出最近拒收原因），可「重新發送今日通知」給尚未收到也未被拒的裝置；並查看每日、每月與歷史訪客統計，造訪明細每頁 10 筆。公開市場資料仍可瀏覽。帳號由維護者建立，本版不提供自行註冊或 Email 重設密碼。

手機版由「設定」內的「登入」按鈕進入；桌面版保留頂端帳號入口。

## 首次上線

在部署此版本前，先套用 D1 migration（新增獨立帳號資料表，不修改股票資料）：

```sh
npx wrangler login
npx wrangler d1 migrations apply stockapps-t86 --remote
node scripts/manage-user.mjs create your-admin --role admin --temporary --remote
node scripts/manage-user.mjs create your-user --role user --remote
npm run deploy
```

建立帳號會提示輸入密碼，終端機不顯示輸入內容；密碼需 12～128 字元。沒有預設帳號或預設密碼。帳號不分大小寫，限 3～64 個英文字母、數字與 `_.@-`，以字母或數字開頭。若本機測試，以上 migration 與帳號指令改用 `--local`，使用 `npm run dev:cloudflare`（http://127.0.0.1:8787）。若本機尚未匯入行情，可另外執行 `npm run dev`（http://127.0.0.1:5173），用標明示範資料的工作台查看畫面；登入與統計 API 仍代理到本機 8787。

不再使用 `ADMIN_ANALYTICS_TOKEN`。舊密鑰無法登入或取得統計，正式環境可刪除該 secret。

`0007_auth.sql` 建立帳號與登入資料表，`0008_required_password_change.sql` 新增 `must_change_password` 狀態。使用 `--temporary` 建立的帳號以臨時密碼登入後，會先前往 `/change-password.html` 建立新密碼；完成前，後端拒絕提供管理員訪客資料。新密碼須為 12～128 字元、兩次輸入一致，且不可與臨時密碼相同。成功後只儲存新密碼的加鹽雜湊、清除必須改密碼狀態並撤銷舊登入，瀏覽器取得新的 Session。沒有全站共用的預設密碼。

本機與正式資料庫各自獨立；兩邊都需要套用 migration、建立帳號。若兩邊各自建立相同帳號與臨時密碼，之後在某一環境設定新密碼，只更新該環境，不會自動同步另一邊。

## 帳號維護

```sh
node scripts/manage-user.mjs reset-password your-user --remote
node scripts/manage-user.mjs reset-password your-user --temporary --remote
node scripts/manage-user.mjs set-role your-user --role admin --remote
node scripts/manage-user.mjs disable your-user --remote
node scripts/manage-user.mjs enable your-user --remote
node scripts/manage-user.mjs revoke-sessions your-user --remote
```

上述操作皆會撤銷該帳號的既有登入。`create` 不會覆寫同名帳號；修改密碼使用 `reset-password`。只有具 Cloudflare 資料庫維護權限的人能執行這些指令。SQL 暫存檔只包含加鹽密碼雜湊，使用 0600 權限，執行後刪除；不要保存明文密碼到 Git、命令列參數或日誌。

`--temporary` 僅供 `create` 與 `reset-password` 使用；不加此選項時，設定的密碼可直接登入。角色調整、停用、啟用與撤銷 Session 不會改變必須改密碼狀態。

## 驗證與權限

- 密碼以 PBKDF2-SHA256（100,000 次、獨立隨機 salt）雜湊保存，不儲存明文。
- 登入建立隨機 256-bit session；D1 只保存 token 的 SHA-256 雜湊。
- Cookie 使用 HttpOnly、Secure、SameSite=Strict、Path=/，12 小時後到期；登出在伺服器撤銷 session。正式網站需 HTTPS。
- 每次查詢紀錄都由後端讀取帳號目前角色與停用狀態。沒有登入回 401，一般使用者回 403，前端修改角色或舊管理員密鑰均不會取得權限。
- 登入限制每帳號 5 次／15 分鐘、每來源 IP 30 次／15 分鐘；成功登入會清除該帳號的失敗計數。錯誤密碼與不存在帳號使用相同錯誤訊息。
- Auth API 與統計 API 不快取，也不寫入 PWA 離線快取。

端點：`POST /api/v1/auth/login`（JSON `{ username, password }`）、`GET /api/v1/auth/me`、`POST /api/v1/auth/logout`、`POST /api/v1/auth/change-password`（JSON `{ password, confirmPassword }`）。登入、目前帳號與密碼變更成功皆回應 `{ user }`；帳號包含 `id`、`username`、`role`、布林 `mustChangePassword`。密碼變更限已登入且必須改密碼的帳號，成功回應會更新 Session Cookie。請求使用同源 Cookie，勿把 session 存進 localStorage。變更角色只能透過可信任的維護工具，登入 API 不接受使用者指定的角色。
