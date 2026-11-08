# 📅 怪物彈珠 - 活動行事曆 (Monster Strike Event Calendar)

用月曆查看怪物彈珠的轉蛋活動（本家、合作、免費、寶珠）。登入後，每個活動會顯示「我投入了幾抽、抽到了誰」。

👉 網址：https://emily4027.github.io/monster-strike-event-calendar/

> 目前是測試版，還沒有連到工具箱首頁。

---

## ✨ 主要功能

### 🗓 月曆
- **桌機**：一格一天的月曆。有結束日的活動畫成橫跨多天的長條，跨週的活動會接到下一週；只有開始日的活動（舊資料）是白底加色條的小標籤，只標在開始那天。
- **手機**：改成依日期排列的清單，進行中的活動有「進行中」標記。
- 上方可以切換月份（也可以用鍵盤左右鍵），按「今天」回到本月。
- 標籤顏色和抽卡統計一樣：本家紅、合作紫、免費綠、寶珠黃。

### 🎰 我的抽數
- **登入 Google**：讀取抽卡統計的雲端紀錄，每個活動顯示所有帳號合計的抽數。
- **沒有登入**：如果這台電腦上有使用過抽卡統計（沒有登入時的本機紀錄），也會顯示抽數；沒有的話只顯示活動。
- 點活動可以看各帳號的抽數與抽到的角色，以及官網公告連結（爬蟲加的活動才有）。
- 可以用帳號選單只看某個帳號，選擇會記在這台電腦。
- 活動改過名稱時，用舊名稱記的紀錄也會算進去（依活動清單的 `aliases`）。

### 🤖 自動新增活動（爬蟲）
每天台灣時間中午 12:00，GitHub Actions 會抓[官網公告](https://www.monster-strike.com.tw/news/)，把新的轉蛋活動加進活動清單。

- **怎麼判斷是轉蛋活動**：公告的標題或內文有「轉蛋「名稱」」或「「名稱」轉蛋」的寫法，而且有「▼轉蛋活動期間」或「▼活動期間」。販售期間、BGM 變更期間等不算。「禮物轉蛋」「轉蛋小龍Lab.」不算轉蛋活動（可在 `scraper/parse.js` 的 `EXCLUDE_KEYWORDS` 調整）。
- **名稱**：`YYYY-MM月 轉蛋名稱`，例如 `2026-11月 銀河冒險 II`。
- **期間**：開始日與結束日取自公告的期間。官網寫 `11月14日 11:59` 結束，結束日就記 `11-14`。
- **標籤**：標題有「×怪物彈珠」「合作」→ 合作；標題或名稱有「免費」「登入」「無料」→ 免費；其他都當本家。不會自動標寶珠。
- **不重複**：已經處理過的公告（`source` 網址相同，或記在 `scraper/seen.json`）會跳過，所以活動被管理員刪掉後不會再加回來。清單裡已經有「同一天開始、名稱互相包含」的活動時，視為同一場，只補上缺少的結束日和公告網址，不改名稱、日期和標籤。
- **只新增，不刪除也不覆蓋**：在交易（transaction）裡讀取最新清單後合併寫入。
- **有變動時**會在 `scraper/log.md` 記下新增了什麼，並 commit 回這個 repo（也讓 repo 保持有動靜，GitHub 才不會因為 60 天沒活動停用排程）。
- **抓不到的**：官網沒有另外發公告的轉蛋（例如部分免費轉蛋）抓不到，仍要在抽卡統計手動新增。名稱或標籤判斷錯了，也是到抽卡統計的管理員介面修改。
- **失敗時**：官網連不上、或公告列表一篇都讀不到（版面改了）時，workflow 會失敗，GitHub 會寄信通知。

---

## 🔧 爬蟲設定（只需要做一次）

爬蟲要寫入 Firestore 的 `shared/events`，需要一把 Firebase service account 金鑰：

1. 到 [Firebase 主控台](https://console.firebase.google.com/) → 專案 `ms-toolbox-web` → ⚙️ 專案設定 → **服務帳戶** → **產生新的私密金鑰**，會下載一個 JSON 檔。
2. 到這個 repo 的 **Settings → Secrets and variables → Actions → New repository secret**：
   - Name：`FIREBASE_SERVICE_ACCOUNT`
   - Secret：貼上剛剛 JSON 檔的**全部內容**
3. 存好後把下載的 JSON 檔刪掉。這把金鑰可以讀寫整個資料庫（不受安全規則限制），不要放進 repo、不要傳給別人。
4. 到 **Actions → 抓取轉蛋公告 → Run workflow** 手動執行一次，確認成功。

之後每天會自動執行。GitHub 的排程常常會晚幾分鐘到幾十分鐘，不會剛好 12:00 整。

想先看看會新增什麼，不寫入任何地方：

```bash
cd scraper
npm install
node scrape.js --dry-run
```

試跑時活動清單讀的是抽卡統計網站上的 `events.json`，所以結果可能和雲端清單有一點差異。

---

## 🧩 開發筆記

**資料來源（網頁只讀，不寫入任何雲端文件）**

| 資料 | 位置 | 說明 |
|------|------|------|
| 活動清單 | Firestore `shared/events` | 所有人可讀。讀不到時改讀抽卡統計的 `/monster-strike-gacha/events.json`（同網域，不另外複製） |
| 抽卡紀錄（登入） | `artifacts/{appId}/users/{uid}/data/gacha_records` | 只有本人可讀。抽卡統計和果實分配有寫入的版本檢查規則，行事曆**絕對不寫入** |
| 抽卡紀錄（未登入） | localStorage `gachaRecords` | 抽卡統計的本機紀錄（同網域共用） |

活動欄位：`event`（名稱）、`date`（開始日）、`endDate`（選用，結束日）、`tag`、`aliases`（選用，舊名稱）、`source`（選用，爬蟲記錄的公告網址）。格式詳見[抽卡統計的 README](https://github.com/emily4027/monster-strike-gacha#eventsjson-格式)。

**程式結構**
- `calendar.js`：日期計算、月曆排版、抽數彙總等純函式（`window.CalendarCore`），有自動化測試。
- `script.js`：讀取資料、畫面、登入。使用者或資料庫來的文字一律用 `textContent` 輸出。
- `scraper/parse.js`：官網公告的解析與合併（純函式），有自動化測試。
- `scraper/scrape.js`：爬蟲主程式（連網路、寫 Firestore）。

**本地開發**：要在 `Monster-Strike` 這一層資料夾開伺服器，`/monster-strike-gacha/events.json` 的路徑才會和線上一樣：

```bash
cd "E:/Computer Science/Github/Monster-Strike"
jwebserver -p 8000     # 然後開啟 http://localhost:8000/monster-strike-event-calendar/
```

Firebase 登入要用 `localhost`，不要用 `127.0.0.1`。

**自動化測試**：需要 Node.js 18 以上，不用安裝任何套件：

```bash
node --test tests/
```

---

## 🧰 正式上線時

1. 工具箱 `monster-strike-toolbox/tools.js` 的 `MS_TOOLS` 加一筆：
   ```js
   {
       id: 'calendar',
       name: '活動行事曆',
       description: '用月曆查看轉蛋活動與自己的抽數。',
       url: 'https://emily4027.github.io/monster-strike-event-calendar/',
       emoji: '📅',
       color: '#ef6c00',
       bg: '#fff3e0',
   },
   ```
2. 果實分配、抽卡統計、羈絆場次 `index.html` 裡寫死的懸浮工具箱連結（讀不到 `tools.js` 時用的）各補一個。
3. `CHANGELOG.md` 的「未發布 - 測試版」改成 `[1.0.0]` 和上線日期。

## 💡 之後的功能

- 從活動直接跳到抽卡統計，新增那場活動的紀錄。

---

## 📂 檔案結構

```
.
├── index.html                  # 介面、Firebase SDK 載入
├── style.css                   # 樣式
├── calendar.js                 # 日期與排版的純函式
├── script.js                   # 讀取資料、畫面、登入
├── scraper/
│   ├── parse.js                # 公告解析與合併 (純函式)
│   ├── scrape.js               # 爬蟲主程式
│   ├── seen.json               # 處理過的轉蛋公告網址
│   ├── log.md                  # 爬蟲新增紀錄
│   └── package.json            # firebase-admin
├── .github/workflows/scrape.yml  # 每天中午執行爬蟲
├── tests/                      # 自動化測試 (node --test tests/)
├── CHANGELOG.md
└── README.md
```

## 🛠 技術架構

- HTML5、CSS3、Vanilla JavaScript，無建置工具
- Bootstrap 5.3.3、Bootstrap Icons 1.11.3
- Firebase 11.6.1（Authentication、Firestore），和其他工具同一個專案 `ms-toolbox-web`
- 爬蟲：Node.js 22、firebase-admin、GitHub Actions

## 📝 授權與備註

- 本專案為非官方粉絲製作工具，與 MIXI 無直接關聯。活動資料來自[官網公告](https://www.monster-strike.com.tw/news/)。
- 本工具由 AI 協助撰寫。
