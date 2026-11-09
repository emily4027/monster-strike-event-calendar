// 把 scrape.js / backfill.js 存下來的卡池資料套用到 pools.json，並寫出 PR 說明用的 Markdown。
//
// 執行：node scraper/apply-pools.js <卡池資料.json> <說明.md>
//   卡池資料：{ items: [{ event, data }], flags?: [{ event, source, message }] }
//   pools.json 有變動才會改寫；說明是空的代表沒有任何變動或需要確認的事
// GitHub Actions 會在 pools-update 分支上執行這支程式，再開 PR 給管理員確認 (見 scraper/pool-pr.sh)。
'use strict';

const fs = require('fs');
const path = require('path');
const { planPoolChanges, formatPoolsJson, describePoolChanges } = require('./pool-parse.js');

const POOLS_FILE = path.join(__dirname, '..', 'pools.json');

function main() {
    const [itemsFile, reportFile] = process.argv.slice(2);
    if (!itemsFile || !reportFile) {
        console.error('用法：node scraper/apply-pools.js <卡池資料.json> <說明.md>');
        process.exit(1);
    }
    const input = JSON.parse(fs.readFileSync(itemsFile, 'utf8'));
    const items = Array.isArray(input.items) ? input.items : [];
    const before = JSON.parse(fs.readFileSync(POOLS_FILE, 'utf8'));
    const result = planPoolChanges(before, items);
    result.flags.push(...(Array.isArray(input.flags) ? input.flags : []));

    if (result.changes.length > 0) fs.writeFileSync(POOLS_FILE, formatPoolsJson(result.data));
    fs.writeFileSync(reportFile, describePoolChanges(result));
    console.log(`卡池：${items.length} 篇公告，變動 ${result.changes.length} 筆，需要確認 ${result.flags.length} 項`);
}

main();
