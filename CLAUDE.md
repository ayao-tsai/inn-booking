# 循跡訂房（手機訂單 App）— 開發入口文件

每次開新對話先讀這份，再依任務讀相關程式碼。`tracover/index.html` 有八百多行而且每行很長，用 `grep` 找函式和章節，不要整份讀。

## 1. 這是什麼
民宿用的手機 App：訂房、入住登記、營收、來客分析，全家共用同一份雲端資料。
- **循跡文旅**（Ayao 自己的民宿）：已上線，App 在 `tracover/`。
- **海津&海町文旅**（媽媽家的民宿）：同一套程式，只有設定不同（見第 8 節），**還沒上線**。

使用的人是 Ayao 和家人（媽媽在櫃檯用手機），不是工程師。介面是繁體中文，**對話也一律用繁體中文回覆**。

本 repo 是公開的（GitHub Pages），**不能放任何真實訂單或旅客資料**，測試也只用假資料。

## 2. 架構
```
手機／電腦（PWA：tracover/index.html，資料先存 localStorage，可離線）
        │  POST text/plain JSON {token, action, …}，每分鐘＋切回 App 時同步
        ▼
Google Apps Script 網頁應用程式（Code.gs，/exec 網址，指令碼屬性 TOKEN＝同步密碼）
        │
        ▼
Google 試算表「循跡訂房資料」（tracover2025 帳號）：訂單／已取消／歷程／入住登記

另外：生活指揮所（另一個 repo）的 Worker 用同一個 /exec 呼叫唯讀動作 summary、changes。
```
- **前端**：單一檔案 `tracover/index.html`，原生 JS、一個 IIFE，沒有框架、**沒有 build 步驟**，改了就是上線的檔案。
- **離線**：`tracover/sw.js` 先連網、失敗才用快取（network-first），避免手機卡在舊版。
- **部署**：推上 `main` → GitHub Pages 自動發布，約 1 分鐘。
- **後端**：根目錄 `Code.gs`。部署在 tracover2025 帳號的 Apps Script 專案，**要手動貼上並部署新版本**（見第 4 節）。

## 3. 目錄
| 路徑 | 用途 |
|---|---|
| `tracover/index.html` | **App 本體，幾乎所有前端改動都在這裡** |
| `tracover/sw.js` | Service worker，快取名稱 `app-vNN-tracover` |
| `tracover/manifest.webmanifest`、圖示 | PWA 設定 |
| `tracover/同步設定說明.md` | 給家人看的同步設定步驟（新民宿上線時用） |
| `haijin/` | 海津&海町文旅的 App：`tracover/` 的複本，只有 `CFG`、標題、manifest、sw 快取名稱不同 |
| `Code.gs` | **Apps Script 後端的正本** |
| `test/server.mjs` | 後端測試（Node 裡模擬 Apps Script 執行 `Code.gs`） |
| `test/app.mjs` | 畫面測試（Playwright，假的同步後端） |
| `README.md` | 對外說明：唯讀 `summary` 動作 |

## 4. 發布流程
### 前端
1. 改 `tracover/index.html`。
2. **兩個版本號一起加一**：`index.html` 裡的 `APPV='vNN'`，以及 `sw.js` 的 `var C='app-vNN-tracover'`。只改一個的話，手機可能拿不到新版。
3. 跑測試（第 7 節）。
4. `git add -A && git commit`：訊息用繁體中文，結尾加上本次對話系統提示給的署名行。然後 `git push origin main`，直接推 main，不開 PR。
5. 確認部署：`gh api repos/ayao-tsai/inn-booking/deployments --jq '.[0].sha[0:7]'` 等於最新 commit，且 statuses 是 `success`。
6. 告訴 Ayao：到 App「設定」確認版本號，不對就按「更新」或把 App 完全關掉再開。

### 後端（Apps Script）
雲端沙盒連不到 `script.google.com`，只能透過 Ayao 電腦上的瀏覽器操作（tracover2025 帳號，在瀏覽器裡是 `/u/2/`），或請他自己貼。
1. 先改根目錄 `Code.gs`，跑 `node test/server.mjs`。
2. 部署用的版本跟 repo 有一處不同：專案是獨立的（不是掛在試算表下），所以要加 `var SHEET_ID = '…'`，並把 `SpreadsheetApp.getActiveSpreadsheet()` 換成 `SpreadsheetApp.openById(SHEET_ID)`。SHEET_ID 就是「循跡訂房資料」試算表網址裡的那串 ID，**不要寫進 repo**。
3. 在編輯器整份取代：`monaco.editor.getModels()[0].setValue(…)`，再按 Ctrl+S。換之前先比對 `^function` 清單，確認線上沒有 repo 沒有的函式。
4. 部署 → 管理部署作業 → 編輯（鉛筆）→ 版本選「建立新版本」→ 部署。看到「已成功更新部署作業」和新版號才算完成。**網址不變**，App 和生活指揮所都不用改設定。
   - 版本下拉選單常常點了沒選到：先打開選單，用 JS 找 `[role=option]`「建立新版本」的中心座標再點，點完確認欄位顯示「建立新版本」。
5. **後端要相容舊版 App**：家人的手機更新得很慢，新欄位一律選填，舊 App 送來缺欄位也要能存。

## 5. 前端結構（`tracover/index.html`）
章節索引：`grep -n "^/\* ---------- " tracover/index.html`。章節有：desktop（電腦版 CSS）、sample data、helpers、state、shell、guest analysis、calendar、day status、order detail、retention settings、order、check-in、revenue、sync、events。

- **設定區塊** `var CFG={…}` 到 `/*ENDCFG*/`：民宿名稱、localStorage 前綴 `key`、房間 `groups[].rooms`（`[號碼, 人數, 顏色, 名稱]`）、住客通知範本 `msg`（`types`、`tpl`）、預設填單方式 `flow`。**兩間民宿只差這一塊。**
- **房間代號** `k` = 群組 id＋房號，例如 `tc202`。後端 `Code.gs` 的 `ROOMS_` 要一致。
- **狀態**：`app`（`tab`、`y`／`m`、`sel` 選中的日期、`order` 填單中、`ci` 登記中、`checkId`…）、`bookings`、`regs`、`settings`（`keep` 保留回流客、`flow` 填單方式）。
- **繪製**：`render()` 依 `app.tab`（`cal`、`order`、`checkin`、`detail`、`rev`、`guests`、`settings`）呼叫 `viewXxx()`，直接寫 innerHTML。
- **事件**：`act` 物件，鍵是 `data-act`。輸入欄位用 `data-in`，由 document 的 input 監聽處理。縣市選單用 `data-city`，由 change 監聽處理。
- **一組客人**：`group(b)` 依姓名、電話、入住、退房把多間房合成一筆。登記資料掛在其中一筆的 id 上，用 `regFor(b)` 取。
- 常用函式：`gInfo`（金額、晚數）、`noticeText`（住客通知）、`prevReg`（找回流客上次的登記）、`cityOf`（地址→縣市）、`ageAt`（民國生日→年齡）、`purgeLocal`（手機端分段清除）。
- 電腦版：`min-width:1024px` 改成側邊選單。寬螢幕預設整頁填單（`WIDE`）。在房況、營收、來客頁按 ← → 可換月份。
- 日期一律是 `YYYY-MM-DD` 字串，生日用民國年（`by`／`bm`／`bd`）。**一週是週一到週日**。

## 6. 資料
### 訂單欄位
`id`（時間戳）、`room`、`who`、`phone`、`n` 人數、`from`／`to`、`price`（每晚）、`deposit`、`src`（電話、LINE、FB、Booking.com、Agoda、現場）、`note`、`checked` 已登記、`paid` 尾款已收、`deleted`、`updatedAt`、`bookedOn` 預訂日、`warn` ⚠ 注意事項。

### 手機 localStorage（前綴 `CFG.key`，循跡是 `tracover_data_v1`）
| 鍵 | 內容 |
|---|---|
| （前綴本身） | 訂單陣列 |
| `_sync` | `{url, token, last}` 同步設定 |
| `_dirty` | 還沒送上雲端的訂單 id |
| `_tomb` | 已刪除的訂單 |
| `_ciq` | 還沒送上雲端的入住登記（只增不改；`fix:true` 是補縣市用的，不會被清掉） |
| `_reg` | 入住登記，以訂單 id 為鍵 |
| `_set` | 設定（`keep`、`flow`） |
| `_fq` | 旅客要求刪除個資的電話，待送 |

### 試算表分頁
| 分頁 | 欄位 | 說明 |
|---|---|---|
| `訂單` | `BOOK_HEAD`（17 欄） | 只放有效訂單 |
| `已取消` | 同上 | |
| `歷程` | 時間、動作（新增／修改／取消／復原）、id、房間、姓名…、改了什麼 | 只增不改；`changes` 從這裡讀 |
| `入住登記` | `CI_HEAD`（17 欄）：…、`purpose`、`purposeNote`、`age`、`city`、`ci` | 每次登記或修改都新增一列，同一訂單取 `ts` 最新的那列 |

`sheet_()` 發現欄位比標題少時會自動補標題列，所以新增欄位只能**加在最後面**。

### 同步協定
- `action` 省略或 `sync`：`{rows, checkins, keep, forget}` → 回 `{ok, rows, regs}`。訂單以 `updatedAt` 較新者為準。
- `summary`（唯讀）：今天入住退房、空房、本月與未來 30 天的住房率和營收。
- `changes`（唯讀）：`{since:'YYYY-MM-DD HH:mm'}` → 歷程中的新增、取消、修改、復原。

### 個資保存（前後端各做一次）
- 退房滿 **6 個月**：刪除證件號碼和生日（同行旅客也是），刪之前先算好年齡和縣市。訂單上的姓名和電話依 `keep` 設定處理。
- 退房滿 **2 年**：登記只留 `checkout`、`ci`、`age`、`city`、`purpose`，給來客分析用。
- 後端由 `purgeOld` 處理，每天凌晨 3 點跑（`enableAutoPurge` 設定的觸發器）。

## 7. 測試
```
node test/server.mjs                                   # 後端：同步、歷程、新欄位、分段清除、summary／changes、縣市年齡判斷
PW_PATH=$(npm root -g)/playwright node test/app.mjs    # 畫面：手機與電腦版主要流程、320／390／1440 寬不溢出
```
- 不用 `npm install`。`app.mjs` 用全域安裝的 Playwright（`PW_PATH`），Chromium 預設用 Playwright 內建的，要指定就設 `PW_CHROME`。
- `app.mjs` 把同步網址設成 `https://x.test/exec`，用 `page.route` 回應，假後端會記住推上來的訂單和登記。時鐘固定在 2026-11-15 15:00（台北）。
- 新功能要在 `app.mjs` 加一段斷言，後端改動要在 `server.mjs` 加。
- 視覺改動另外用 Playwright 截 390 寬和電腦寬的圖親眼看過，必要時把圖送給 Ayao。

## 8. 海津&海町文旅
- 跟循跡的差別只在 `CFG`：`flow:'one'`（媽媽偏好整頁填寫）、`name:'海津&海町文旅'`、`key:'hjhm_data_v1'`、兩個群組：
  - 海津 `js`：101（4 人）、201（4）、202（6）、203（2）
  - 海町 `ht`：101（4）、102（2）、201（4）、202（4）、203（4）
  - 住客通知範本還沒提供。
- 程式在 `haijin/`（`APPV='v1'`、快取名稱 `app-v1-haijin`）。**循跡改了功能後，把 `tracover/index.html` 複製過去，只重換 `/*CFG*/` 到 `/*ENDCFG*/` 之間、`<title>`、`apple-mobile-web-app-title`，`manifest`、`sw.js` 的名稱和快取名稱照舊。** 還沒上線：試算表和 Apps Script 要建在媽媽的 Google 帳號，`Code.gs` 的 `ROOMS_` 換成 `haijin/同步設定說明.md` 裡的那份，家人帳號開共用。
- 房間代號：`js101`…、`ht101`…。住客通知範本還沒提供，所以 `CFG` 沒有 `msg`（畫面上就不會出現「複製住客通知」）。
- `test/app.mjs` 目前只測 `tracover/`；`haijin/` 只做過手機 320／390、電腦 1440 的開啟與填單頁房間檢查。
- 改了循跡的功能，之後要帶到海津&海町時，只需要換 `CFG`，不要分岔改兩套。

## 9. 工作慣例
- **回覆用繁體中文**，說明時講「畫面上會看到什麼」，不講程式細節。
- **視覺改動先給示意圖**（Playwright 截 PNG 送出），等 Ayao 選定再做。小修正和邏輯 bug 直接做。
- 風格：日式職人，沿用既有的奶油底、墨色、房間色（藍徑 `#1A72A6`、夕映 `#B4521F`、山嵐 `#4F6347`）。安靜、不擁擠。手機按鈕要大、字要大，給長輩用。
- 欄位取捨看資訊價值，不因為「填起來麻煩」就砍。
- 每次改版：手機 390／320 寬、電腦寬都不溢出，兩個版本號一起加，測試通過才推。
- **除錯不讀旅客個資**：要查雲端資料時，只統計欄位有沒有填、比對是否相同。例如在試算表頁面用 `gviz/tq?tqx=out:csv&tq=select A,C,M` 只抓需要的欄位，輸出時遮掉電話和姓名。
- **「按了沒反應」先懷疑舊版**：看「入住登記」分頁的 `ci` 欄。新版 App 每次登記一定會填這欄，空白就代表是舊版 App 寫的。
- 做錯成本高、需求又不清楚時，先用選擇題問。需求清楚就直接做。

## 10. 文件維護
- 新增資料欄位、同步動作、localStorage 鍵、重要函式或慣例時，**在同一次 commit 順手更新本檔**。
- 本檔只寫穩定的地圖，不寫進度與待辦。
- 章節位置用 `grep` 指引，不寫行號。
