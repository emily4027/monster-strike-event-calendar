# 🗂️ 怪物彈珠 - 轉蛋資料庫 (Monster Strike Gacha Data)

[抽卡統計](https://github.com/emily4027/monster-strike-gacha)的附屬工具：維護抽卡統計用的**活動清單**和**卡池**資料，並用月曆和角色總覽檢視自己的抽卡紀錄。

👉 網址：https://emily4027.github.io/monster-strike-gacha-data/

> 目前是測試版。由「活動行事曆」和「角色圖鑑」兩個測試版工具合併而成。

| 頁面 | 內容 |
|------|------|
| 📅 行事曆（`index.html`） | 月曆查看轉蛋活動、每場活動投入的抽數、這期卡池抽到了誰 |
| 📖 角色（`characters.html`） | 所有帳號抽到的角色總覽、卡池標記；管理員的角色名稱修正 |

兩頁共用登入狀態。網頁只讀取抽卡紀錄，**唯一會寫入的是管理員的名稱修正**（`shared/characters`）。

---

## ✨ 主要功能

### 📅 行事曆
- **桌機**：一格一天的月曆。有結束日的活動畫成橫跨多天的長條，跨週的活動會接到下一週；只有開始日的活動（舊資料）是白底加色條的小標籤，只標在開始那天。
- **手機**：改成依日期排列的清單，進行中的活動有「進行中」標記。
- 上方可以切換月份（也可以用鍵盤左右鍵），按「今天」回到本月。標籤顏色和抽卡統計一樣：本家紅、合作紫、免費綠、寶珠黃。
- **我的抽數**：登入時讀抽卡統計的雲端紀錄，沒有登入時讀這台電腦上的本機紀錄。每個活動顯示合計抽數；帳號選單可以只看某個帳號（選擇會記在這台電腦）。活動改過名稱時，舊名稱的紀錄也會算進去。
- **點活動**看詳細：期間、官網公告連結（爬蟲加的活動才有）、**這期卡池**（抽到的角色標 ✓ 和數量，點角色會到角色頁）、各帳號的抽數與抽到的角色。

### 📖 角色
- **角色總覽**：每個角色名稱一列，顯示總數與最近抽到的日期；點開後列出每個帳號抽到的數量、活動與日期。**點活動名稱會到行事曆那個月並打開那個活動**。
- **卡池標記**：限定角色標出它的常設轉蛋活動（例如「限定：激獸神祭」），在合作活動抽到的角色標出那場活動，常駐角色不標。「卡池」選單可以只看限定、合作、常駐或某個限定卡池。
- **帳號切換**、**搜尋**、**活動類型篩選**（本家 / 合作 / 免費）、依最近抽到 / 數量 / 名稱排序。
- **疑似相同**：名稱字數相同、只差一個中文字的角色（例如「羌廆」和「羌瘣」）會標上提示。不會自動合併，由管理員確認。
- **管理員：名稱修正**（抽卡統計的管理員帳號，登入後名稱旁邊顯示「管理員」）：展開角色後有管理員區塊。
  - **改成這個名稱**：把寫錯的名稱顯示成正確名稱，改成已經存在的名稱就會合併成同一列，可以「取消修正」。
  - **疑似相同**：選「X 打錯了，改成 Y」（合併）或「是不同角色」（之後不再提示，可以取消）。
  - 修正存在 Firestore `shared/characters`，**所有人都會看到**。每個人下次打開抽卡統計時，自己紀錄裡的舊名稱會改成新名稱；果實分配「從抽卡統計匯入」時也讀這份修正。**取消修正不會把紀錄改回來**。

### 抽卡統計的角色按鈕（資料來自這裡）
在抽卡統計選好活動後，「獲得角色」下面會列出這期卡池的角色按鈕（限定卡池、合作卡池），點一下加 1 隻。資料是這個 repo 的 `pools.js` 和 `pools.json`。

### 角色名稱的整理規則
和果實分配從抽卡統計匯入時的規則相同：
- 「獲得角色」以頓號、逗號、空白或加號分隔，`亞森*2` 算 2 隻。寶珠紀錄略過，「3抽」「11顆」「無」、單獨的數字不算角色。
- 名稱最後的果實分配註記「(同族)」「（戰型）」「(擊種)」「(雙削)」和「虹夏-2」這種同名編號會拿掉。
- 其餘名稱要完全相同才算同一隻。和官網名稱比對時，只忽略空白、間隔號、全形半形、大小寫與結尾標點；寫法相近但不同的名稱（例如「尼奧」和「妮奧」）不會自動當成同一隻。

---

## 🤖 爬蟲（每天中午）

每天台灣時間中午 12:00，GitHub Actions 讀[官網公告](https://www.monster-strike.com.tw/news/)，做兩件事：

### 1. 新的轉蛋活動 → 活動清單（直接寫入）
- **怎麼判斷是轉蛋活動**：公告的標題或內文有「轉蛋「名稱」」或「「名稱」轉蛋」的寫法，而且有「▼轉蛋活動期間」或「▼活動期間」。「禮物轉蛋」「轉蛋小龍Lab.」不算（`scraper/parse.js` 的 `EXCLUDE_KEYWORDS`）。
- **名稱**：`YYYY-MM月 轉蛋名稱`；**期間**取自公告；**標籤**：標題有「×怪物彈珠」「合作」→ 合作，標題或名稱有「免費」「登入」「無料」→ 免費，其他當本家，不會自動標寶珠。
- **不重複、只新增**：處理過的公告（`source` 網址相同，或記在 `scraper/seen.json`）跳過，被管理員刪掉的活動不會再加回來。清單裡已經有「同一天開始、名稱互相包含」的活動時，只補上缺少的結束日和公告網址。在交易裡讀最新清單後合併寫入，有變動時記在 `scraper/log.md`。
- **抓不到的**：官網沒有另外發公告的轉蛋（例如部分免費轉蛋），仍要在抽卡統計手動新增。

### 2. 這期卡池 → `pools.json`（開 PR 給管理員確認）
- **祭典等本家轉蛋**：公告表格「「X」限定角色」「轉出對象限定角色」「轉出對象期間限定角色」底下的角色。
- **合作活動**：標題有「轉蛋「作品名」」的段落裡的角色表，只收稀有度「**★6（獸神化前）**」的角色（冒險、新手禮包、任務獎勵的角色不收）。
- **每期一個版本**：限定卡池加一個 `since` 為活動年月的新版本，不改舊版本（例如 2024-09 的綠色幻想有西王母、圖坦卡門，2026-11 的沒有）。名單和這期原本會用的版本一樣時不加。合作卡池依「年-月月+作品名」對應單一期活動，名單不同時直接改那一筆。
- **PR**：有變動時在 `pools-update` 分支開一個 PR，說明裡列出每個卡池多了誰、少了誰。看過沒問題按 **Merge pull request** 就生效（抽卡統計和這個網站幾分鐘內就會讀到）；有錯就關掉 PR，或留言 / 告訴 Claude 要改哪裡。PR 還沒處理時，之後的變動會接在同一個 PR 裡。
- **需要確認或手動處理**（列在 PR 說明；沒有任何變動時開成 issue）：
  - 名稱和既有角色只差一個字（不會自己判斷成同一隻）、卡池裡沒出現過的新名稱
  - 名單黏在一起（官網漏了分隔，例如「麻穗呂芭波菈里絲」）：能用已知名稱拆開就拆開並標出來，拆不開就照原樣
  - 新的卡池（新的合作作品、新的祭典）：請確認卡池名稱
  - 找不到「★6（獸神化前）」、公告格式不同、一篇公告有好幾個轉蛋段落（例如合作祭典和合作轉蛋同時開）、同一個月已經有不同名單的版本：不寫入，只列出來

### 歷史卡池回補（一次性）
Actions → 抓取轉蛋公告 → Run workflow，勾選「歷史卡池回補」（起始日預設 2023-09-01）。會從官網公告列表往回翻，用同一套規則讀每一期公告，對應到活動清單裡的活動後集中開成一個 PR。活動清單裡對不上公告的活動會列在 PR 說明裡（不會用猜的）。只更新卡池，不改活動清單。

### 失敗時
官網連不上、或公告列表一篇都讀不到（版面改了）時，workflow 會失敗，GitHub 會寄信通知。

---

## 🔧 爬蟲設定（只需要做一次）

1. **Firebase 金鑰**：到 [Firebase 主控台](https://console.firebase.google.com/) → 專案 `ms-toolbox-web` → ⚙️ 專案設定 → **服務帳戶** → **產生新的私密金鑰**。到這個 repo 的 **Settings → Secrets and variables → Actions → New repository secret**，Name 填 `FIREBASE_SERVICE_ACCOUNT`，Secret 貼上 JSON 檔的**全部內容**。存好後把 JSON 檔刪掉（這把金鑰可以讀寫整個資料庫，不要放進 repo）。
2. **允許開 PR**：**Settings → Actions → General → Workflow permissions**，勾選「**Allow GitHub Actions to create and approve pull requests**」，按 Save。
3. 到 **Actions → 抓取轉蛋公告 → Run workflow** 手動執行一次，確認成功。

GitHub 的排程常常會晚幾分鐘到幾十分鐘，不會剛好 12:00 整。

想先看看會新增什麼，不寫入任何地方：

```bash
cd scraper
npm install
node scrape.js --dry-run --pool-items pool-items.json
node apply-pools.js pool-items.json pool-report.md   # 會改 pools.json，看完記得還原
```

---

## 🗂️ 卡池資料 `pools.json`

```json
{
  "pools": [
    { "pool": "彩獸神祭", "kind": "limited", "chars": ["卡蜜菈", "九十九"] },
    { "pool": "彩獸神祭", "kind": "limited", "since": "2026-11", "source": "官網公告網址", "chars": ["卡蜜菈", "九十九", "馬克士威"] },
    { "pool": "怪物彈珠世代 2015", "kind": "limited", "match": ["世代+2015"], "chars": ["卑彌呼"] },
    { "pool": "藍色監獄", "kind": "collab", "match": ["2026-11月+藍色監獄"], "source": "官網公告網址", "chars": ["糸師 凜"] }
  ]
}
```

| 欄位 | 說明 |
|------|------|
| `pool` | 卡池名稱，顯示在按鈕上方 |
| `kind` | `limited`：常設轉蛋活動的限定角色；`collab`：合作活動的角色 |
| `match` | 選填。活動名稱含有其中一組的**全部**關鍵字（用 `+` 連接）就算這個卡池；省略時用卡池名稱。比對時忽略空白、間隔號、全形半形、大小寫。合作卡池用「年-月月+作品名」，同一作品有好幾彈時靠年月區分 |
| `since` | 選填，`"YYYY-MM"`。同名卡池可以有好幾個版本：每期活動用 `since` 不晚於活動年月（活動名稱開頭的「2026-11月」）的最新版本；沒有 `since` 的是預設版本，活動比所有版本都早時使用 |
| `chars` | 角色名稱，照台版官網寫法 |
| `source` | 選填，資料來源網址 |

- 限定角色的預設版本整理自台版官網的[限定角色名單大檢閱](https://www.monster-strike.com.tw/tips/20260609_ch.html)（2026-06-23 版）。
- 一個卡池一行。手動修改後執行 `node --test tests/`，會檢查格式，並用抽卡統計實際的活動名稱確認對到哪些卡池。
- 合作卡池排在限定卡池前面（例如「超獸神祭×鬼滅之刃」先列鬼滅之刃的角色，再列超獸神祭的限定角色）。

---

## 🧩 開發筆記

純靜態 HTML + CSS + Vanilla JS，沒有建置工具。

| 檔案 | 內容 |
|------|------|
| `index.html`、`script.js`、`calendar.js` | 📅 行事曆。`calendar.js` 是日期計算、月曆排版、抽數彙總的純函式（`window.CalendarCore`） |
| `characters.html`、`characters.js`、`characters.css`、`catalog.js` | 📖 角色。`catalog.js` 是角色總覽的純函式（`window.Catalog`） |
| `firebase.js` | Firebase 初始化（兩頁共用） |
| `common.js` | 兩頁共用：讀取資料、登入、管理員判斷、懸浮工具箱（`window.Shared`） |
| `style.css` | 兩頁共用的樣式和行事曆的樣式 |
| `pools.js`、`pools.json` | 卡池與名稱修正的純函式（`window.CharacterPools`）和卡池資料。**抽卡統計也載入這兩個檔案** |
| `scraper/parse.js`、`scraper/scrape.js` | 爬蟲：公告解析與活動清單合併、主程式 |
| `scraper/pool-parse.js`、`scraper/apply-pools.js`、`scraper/pool-pr.sh`、`scraper/backfill.js` | 爬蟲的卡池部分：公告 → 卡池變動、套用到 `pools.json`、開 PR、歷史回補 |
| `tests/` | 自動化測試 |

### 資料來源

| 資料 | 位置 | 說明 |
|------|------|------|
| 活動清單 | Firestore `shared/events` | 所有人可讀。讀不到時改讀抽卡統計的 `/monster-strike-gacha/events.json` |
| 抽卡紀錄（登入） | `artifacts/{appId}/users/{uid}/data/gacha_records` | 只讀。抽卡統計和果實分配有版本檢查的寫入規則，這裡**絕對不寫入** |
| 抽卡紀錄（未登入） | localStorage `gachaRecords` | 抽卡統計的本機紀錄（同網域共用） |
| 卡池 | 這個 repo 的 `pools.json` | 用 `cache: 'no-cache'` 讀，避免 GitHub Pages 快取 10 分鐘讀到舊版 |
| 名稱修正 | Firestore `shared/characters` | 所有人可讀、管理員可寫（見下面） |
| 管理員名單 | Firestore `admins/{uid}` | 存在即為管理員，和抽卡統計共用 |

活動欄位：`event`（名稱）、`date`（開始日）、`endDate`（選用，結束日）、`tag`、`aliases`（選用，舊名稱）、`source`（選用，爬蟲記錄的公告網址）。格式詳見[抽卡統計的 README](https://github.com/emily4027/monster-strike-gacha#eventsjson-格式)。

### 和抽卡統計、果實分配的關係
- 抽卡統計從同網域的 `/monster-strike-gacha-data/pools.js` 與 `pools.json` 讀取卡池。`pools.js` 的 `readPools`、`poolsForEvent` 改名或改參數、`pools.json` 改格式時，**抽卡統計要一起改**。讀不到時抽卡統計只是不顯示角色按鈕。
- 名稱解析規則三邊要一致：`pools.js` 的 `resolveName`、抽卡統計 `notes.js` 的 `renameCharacters`、果實分配的 `fixGachaName`。
- `catalog.js` 的 `parseGachaCharacters`、`CHARACTER_TAG_RE`、`baseNameOf` 照抄果實分配 `script.js`，**改動時三邊要一起確認**。

### 名稱修正 `shared/characters`

```json
{
  "renames": [{ "from": "羌廆", "to": "羌瘣" }],
  "distinct": [{ "a": "杏子", "b": "杏仁" }],
  "updatedAt": "伺服器時間"
}
```

- `renames`：`from` 顯示成 `to`，可以連續修正（A→B→C）；會繞回自己的修正會被擋下。`distinct`：確認是不同角色的兩個名稱。
- 管理員存檔時在 transaction 裡讀最新的文件再套用修改（`pools.js` 的 `applyNameFix`）。
- Firestore 規則：

```
match /shared/{docId} {
  allow read: if true;
  allow write: if request.auth != null && exists(/databases/$(database)/documents/admins/$(request.auth.uid));
}
```

### 本地開發
要在 `Monster-Strike` 這一層資料夾開伺服器，`/monster-strike-gacha/events.json` 的路徑才會和線上一樣。Firebase 登入要用 `localhost`，不要用 `127.0.0.1`。

```bash
cd "E:/Computer Science/Github/Monster-Strike"
jwebserver -p 8000     # 然後開啟 http://localhost:8000/monster-strike-gacha-data/
```

### 自動化測試
需要 Node.js 18 以上，不用安裝任何套件：

```bash
node --test tests/
```

---

## 🧰 正式上線時

1. 工具箱 `monster-strike-toolbox/tools.js` 的 `MS_TOOLS` 加一筆（`parent: 'gacha'`：首頁不顯示卡片，懸浮選單照樣列出）：
   ```js
   {
       id: 'gacha-data',
       name: '轉蛋資料庫',
       description: '抽卡統計的附屬工具：活動行事曆、卡池與抽到的角色。',
       url: 'https://emily4027.github.io/monster-strike-gacha-data/',
       emoji: '🗂️',
       color: '#ef6c00',
       bg: '#fff3e0',
       parent: 'gacha',
   },
   ```
2. 抽卡統計、果實分配加入口連結；它們的 `index.html` 裡寫死的懸浮工具箱連結（讀不到 `tools.js` 時用的）各補一個。
3. `CHANGELOG.md` 的「未發布 - 測試版」改成 `[1.0.0]` 和上線日期。

## 💡 之後的功能

- 從活動直接跳到抽卡統計，新增那場活動的紀錄。
- 和果實分配整合：顯示果實已分配 / 已完成。

---

## ⚖️ 版權聲明

本網站為非官方的粉絲製作工具，與遊戲官方無關。《怪物彈珠》（モンスターストライク）相關名稱、角色與商標之著作權均屬 © mixi 及各權利人所有。活動與卡池資料整理自[台版官網](https://www.monster-strike.com.tw/news/)的公告；網站不使用任何官方圖片。本工具由 AI 協助撰寫。
