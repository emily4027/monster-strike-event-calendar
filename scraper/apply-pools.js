// 把 scrape.js / backfill.js 存下來的卡池資料套用到 pools.json 和角色名冊 (characters.json)，並寫出 PR 說明用的 Markdown。
//
// 執行：node scraper/apply-pools.js <卡池資料.json> <說明.md>
//   卡池資料：{ items: [{ event, data }], flags?: [{ event, source, message }] }
//   檔案有變動才會改寫；說明是空的代表沒有任何變動或需要確認的事
// GitHub Actions 會在 pools-update 分支上執行這支程式，再開 PR 給管理員確認 (見 scraper/pool-pr.sh)。
//
// pools.json 的 chars 是名冊的編號。pool-parse.js 內部用名稱比對，所以這裡讀檔時把編號換成名稱、
// 寫檔時換回編號；名冊沒有的名稱 (新角色) 在寫檔時編新的編號。屬性也記在名冊裡。
'use strict';

const fs = require('fs');
const path = require('path');
const { planPoolChanges, formatPoolsJson, describePoolChanges, mergeElements } = require('./pool-parse.js');
const R = require('./roster.js');

const POOLS_FILE = path.join(__dirname, '..', 'pools.json');
const ROSTER_FILE = path.join(__dirname, '..', 'characters.json');
const OVERRIDES_FILE = path.join(__dirname, 'name-overrides.json');

const readText = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

// 純函式：{ pools (編號), roster, overrides (name-overrides.json), items } → 要寫的內容與說明
function applyPools({ pools, roster, overrides, items, flags }) {
    const problems = R.indexRoster(roster).problems;
    if (problems.length) throw new Error('角色名冊有問題：\n' + problems.join('\n'));
    const fromRoster = R.rosterOverrides(roster);
    const all = {
        ...(overrides || {}),
        global: { ...fromRoster.global, ...((overrides && overrides.global) || {}) },
        pools: { ...fromRoster.pools, ...((overrides && overrides.pools) || {}) }
    };
    const result = planPoolChanges(R.poolsToNames(pools, roster), items, all);
    const merged = mergeElements(R.rosterElements(roster), items, result.data, all);
    const withElements = R.applyElements(roster, merged.elements);
    const converted = R.poolsToIds(result.data, withElements.data);
    result.flags.push(...merged.flags, ...(Array.isArray(flags) ? flags : []));

    const added = [...converted.added, ...withElements.added];
    const lines = [];
    if (added.length) {
        lines.push('### 角色名冊', '', `- 新角色 ${added.length} 個（characters.json 編了新的編號；如果其實是既有角色的另一種寫法，請不要 Merge，告訴 Claude 是哪一隻）`);
        added.forEach((a) => lines.push(`  - ${a.id} ${a.name}${a.pool ? `（${a.pool}）` : ''}`));
    }
    if (withElements.filled) lines.push(...(added.length ? [] : ['### 角色名冊', '']), `- 補上 ${withElements.filled} 個角色的屬性`);
    return {
        poolsText: formatPoolsJson(converted.pools),
        rosterText: R.formatRoster(converted.data),
        report: describePoolChanges(result) + (lines.length ? lines.join('\n') + '\n' : ''),
        changes: result.changes.length, added: added.length, flags: result.flags.length
    };
}

function main() {
    const [itemsFile, reportFile] = process.argv.slice(2);
    if (!itemsFile || !reportFile) {
        console.error('用法：node scraper/apply-pools.js <卡池資料.json> <說明.md>');
        process.exit(1);
    }
    const input = JSON.parse(fs.readFileSync(itemsFile, 'utf8'));
    const poolsBefore = readText(POOLS_FILE);
    const rosterBefore = readText(ROSTER_FILE);
    const out = applyPools({
        pools: JSON.parse(poolsBefore),
        roster: JSON.parse(rosterBefore),
        overrides: fs.existsSync(OVERRIDES_FILE) ? JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8')) : {},
        items: Array.isArray(input.items) ? input.items : [],
        flags: input.flags
    });
    if (out.poolsText !== poolsBefore) fs.writeFileSync(POOLS_FILE, out.poolsText);
    if (out.rosterText !== rosterBefore) fs.writeFileSync(ROSTER_FILE, out.rosterText);
    fs.writeFileSync(reportFile, out.report);
    console.log(`卡池：變動 ${out.changes} 筆，新角色 ${out.added} 個，需要確認 ${out.flags} 項`);
}

if (require.main === module) main();
module.exports = { applyPools };
