// 角色名冊 (roster.js、characters.json) 的測試
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../roster.js');
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
    assert.deepEqual(R.addCharacter(r, '丁', '', { new: true }).character, { id: 'c0008', name: '丁', new: true });
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

// ---- 管理員的修改檔 ----
const BASE = () => ({ characters: [
    { id: 'c0001', name: '洛基', element: '闇' },
    { id: 'c0002', name: '終結九界者 洛基', new: true },
    { id: 'c0003', name: '雷姆' },
    { id: 'c0004', name: '拉姆' },
    { id: 'c0005', name: '伏姬α', kind: 'period' }
] });

test('修改檔：存檔、新增、合併、確認不同角色；套用後網頁看到的名冊', () => {
    const base = BASE();
    let e = R.applyOp(base, null, { type: 'save', id: 'c0003', character: { name: ' 雷姆 ', element: '水', aliases: ['蕾姆', '雷姆', '蕾姆'], forms: [{ no: '1234', name: '鬼族的女僕 雷姆', form: '獸神化' }, { name: '', no: '' }] } });
    assert.deepEqual(e.chars.c0003, { id: 'c0003', name: '雷姆', element: '水', aliases: ['蕾姆'], forms: [{ no: 1234, name: '鬼族的女僕 雷姆', form: '獸神化' }] });
    e = R.applyOp(base, e, { type: 'merge', from: 'c0002', into: 'c0001', as: 'form' });
    assert.deepEqual(e.chars.c0001, { id: 'c0001', name: '洛基', element: '闇', forms: [{ name: '終結九界者 洛基' }] });
    assert.deepEqual(e.merged, { c0002: 'c0001' });
    e = R.applyOp(base, e, { type: 'add', character: { name: '一休', element: '光', kind: 'regular' } });
    e = R.applyOp(base, e, { type: 'distinct', a: 'c0004', b: 'c0003' });
    assert.deepEqual(e.distinct, ['c0003|c0004']);

    const applied = R.applyEdits(base, e);
    assert.deepEqual(applied.data.characters.map((c) => c.name), ['洛基', '雷姆', '拉姆', '伏姬α', '一休']);
    assert.equal(applied.data.characters[4].pending, true);
    assert.equal(applied.names.c0002, '洛基');   // 被合併的編號 → 併進去的那隻 (卡池還沒改寫時用)
    assert.equal(R.findCharacter(applied.data, '終結九界者 洛基').id, 'c0001');
    assert.equal(base.characters.length, 5);

    // 還沒編號的新角色可以再併到別隻 (變成別名)
    const e2 = R.applyOp(base, e, { type: 'merge', fromName: '一休', into: 'c0004', as: 'alias' });
    assert.deepEqual(e2.adds, []);
    assert.deepEqual(e2.chars.c0004.aliases, ['一休']);
});

test('修改檔：不合理的修改會丟出錯誤', () => {
    const base = BASE();
    assert.throws(() => R.applyOp(base, null, { type: 'save', id: 'c0003', character: { name: '' } }), /空白/);
    assert.throws(() => R.applyOp(base, null, { type: 'save', id: 'c0003', character: { name: '拉姆' } }), /「拉姆」同時是 c\d{4}.* 和 c\d{4}.*的名稱。如果是同一隻角色/);
    assert.throws(() => R.applyOp(base, null, { type: 'save', id: 'c0003', character: { name: '雷姆', aliases: ['洛基'] } }), /同時是/);
    assert.throws(() => R.applyOp(base, null, { type: 'save', id: 'c0003', character: { name: '雷姆', element: '風' } }), /屬性/);
    assert.throws(() => R.applyOp(base, null, { type: 'save', id: 'c0003', character: { name: '雷姆', forms: [{ no: '1.5', name: 'x' }] } }), /圖鑑編號/);
    assert.throws(() => R.applyOp(base, null, { type: 'save', id: 'c9999', character: { name: '甲' } }), /找不到/);
    assert.throws(() => R.applyOp(base, null, { type: 'add', character: { name: '洛基' } }), /已經在名冊裡/);
    const withForm = { characters: [{ id: 'c0001', name: '洛基', forms: [{ name: '終結九界者 洛基' }] }] };
    assert.throws(() => R.applyOp(withForm, null, { type: 'add', character: { name: '新名字', forms: [{ name: '終結九界者 洛基' }] } }), /「終結九界者 洛基」已經是「洛基」的名稱/);
    assert.throws(() => R.applyOp(base, null, { type: 'merge', from: 'c0001', into: 'c0001' }), /找不到|自己/);
    assert.throws(() => R.applyOp(base, null, { type: 'x' }), /不認得/);
});

test('修改檔寫回檔案：新角色編號、被合併的編號在卡池裡換掉、寫回後從修改檔清掉', () => {
    const base = BASE();
    const pools = { pools: [{ pool: 'A', kind: 'limited', chars: ['c0001', 'c0002', 'c0003'] }], names: {} };
    let e = R.applyOp(base, null, { type: 'merge', from: 'c0002', into: 'c0001', as: 'form' });
    e = R.applyOp(base, e, { type: 'save', id: 'c0003', character: { name: '蕾姆', aliases: ['雷姆'] } });
    e = R.applyOp(base, e, { type: 'add', character: { name: '一休', element: '光' } });
    e = R.applyOp(base, e, { type: 'distinct', a: 'c0003', b: 'c0004' });
    const out = R.foldEdits(base, pools, e);
    assert.equal(out.changed, 5);
    assert.deepEqual(out.pools.pools[0].chars, ['c0001', 'c0003']);
    assert.deepEqual(out.pools.names, { c0001: '洛基', c0003: '蕾姆' });
    assert.deepEqual(out.data.characters.map((c) => c.id + c.name), ['c0001洛基', 'c0003蕾姆', 'c0004拉姆', 'c0005伏姬α', 'c0006一休']);
    assert.deepEqual(out.data.distinct, [['c0003', 'c0004']]);
    assert.equal(out.data.characters[4].pending, undefined);
    assert.deepEqual(R.indexRoster(out.data).problems, []);
    // 輸出 → 讀回來不變
    assert.deepEqual(JSON.parse(R.formatRoster(out.data)).distinct, [['c0003', 'c0004']]);
    // 寫回後，修改檔清空；再套一次不會變
    assert.deepEqual(R.pruneEdits(out.data, e), { chars: {}, merged: {}, adds: [], distinct: [], pools: [], unpools: [] });
    assert.equal(R.foldEdits(out.data, out.pools, R.pruneEdits(out.data, e)).changed, 0);
    // 還沒寫回的留著
    assert.deepEqual(Object.keys(R.pruneEdits(base, e).chars).sort(), ['c0001', 'c0003']);
    // 有開著的卡池 PR 時，新角色先不編號 (留在修改檔)
    const held = R.foldEdits(base, pools, e, { skipAdds: true });
    assert.equal(held.skipped, 1);
    assert.equal(held.data.characters.some((c) => c.name === '一休'), false);
    assert.equal(R.pruneEdits(held.data, e).adds.length, 1);
    // 沒有修改時檔案不變
    const same = R.foldEdits(base, { pools: pools.pools }, null);
    assert.equal(R.formatRoster(same.data), R.formatRoster(base));
});

test('有狀況的角色：依嚴重程度排前面，並說明是什麼狀況', () => {
    const base = BASE();
    const rows = R.rosterIssues(base, {
        inPool: (n) => n === '洛基',
        similarOf: new Map([['雷姆', ['拉姆']], ['拉姆', ['雷姆']]]),
        recordNames: ['洛基', '打錯的名子', '打錯的名子']
    });
    assert.deepEqual(rows.map((r) => [r.character.name, r.issues.map((i) => i.type).join('+')]), [
        ['終結九界者 洛基', 'new+noelement'],
        ['打錯的名子', 'missing'],
        ['伏姬α', 'nopool+noelement'],
        ['雷姆', 'noelement+similar'],
        ['拉姆', 'noelement+similar'],
        ['洛基', '']
    ]);
    assert.match(rows[2].issues[0].text, /期間限定，還沒有卡池資料/);
    // 確認是不同角色後不再提示
    const confirmed = R.rosterIssues({ ...base, distinct: [['c0004', 'c0003']] }, { similarOf: new Map([['雷姆', ['拉姆']]]) });
    assert.equal(confirmed.find((r) => r.character.name === '雷姆').issues.some((i) => i.type === 'similar'), false);
});

test('角色本身 (轉蛋抽到的形態) 的圖鑑編號', () => {
    const base = BASE();
    const e = R.applyOp(base, null, { type: 'save', id: 'c0005', character: { name: '伏姬α', no: '7794', kind: 'period', forms: [{ name: '甘美的狼仙女 伏姬α', form: '獸神化', no: 7795 }] } });
    assert.deepEqual(e.chars.c0005, { id: 'c0005', name: '伏姬α', no: 7794, kind: 'period', forms: [{ no: 7795, name: '甘美的狼仙女 伏姬α', form: '獸神化' }] });
    assert.equal(R.hasDexNumbers({ name: 'x', no: 1 }), true);
    assert.equal(R.hasDexNumbers({ name: 'x' }), false);
    assert.throws(() => R.applyOp(base, null, { type: 'save', id: 'c0005', character: { name: '伏姬α', no: '0' } }), /圖鑑編號/);
    const out = R.foldEdits(base, { pools: [] }, e);
    assert.match(R.formatRoster(out.data), /\{"id": "c0005", "name": "伏姬α", "no": 7794, "kind": "period", "forms"/);
});

test('手動補卡池：加進那個月的版本、新增版本、拿掉、寫回後清掉', () => {
    const roster = ROSTER();
    const pools = { pools: [
        { pool: '祝宴！怪物彈珠新娘 4', kind: 'limited', months: ['2024-06'], chars: ['c0001'] }
    ] };
    let e = R.applyOp(roster, null, { type: 'pool', id: 'c0003', pool: '祝宴！怪物彈珠新娘4', month: '2024-06' });
    e = R.applyOp(roster, e, { type: 'pool', id: 'c0002', pool: '怪物彈珠暑假2022', month: '2022-08', source: 'https://example.com/a.html' });
    const applied = R.applyPoolEdits(pools, e);
    assert.deepEqual(applied.pools[0].chars, ['c0001', 'c0003']);
    assert.deepEqual(applied.pools[1], { pool: '怪物彈珠暑假2022', kind: 'limited', months: ['2022-08'], source: 'https://example.com/a.html', chars: ['c0002'] });
    assert.equal(pools.pools.length, 1);   // 不改動傳入的物件
    // 名稱查得到 (網頁用)
    const named = readPools(applied, { c0001: '瑪娜', c0002: '波魯那雷夫', c0003: '約兒' });
    assert.deepEqual(named[1].chars, ['波魯那雷夫']);
    // 還沒寫回的「加」，拿掉時直接取消
    const undone = R.applyOp(roster, e, { type: 'unpool', id: 'c0002', pool: '怪物彈珠暑假2022', month: '2022-08' });
    assert.equal(undone.pools.length, 1);
    assert.equal(undone.unpools.length, 0);
    // 已經在 pools.json 裡的，記一筆「拿掉」；名單空了整個版本拿掉
    const removed = R.applyOp(roster, null, { type: 'unpool', id: 'c0001', pool: '祝宴！怪物彈珠新娘 4', month: '2024-06' });
    assert.deepEqual(R.applyPoolEdits(pools, removed).pools, []);
    // 寫回 pools.json，下一次執行時從修改檔清掉
    const out = R.foldEdits(roster, pools, e);
    assert.equal(out.changed, 2);
    assert.deepEqual(out.pools.pools[0].chars, ['c0001', 'c0003']);
    assert.equal(out.pools.names.c0002, '約翰・皮耶爾・波魯那雷夫');
    const pruned = R.pruneEdits(out.data, e, out.pools);
    assert.deepEqual([pruned.pools, pruned.unpools], [[], []]);
    assert.equal(R.pruneEdits(roster, removed, pools).unpools.length, 1);
    assert.equal(R.pruneEdits(roster, removed, R.applyPoolEdits(pools, removed)).unpools.length, 0);
});

test('手動補卡池：不合理的輸入', () => {
    const roster = ROSTER();
    assert.throws(() => R.applyOp(roster, null, { type: 'pool', id: 'c0001', pool: ' ', month: '2024-06' }), /卡池名稱/);
    assert.throws(() => R.applyOp(roster, null, { type: 'pool', id: 'c0001', pool: '甲', month: '2024-13' }), /哪個月/);
    assert.throws(() => R.applyOp(roster, null, { type: 'pool', id: 'c0001', pool: '甲', month: '2024-06', source: 'javascript:alert(1)' }), /網址/);
    assert.throws(() => R.applyOp(roster, null, { type: 'pool', id: 'c0999', pool: '甲', month: '2024-06' }), /找不到/);
    assert.throws(() => R.applyOp(roster, null, { type: 'pool', id: '', pool: '甲', month: '2024-06' }), /編號後/);
    // 修改檔裡格式不對的會被略過
    assert.deepEqual(R.readEdits({ pools: [{ id: 'c0001', pool: '甲', month: '2024-6' }, { id: 'c0001', pool: '甲', month: '2024-06', source: 'http://x' }] }).pools,
        [{ id: 'c0001', pool: '甲', month: '2024-06' }]);
});
