// 把 scrape.js / backfill.js 存下來的卡池資料套用到 pools.json，並寫出 PR 說明用的 Markdown。
//
// 執行：node scraper/apply-pools.js <卡池資料.json> <說明.md>
//   卡池資料：{ items: [{ event, data }], flags?: [{ event, source, message }] }
//   pools.json 有變動才會改寫；說明是空的代表沒有任何變動或需要確認的事
// GitHub Actions 會在 pools-update 分支上執行這支程式，再開 PR 給管理員確認 (見 scraper/pool-pr.sh)。
'use strict';

const fs = require('fs');
const path = require('path');
const { planPoolChanges, formatPoolsJson, describePoolChanges, mergeElements } = require('./pool-parse.js');

const POOLS_FILE = path.join(__dirname, '..', 'pools.json');
const OVERRIDES_FILE = path.join(__dirname, 'name-overrides.json');
const ELEMENTS_FILE = path.join(__dirname, '..', 'elements.json');

function main() {
    const [itemsFile, reportFile] = process.argv.slice(2);
    if (!itemsFile || !reportFile) {
        console.error('用法：node scraper/apply-pools.js <卡池資料.json> <說明.md>');
        process.exit(1);
    }
    const input = JSON.parse(fs.readFileSync(itemsFile, 'utf8'));
    const items = Array.isArray(input.items) ? input.items : [];
    const before = JSON.parse(fs.readFileSync(POOLS_FILE, 'utf8'));
    const overrides = fs.existsSync(OVERRIDES_FILE) ? JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8')) : {};
    const result = planPoolChanges(before, items, overrides);

    // 屬性表 (角色名稱的顏色用)：公告讀到的屬性加進 elements.json
    const elementsData = fs.existsSync(ELEMENTS_FILE) ? JSON.parse(fs.readFileSync(ELEMENTS_FILE, 'utf8')) : {};
    const merged = mergeElements(elementsData.elements, items, result.data, overrides);
    result.flags.push(...merged.flags);
    if (merged.added > 0) {
        const note = elementsData['說明'] || '角色名稱 → 屬性 (火水木光闇)，網頁用來替角色名稱上色。爬蟲從官網公告的屬性欄和文字顏色整理；可以手動修改或新增，已經有的不會被爬蟲覆蓋。';
        fs.writeFileSync(ELEMENTS_FILE, JSON.stringify({ '說明': note, elements: merged.elements }, null, 2) + '\n');
    }
    result.flags.push(...(Array.isArray(input.flags) ? input.flags : []));

    if (result.changes.length > 0) fs.writeFileSync(POOLS_FILE, formatPoolsJson(result.data));
    fs.writeFileSync(reportFile, describePoolChanges(result)
        + (merged.added > 0 ? `### 屬性表\n\n- 新增 ${merged.added} 個角色的屬性（elements.json）\n` : ''));
    console.log(`卡池：${items.length} 篇公告，變動 ${result.changes.length} 筆，屬性新增 ${merged.added} 個，需要確認 ${result.flags.length} 項`);
}

main();
