// 角色名冊 (scraper/roster.js、characters.json) 的測試
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../scraper/roster.js');
const { readPools } = require('../pools.js');
const { formatPoolsJson } = require('../scraper/pool-parse.js');
const { applyPools } = require('../scraper/apply-pools.js');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8').replace(/\r\n/g, '\n');
const ROSTER = () => ({ characters: [
    { id: 'c0001', name: '瑪娜', element: '光', forms: [{ no: 1234, name: '慈愛天使 瑪娜', form: '獸神化' }] },
    { id: 'c0002', name: '約翰・皮耶爾・波魯那雷夫', aliases: ['皮耶爾・波魯那雷夫'] },
    { id: 'c0003', name: '約兒・佛傑' },
    { id: 'c0004', name: '佛傑家的妻子 約兒・佛傑α', poolAliases: { 'SPY×FAMILY 夏季造型': ['約兒・佛傑'] } }
] });

test('找角色：名稱、別名、形態的名稱都找得到；只在某個卡池才算的寫法要給卡池', () => {
    const r = ROSTER();
    assert.equal(R.findCharacter(r, '瑪娜').id, 'c0001');
    assert.equal(R.findCharacter(r, '慈愛天使　瑪娜').id, 'c0001');
    assert.equal(R.findCharacter(r, '皮耶爾·波魯那雷夫').id, 'c0002');
    assert.equal(R.findCharacter(r, '約兒・佛傑').id, 'c0003');
    assert.equal(R.findCharacter(r, '約兒・佛傑', 'SPY×FAMILY 夏季造型').id, 'c0004');
    assert.equal(R.findCharacter(r, '沒有這隻'), null);
});

test('名冊檢查：重複的編號、兩隻角色用到同一個名稱', () => {
    assert.deepEqual(R.indexRoster(ROSTER()).problems, []);
    const bad = { characters: [{ id: 'c0001', name: '甲' }, { id: 'c0001', name: '乙' }, { id: 'c0002', name: '丙', aliases: ['甲'] }, { id: 'x1', name: '丁' }] };
    assert.equal(R.indexRoster(bad).problems.length, 3);
});

test('新角色的編號接在最大的編號後面，不重複使用', () => {
    const r = { characters: [{ id: 'c0001', name: '甲' }, { id: 'c0007', name: '乙' }] };
    const added = R.addCharacter(r, ' 丙 ', '火');
    assert.deepEqual(added.character, { id: 'c0008', name: '丙', element: '火' });
    assert.equal(r.characters.length, 2);
    assert.throws(() => R.addCharacter(r, '  '));
});

test('卡池：編號 ↔ 名稱；名冊沒有的名稱編新的編號，names 只列用到的', () => {
    const r = ROSTER();
    const named = { '說明': 'x', pools: [{ pool: 'A', kind: 'limited', chars: ['瑪娜', '新角色', '皮耶爾・波魯那雷夫'] }] };
    const out = R.poolsToIds(named, r);
    assert.deepEqual(out.pools.pools[0].chars, ['c0001', 'c0005', 'c0002']);
    assert.deepEqual(out.pools.names, { c0001: '瑪娜', c0002: '約翰・皮耶爾・波魯那雷夫', c0005: '新角色' });
    assert.deepEqual(out.added, [{ id: 'c0005', name: '新角色', pool: 'A' }]);
    assert.deepEqual(R.poolsToNames(out.pools, out.data).pools[0].chars, ['瑪娜', '新角色', '約翰・皮耶爾・波魯那雷夫']);
    assert.equal('names' in R.poolsToNames(out.pools, out.data), false);
    assert.throws(() => R.poolsToNames({ pools: [{ pool: 'A', chars: ['c9999'] }] }, r), /c9999/);
    // 直接讀 pools.json 的程式 (抽卡統計) 拿到的是名稱
    assert.deepEqual(readPools(out.pools)[0].chars, ['瑪娜', '新角色', '約翰・皮耶爾・波魯那雷夫']);
    assert.deepEqual(readPools(out.pools, { c0001: '改名後' })[0].chars, ['改名後']);
});

test('別名 → 爬蟲的名稱對應；屬性寫回名冊時不覆蓋已經有的', () => {
    const r = ROSTER();
    assert.deepEqual(R.rosterOverrides(r), {
        global: { '皮耶爾・波魯那雷夫': '約翰・皮耶爾・波魯那雷夫' },
        pools: { 'SPY×FAMILY 夏季造型': { '約兒・佛傑': '佛傑家的妻子 約兒・佛傑α' } }
    });
    assert.deepEqual(R.rosterElements(r), { '瑪娜': '光' });
    const out = R.applyElements(r, { '瑪娜': '闇', '約兒・佛傑': '光', '全新': '火', '壞的': '風' });
    assert.equal(R.findCharacter(out.data, '瑪娜').element, '光');
    assert.equal(R.findCharacter(out.data, '約兒・佛傑').element, '光');
    assert.deepEqual(out.added, [{ id: 'c0005', name: '全新' }]);
    assert.equal(out.filled, 1);
    assert.equal(r.characters[2].element, undefined);
});

test('characters.json：沒有問題，重新輸出和原本的檔案一字不差', () => {
    const text = read('characters.json');
    const data = JSON.parse(text);
    assert.deepEqual(R.indexRoster(data).problems, []);
    assert.equal(R.formatRoster(data), text);
});

test('pools.json：只用名冊有的編號，附的 names 和名冊一致', () => {
    const roster = JSON.parse(read('characters.json'));
    const text = read('pools.json');
    const pools = JSON.parse(text);
    pools.pools.forEach((p) => p.chars.forEach((c) => assert.match(c, R.ID_RE, p.pool)));
    const again = R.poolsToIds(R.poolsToNames(pools, roster), roster);
    assert.deepEqual(again.added, []);
    assert.equal(formatPoolsJson(again.pools), text);
});

test('套用卡池資料：沒有公告時檔案不變；新名稱編新的編號並寫在說明裡', () => {
    const roster = ROSTER();
    const pools = R.poolsToIds({ pools: [{ pool: '作品A', kind: 'collab', match: ['2026-05月+作品A'], chars: ['瑪娜'] }] }, roster).pools;
    const same = applyPools({ pools, roster, overrides: {}, items: [] });
    assert.equal(same.poolsText, formatPoolsJson(pools));
    assert.equal(same.rosterText, R.formatRoster(roster));
    assert.equal(same.report, '');

    const html = '<h3>「世代 2019」轉蛋活動</h3><table><tbody><tr><th>「世代 2019」限定角色</th></tr><tr><td>瑪娜　皮耶爾・波魯那雷夫　全新角色</td></tr></tbody></table>';
    const X = require('../scraper/pool-parse.js');
    const event = { event: '2026-11月 世代 2019', date: '2026-11-10', tag: 'honke', source: 'https://www.monster-strike.com.tw/news/x.html' };
    const out = applyPools({ pools, roster, overrides: {}, items: [{ event, data: X.extractPoolData(html) }] });
    const newPools = JSON.parse(out.poolsText);
    const added = newPools.pools.find((p) => p.pool === '世代 2019');
    assert.deepEqual(added.chars, ['c0001', 'c0002', 'c0005']);
    assert.equal(JSON.parse(out.rosterText).characters.find((c) => c.id === 'c0005').name, '全新角色');
    assert.match(out.report, /c0005 全新角色/);
});
