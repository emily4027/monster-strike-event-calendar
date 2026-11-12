// 執行：node --test tests/
// 公告 → 卡池的解析 (scraper/pool-parse.js)。HTML 是照官網格式手寫的簡化版本
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const X = require('../scraper/pool-parse.js');

const FESTIVAL = `
<h2>全新限定角色登場！</h2>
<table><tbody>
<tr><th>「綠色幻想」限定角色</th></tr>
<tr><td><span>三日月宗近　</span>安朵美達　<span>麻穗呂芭波菈里絲</span>　西施　<br>艾特華爾　新角色甲</td></tr>
</tbody></table>`;

const GENERATION = `
<table><tbody>
<tr><th>轉出對象限定角色</th></tr>
<tr><td>媽祖　綿津見</td></tr>
<tr><th>轉出對象期間限定角色</th></tr>
<tr><td>新年魔術王 所羅門　與自由奪還者的共鬥 所羅門 MV</td></tr>
<tr><th>火屬性</th></tr>
<tr><td>不要收這個</td></tr>
</tbody></table>`;

const COLLAB = `
<h5>◆INDEX◆</h5>
<h5>◎轉蛋「作品A」開跑！<br>◎介紹合作活動角色！</h5>
<h4>轉蛋「作品A」開跑！</h4>
<h5>【合作活動轉蛋詳情】</h5>
<table><tbody>
<tr><th>角色名</th><th>稀有度</th><th>屬性</th></tr>
<tr><td>角色一</td><td>★4</td><td>火</td></tr>
<tr><td>角色 二</td><td>★6（獸神化前）</td><td>水</td></tr>
<tr><td>角色三</td><td>★6(獸神化前)</td><td>木</td></tr>
</tbody></table>
<h4>合作活動冒險登場！</h4>
<table><tbody>
<tr><th>角色名</th><th>稀有度</th><th>屬性</th></tr>
<tr><td>冒險角色</td><td>★6（獸神化前）</td><td>光</td></tr>
</tbody></table>`;

const POOLS = () => ({
    '說明': '測試',
    pools: [
        { pool: '作品A', kind: 'collab', match: ['2026-05月+作品A'], source: 'https://example.com/a', chars: ['角色一', '角色 二', '角色三'] },
        { pool: '舊作品', kind: 'collab', match: ['2024-01月+舊作品'], chars: ['舊角色'] },
        { pool: '綠色幻想', kind: 'limited', source: 'https://example.com/list', chars: ['三日月宗近', '安朵美達', '麻穗呂芭', '波菈里絲', '西施'] },
        { pool: '綠色幻想', kind: 'limited', months: ['2026-11'], chars: ['三日月宗近', '安朵美達', '麻穗呂芭', '波菈里絲', '西施', '艾特華爾', '新角色甲'] },
        { pool: '怪物彈珠世代 2019', kind: 'limited', match: ['世代+2019'], chars: ['媽祖', '綿津見'] }
    ]
});
const item = (event, date, tag, html) => ({
    event: { event, date, tag, source: `https://example.com/${date}` },
    data: X.extractPoolData(html)
});

test('限定角色表：全形空白與換行分隔，名稱裡的半形空白保留；屬性表不收', () => {
    assert.deepEqual(X.parseLimitedLists(FESTIVAL).map((l) => [l.poolName, l.names]), [
        ['綠色幻想', ['三日月宗近', '安朵美達', '麻穗呂芭波菈里絲', '西施', '艾特華爾', '新角色甲']]
    ]);
    assert.deepEqual(X.parseLimitedLists(GENERATION).map((l) => l.names), [
        ['媽祖', '綿津見'],
        ['新年魔術王 所羅門', '與自由奪還者的共鬥 所羅門 MV']
    ]);
    assert.deepEqual(X.splitNameCell('正宗 莫比烏斯 久遠'), ['正宗', '莫比烏斯', '久遠']);
});

test('合作角色表：只看「轉蛋「X」」段落 (目錄、冒險段落不算)', () => {
    const sections = X.parseCollabSections(COLLAB);
    assert.equal(sections.length, 1);
    assert.equal(sections[0].gachaName, '作品A');
    assert.deepEqual(sections[0].rows.filter((r) => X.isStar6Base(r.rarity)).map((r) => r.name), ['角色 二', '角色三']);
});

test('黏在一起的名稱用已知名稱拆開；新名稱、只差一個字的名稱會標出來', () => {
    const known = X.knownNames(POOLS());
    assert.deepEqual(X.splitGlued('麻穗呂芭波菈里絲', known), ['麻穗呂芭', '波菈里絲']);
    assert.equal(X.splitGlued('西施', known), null);
    const { names, notes } = X.cleanNames(['麻穗呂芭波菈里絲', '西旅', '全新角色'], known);
    assert.deepEqual(names, ['麻穗呂芭', '波菈里絲', '西旅', '全新角色']);
    assert.equal(notes.length, 3);
    assert.match(notes[1], /「西旅」和既有的 「西施」 只差一個字/);
    assert.match(notes[2], /沒出現過/);
});

test('限定卡池：名單和既有版本都不同 → 加一個只屬於這個月的版本，依月份排在同名卡池裡', () => {
    const html = FESTIVAL.replace('<br>艾特華爾　新角色甲', '圖坦卡門');
    const r = X.planPoolChanges(POOLS(), [item('2024-09月 綠色幻想', '2024-09-04', 'honke', html)]);
    assert.equal(r.changes.length, 1);
    const c = r.changes[0];
    assert.equal(c.type, 'add-version');
    assert.equal(c.month, '2024-09');
    assert.deepEqual(c.added, ['圖坦卡門']);
    assert.deepEqual(c.removed, []);
    const names = r.data.pools.map((p) => `${p.pool}${p.months ? '@' + p.months.join(',') : ''}`);
    assert.deepEqual(names, ['作品A', '舊作品', '綠色幻想', '綠色幻想@2024-09', '綠色幻想@2026-11', '怪物彈珠世代 2019']);
    assert.ok(r.flags.some((f) => /黏在一起/.test(f.message)));

    // 和某一期的名單相同 → 把月份加進那個版本，不新增
    const same = X.planPoolChanges(POOLS(), [item('2026-12月 綠色幻想', '2026-12-04', 'honke', FESTIVAL)]);
    assert.equal(same.changes[0].type, 'add-month');
    assert.deepEqual(same.data.pools.find((p) => p.months && p.months.includes('2026-12')).months, ['2026-11', '2026-12']);
    assert.equal(same.data.pools.length, POOLS().pools.length);
    // 同一個月已經有相同名單 → 不動
    const again = X.planPoolChanges(POOLS(), [item('2026-11月 綠色幻想', '2026-11-05', 'honke', FESTIVAL)]);
    assert.equal(again.changes.length, 0);
    assert.equal(again.flags.length, 0);
});

test('限定卡池：同一個月已經有不同名單的版本 → 不寫，只標出來', () => {
    const html = FESTIVAL.replace('　新角色甲', '');
    const r = X.planPoolChanges(POOLS(), [item('2026-11月 綠色幻想', '2026-11-05', 'honke', html)]);
    assert.equal(r.changes.length, 0);
    assert.match(r.flags[0].message, /2026-11 已經有一個版本.*少了：新角色甲/);
});

test('限定卡池：用活動名稱 (世代+2019) 對到卡池，期間限定角色一起收', () => {
    const r = X.planPoolChanges(POOLS(), [item('2026-07月 怪物彈珠世代2019 〜所羅門篇〜', '2026-07-12', 'honke', GENERATION)]);
    assert.equal(r.changes.length, 1);
    assert.deepEqual(r.changes[0].added, ['新年魔術王 所羅門', '與自由奪還者的共鬥 所羅門 MV']);
    const added = r.data.pools.find((p) => p.months && p.months.includes('2026-07'));
    assert.deepEqual(added.match, ['世代+2019']);
});

test('同一批依日期由舊到新：後面名單相同的期數加進前面剛加的版本', () => {
    const html = FESTIVAL.replace('<br>艾特華爾　新角色甲', '圖坦卡門');
    const r = X.planPoolChanges(POOLS(), [
        item('2025-03月 綠色幻想', '2025-03-01', 'honke', html),
        item('2024-09月 綠色幻想', '2024-09-04', 'honke', html)
    ]);
    assert.deepEqual(r.changes.map((c) => [c.type, c.month]), [['add-version', '2024-09'], ['add-month', '2025-03']]);
    assert.deepEqual(r.data.pools.find((p) => p.months && p.months.includes('2024-09')).months, ['2024-09', '2025-03']);
});

test('合作卡池：只收★6（獸神化前），名單不同時改那一筆；沒有卡池時新增並標出來', () => {
    const update = X.planPoolChanges(POOLS(), [item('2026-05月 作品A', '2026-05-10', 'collab', COLLAB)]);
    assert.equal(update.changes[0].type, 'update-collab');
    assert.deepEqual(update.changes[0].removed, ['角色一']);
    assert.deepEqual(update.data.pools[0].chars, ['角色 二', '角色三']);
    assert.equal(update.data.pools[0].source, 'https://example.com/a');   // 原本的來源保留

    const created = X.planPoolChanges(POOLS(), [item('2025-02月 作品A', '2025-02-10', 'collab', COLLAB)]);
    assert.equal(created.changes[0].type, 'new-collab');
    const entry = created.data.pools.find((p) => p.match && p.match[0] === '2025-02月+作品A');
    assert.ok(entry);
    // 合作卡池依年月由新到舊：2025-02 排在 2026-05 和 2024-01 之間
    assert.deepEqual(created.data.pools.slice(0, 3).map((p) => p.match[0]), ['2026-05月+作品A', '2025-02月+作品A', '2024-01月+舊作品']);
    assert.ok(created.flags.some((f) => /新的合作卡池/.test(f.message)));
});

test('合作卡池：找不到★6、或段落不只一個 → 只標出來', () => {
    const noStar6 = X.planPoolChanges(POOLS(), [item('2026-05月 作品A', '2026-05-10', 'collab', COLLAB.replace(/★6（獸神化前）|★6\(獸神化前\)/g, '★5'))]);
    assert.equal(noStar6.changes.length, 0);
    assert.match(noStar6.flags[0].message, /沒有「★6（獸神化前）」/);

    // 好幾個段落、名稱都和活動名稱對不起來 → 只標出來
    const two = COLLAB.replace('<h4>轉蛋「作品A」開跑！</h4>', '<h4>轉蛋「作品B」開跑！</h4>').replace('<h4>合作活動冒險登場！</h4>', '<h4>轉蛋「作品C」再度登場！</h4>');
    const r = X.planPoolChanges(POOLS(), [item('2026-05月 作品A', '2026-05-10', 'collab', two)]);
    assert.equal(r.changes.length, 0);
    assert.match(r.flags[0].message, /好幾個轉蛋段落/);
});

test('稀有度的各種寫法、轉蛋《X》與沒有名稱的轉蛋標題都認得', () => {
    ['★6（獸神化前）', '（獸神化前）★6', '獸神化前（★6）', '★6 (獸神化前)'].forEach((r) => assert.ok(X.isStar6Base(r), r));
    assert.ok(!X.isStar6Base('★6'));
    assert.ok(!X.isStar6Base('★5'));
    const html = COLLAB.replace('<h4>轉蛋「作品A」開跑！</h4>', '<h4>轉蛋《作品A》開跑！</h4>');
    assert.equal(X.parseCollabSections(html)[0].gachaName, '作品A');
    const nested = COLLAB.replace('<h4>轉蛋「作品A」開跑！</h4>', '<h4>轉蛋「《作品A》系列」開跑！</h4>');
    assert.equal(X.parseCollabSections(nested)[0].gachaName, '《作品A》系列');
    const unnamed = COLLAB.replace('<h4>轉蛋「作品A」開跑！</h4>', '<h2>第2彈合作活動轉蛋開跑＆介紹角色！</h2>')
        .replace('<h4>合作活動冒險登場！</h4>', '<h3>轉蛋《作品A 第1彈》登場</h3>');
    const sections = X.parseCollabSections(unnamed);
    assert.deepEqual(sections.map((x) => x.gachaName), ['', '作品A 第1彈']);
    assert.deepEqual(X.pickSections(sections, '2026-05月 作品A'), [sections[0]]);
});

test('好幾個轉蛋段落：名稱相同的那段 → 名稱包含在活動名稱裡的那幾段', () => {
    const s = (gachaName) => ({ gachaName, rows: [] });
    const a = [s('超獸神祭×鬼滅之刃'), s('鬼滅之刃')];
    assert.deepEqual(X.pickSections(a, '2025-10月 超獸神祭×鬼滅之刃'), [a[0]]);
    const b = [s('葬送的芙莉蓮第2彈'), s('葬送的芙莉蓮第1彈')];
    assert.deepEqual(X.pickSections(b, '2026-01月 葬送的芙莉蓮第二彈'), [b[0]]);
    const c = [s('咒術迴戰'), s('STARLIGHT MIRAGE×劇場版 咒術迴戰 0')];
    assert.deepEqual(X.pickSections(c, '2024-01月 咒術迴戰 & STARLIGHT MIRAGE×劇場版 咒術迴戰 0'), c);
    assert.equal(X.pickSections([s('X'), s('Y')], '2026-01月 Z'), null);
});

test('合作祭典：公告只用屬性分限定角色 → 用對應屬性的名單；都沒有 → 沿用這期之前最近一期的名單', () => {
    const elementTable = '<table><tbody><tr><th>木屬性</th></tr><tr><td>三日月宗近 西施</td></tr><tr><th>闇屬性</th></tr><tr><td>凱撒</td></tr></tbody></table>';
    const byElement = X.planPoolChanges(POOLS(), [item('2026-05月 綠色幻想×作品A', '2026-05-10', 'collab', COLLAB + elementTable)]);
    const v = byElement.data.pools.find((p) => p.pool === '綠色幻想' && p.months && p.months.includes('2026-05'));
    assert.deepEqual(v.chars, ['三日月宗近', '西施']);

    // 沒有限定表：沿用 2026-05 之前最近的一期 (沒有 → 標出來)；2026-12 之前最近的是 2026-11
    const early = X.planPoolChanges(POOLS(), [item('2026-05月 綠色幻想×作品A', '2026-05-10', 'collab', COLLAB)]);
    assert.ok(early.flags.some((f) => /之前也沒有可以沿用的名單/.test(f.message)));
    const late = X.planPoolChanges(POOLS(), [item('2026-12月 綠色幻想×作品A', '2026-12-10', 'collab', COLLAB)]);
    const inherit = late.changes.find((c) => c.type === 'inherit');
    assert.equal(inherit.previous, '2026-11');
    assert.deepEqual(late.data.pools.find((p) => p.pool === '綠色幻想' && p.months && p.months.includes('2026-12')).months, ['2026-11', '2026-12']);
});

test('本家：活動名稱對到好幾個卡池時，用表頭的名稱 (沒有這個卡池就新增)', () => {
    const pools = { pools: [
        { pool: '世代 2013＆2014', kind: 'limited', match: ['世代+2013'], chars: ['米迦勒'] },
        { pool: '世代 2017', kind: 'limited', match: ['世代+2017'], chars: ['彌勒'] }
    ] };
    const html = '<table><tbody><tr><th>「世代 2013＆2014＆2017」限定角色</th></tr><tr><td>米迦勒　彌勒</td></tr>'
        + '<tr><th>「世代 2013＆2014＆2017」期間限定角色</th></tr><tr><td>新年彌勒</td></tr></tbody></table>';
    const r = X.planPoolChanges(pools, [item('2024-09月 世代 2013＆2014＆2017 (烏列爾)', '2024-09-30', 'honke', html)]);
    assert.deepEqual(r.changes.map((c) => [c.type, c.pool]), [['new-limited', '世代 2013＆2014＆2017']]);
    assert.deepEqual(r.changes[0].chars, ['米迦勒', '彌勒', '新年彌勒']);
});

test('pools.json 重新輸出和原本的檔案一字不差 (一個卡池一行)', () => {
    const file = path.join(__dirname, '..', 'pools.json');
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    assert.equal(X.formatPoolsJson(JSON.parse(text)), text);
});

test('合作祭典 (超獸神祭×作品A)：合作卡池和本家限定卡池分開更新；沒有限定表時標出來', () => {
    const limitedTable = `<table><tbody><tr><th>「綠色幻想」限定角色</th></tr><tr><td>三日月宗近　西施</td></tr></tbody></table>`;
    const combo = COLLAB + limitedTable;
    const r = X.planPoolChanges(POOLS(), [item('2026-05月 綠色幻想×作品A', '2026-05-10', 'collab', combo)]);
    assert.deepEqual(r.changes.map((c) => [c.type, c.pool]), [['update-collab', '作品A'], ['add-version', '綠色幻想']]);
    const limited = r.data.pools.find((p) => p.pool === '綠色幻想' && p.months && p.months.includes('2026-05'));
    assert.deepEqual(limited.chars, ['三日月宗近', '西施']);

    const noTable = X.planPoolChanges(POOLS(), [item('2026-05月 綠色幻想×作品A', '2026-05-10', 'collab', COLLAB)]);
    assert.deepEqual(noTable.changes.map((c) => c.type), ['update-collab']);
    assert.ok(noTable.flags.some((f) => /本家限定的部分需要手動處理/.test(f.message)));
});

test('名稱對應 (name-overrides.json)：全部卡池或只在某個卡池把公告寫法換成卡池寫法', () => {
    const overrides = { global: { '角色 二': '角色二（正式）' }, pools: { '作品A': { '角色三': '角色三α' }, '別的卡池': { '角色一': 'X' } } };
    const r = X.planPoolChanges(POOLS(), [item('2026-05月 作品A', '2026-05-10', 'collab', COLLAB)], overrides);
    assert.deepEqual(r.data.pools[0].chars, ['角色二（正式）', '角色三α']);
    // 規則檔本身的格式
    const file = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scraper', 'name-overrides.json'), 'utf8'));
    assert.equal(typeof file.global, 'object');
    assert.equal(typeof file.pools, 'object');
});

test('限定角色表的表頭：「轉出對象的激獸神祭限定角色：」「轉出對象的期間限定角色」也認得', () => {
    const html = '<table><tbody><tr><th>轉出對象的激獸神祭限定角色：</th></tr><tr><td>浮士德　基度山　<br>壽限無</td></tr>'
        + '<tr><th>轉出對象的期間限定角色</th></tr><tr><td>正宗：使命的劍士 MV　天命的統率者 麒麟兒 MV</td></tr></tbody></table>';
    assert.deepEqual(X.parseLimitedLists(html).map((l) => [l.poolName, l.names]), [
        ['激獸神祭', ['浮士德', '基度山', '壽限無']],
        ['', ['正宗：使命的劍士 MV', '天命的統率者 麒麟兒 MV']]
    ]);
});

test('同一個月有兩個名單不同的同名轉蛋：後到的 (活動清單裡的) 另存 variant 版本，各用各的', () => {
    const { readPools, poolsForEvent } = require('../pools.js');
    const special = FESTIVAL.replace('　新角色甲', '　新角色甲　特別版角色');
    const r = X.planPoolChanges(POOLS(), [item('2026-11月 動畫特別版！綠色幻想', '2026-11-20', 'honke', special)]);
    assert.equal(r.changes.length, 1);
    const v = r.data.pools.find((p) => p.variant);
    assert.equal(v.variant, '動畫特別版！綠色幻想');
    assert.deepEqual(v.months, ['2026-11']);
    const pools = readPools(r.data);
    const charsOf = (e) => poolsForEvent(pools, e)[0].chars;
    assert.ok(charsOf('2026-11月 動畫特別版！綠色幻想').includes('特別版角色'));
    assert.ok(!charsOf('2026-11月 綠色幻想').includes('特別版角色'));
    // 活動清單沒有的祭典遇到同月不同名單：不處理
    const unlogged = item('2026-11月 綠色幻想', '2026-11-25', 'honke', special);
    unlogged.event.unlogged = true;
    assert.equal(X.planPoolChanges(POOLS(), [unlogged]).changes.length, 0);
});

test('合作活動同時複刻的前幾彈：同段落後面的表、其他轉蛋段落各存成「主卡池・複刻 N」，和這期分開', () => {
    const table = (rows) => '<table><tbody><tr><th>角色名</th><th>稀有度</th><th>屬性</th></tr>'
        + rows.map(([n, r, e]) => `<tr><td>${n}</td><td>${r}</td><td>${e}</td></tr>`).join('') + '</tbody></table>';
    const html = '<h4>轉蛋「作品A」開跑！</h4>'
        + table([['新角色一', '★6（獸神化前）', '火'], ['新角色二', '★4', '水']])
        + table([['一彈角色', '★6（獸神化前）', '木']])
        + '<h4>第1彈合作活動的轉蛋再度登場！</h4>'
        + table([['舊角色甲', '★6（獸神化前）', '光'], ['舊角色乙', '★6（獸神化前）', '闇']]);
    const sections = X.parseCollabSections(html);
    assert.deepEqual(sections.map((x) => x.tables.length), [2, 1]);
    assert.equal(sections[0].rows[0].element, '火');

    const r = X.planPoolChanges(POOLS(), [item('2026-05月 作品A', '2026-05-10', 'collab', html)]);
    assert.deepEqual(r.changes.map((c) => [c.type, c.pool]), [
        ['update-collab', '作品A'], ['new-rerun', '作品A・複刻 1'], ['new-rerun', '作品A・複刻 2']
    ]);
    assert.deepEqual(r.data.pools.slice(0, 3).map((p) => [p.pool, !!p.rerun, p.chars]), [
        ['作品A', false, ['新角色一']],
        ['作品A・複刻 1', true, ['一彈角色']],
        ['作品A・複刻 2', true, ['舊角色甲', '舊角色乙']]
    ]);
    // 再跑一次不會重複新增；畫面上三塊都列出來
    const again = X.planPoolChanges(r.data, [item('2026-05月 作品A', '2026-05-10', 'collab', html)]);
    assert.equal(again.changes.length, 0);
    const { readPools, poolsForEvent } = require('../pools.js');
    assert.deepEqual(poolsForEvent(readPools(r.data), '2026-05月 作品A').map((p) => [p.pool, p.rerun]),
        [['作品A', false], ['作品A・複刻 1', true], ['作品A・複刻 2', true]]);
});

test('屬性：文字顏色、屬性表頭、合作表的屬性欄；合併到屬性表時不覆蓋既有的', () => {
    assert.deepEqual(['rgb(255, 0, 0)', 'rgb(51, 102, 255)', '#339966', 'rgb(255, 153, 0)', '#800080', '#999999', ''].map(X.colorElement),
        ['火', '水', '木', '光', '闇', '', '']);
    const cell = '<span style="color: rgb(255, 0, 0);">卡蜜菈</span>　<span style="color: rgb(51, 153, 102);">九十九　<span style="color: rgb(128, 0, 128);">馬克士威</span></span>　沒顏色';
    assert.deepEqual(X.cellElements(cell), { '卡蜜菈': '火', '九十九': '木', '馬克士威': '闇' });
    const html = '<table><tbody><tr><th>「綠色幻想」限定角色</th></tr><tr><td>' + cell + '</td></tr><tr><th>水屬性</th></tr><tr><td>甲 乙</td></tr></tbody></table>' + COLLAB;
    const data = X.extractPoolData(html);
    assert.equal(data.elementOf['卡蜜菈'], '火');
    assert.equal(data.elementOf['甲'], '水');
    assert.equal(data.elementOf['角色 二'], '水');
    assert.equal(data.elementOf['角色一'], undefined);       // ★4：優先度低
    assert.equal(data.elementOfLow['角色一'], '火');
    const it = { event: { event: 'E', date: '2026-01-01', source: 'u' }, data };
    const m = X.mergeElements({ '卡蜜菈': '水' }, [it], POOLS(), { global: { '甲': '甲（正式）' } });
    assert.equal(m.elements['卡蜜菈'], '水');
    assert.equal(m.elements['甲（正式）'], '水');
    assert.match(m.flags[0].message, /「卡蜜菈」的屬性：屬性表是水，這篇公告是火/);
});

test('一篇公告同時開好幾個卡池 (怪物彈珠世代)：各卡池各自一個版本，活動用 "=名稱" 對到每一個', () => {
    const { readPools, poolsForEvent } = require('../pools.js');
    const pools = { pools: [
        { pool: '世代 2019', kind: 'limited', match: ['世代+2019'], chars: ['所羅門'] },
        { pool: '世代 2018', kind: 'limited', match: ['世代+2018'], chars: ['瑪娜'] }
    ] };
    const html = '<table><tbody><tr><th>「世代 2019」限定角色</th></tr><tr><td>所羅門　亞伯</td></tr></tbody></table>'
        + '<table><tbody><tr><th>火屬性</th></tr><tr><td>張遼</td></tr></tbody></table>'
        + '<table><tbody><tr><th>「世代 2018」限定角色</th></tr><tr><td>瑪娜　摩西</td></tr></tbody></table>';
    const r = X.planPoolChanges(pools, [item('2026-11月 怪物彈珠世代', '2026-11-10', 'honke', html)]);
    assert.deepEqual(r.changes.map((c) => [c.type, c.pool, c.chars]), [
        ['add-version', '世代 2019', ['所羅門', '亞伯']],
        ['add-version', '世代 2018', ['瑪娜', '摩西']]
    ]);
    const P = readPools(r.data);
    assert.deepEqual(poolsForEvent(P, '2026-11月 怪物彈珠世代').map((p) => [p.pool, p.chars]),
        [['世代 2019', ['所羅門', '亞伯']], ['世代 2018', ['瑪娜', '摩西']]]);
    assert.deepEqual(poolsForEvent(P, '2026-11月 怪物彈珠世代 2019 〜所羅門篇〜').map((p) => p.pool), ['世代 2019']);
    assert.deepEqual(poolsForEvent(P, '2026-12月 怪物彈珠世代'), []);
    // 下個月同樣的名單：月份加進同一個版本，這場活動一樣對得到
    const next = X.planPoolChanges(r.data, [item('2026-12月 怪物彈珠世代', '2026-12-10', 'honke', html)]);
    assert.deepEqual(next.changes.map((c) => c.type), ['add-month', 'add-month']);
    assert.equal(poolsForEvent(readPools(next.data), '2026-12月 怪物彈珠世代').length, 2);
    assert.equal(X.planPoolChanges(next.data, [item('2026-12月 怪物彈珠世代', '2026-12-10', 'honke', html)]).changes.length, 0);
});

// ---- 季節限定 (小標題的名單)、新年特別版、複刻的標題 ----
const SEASONAL = `
<p>三位新登場的角色「莫斯科蘿兒α」、「達太喵α」跟「Two for all α」登場！「奈特梅雅α」也來了。</p>
<h4>新系列轉蛋活動</h4>
<h4>新登場角色介紹！</h4>
<h5>★6 演技出色的婚禮之王 達太喵α<br>（獸神化後）</h5>
<h5>★6 爽朗的半獸新娘 莫斯科蘿兒α<br>（獸神化後）</h5>
<h5></h5>
<h5>★6 盛夏的全力偶像 Two for all α<br>（獸神化後）</h5>
<h5>★6 奈特梅雅α：聖誕風格<br>（獸神化後）</h5>
<h5>【新技能登場！】</h5>
<h4>「悄聲接近全新領域的探險貓」偶爾會出現！</h4>
<h5>★6 入迷的喵險家 柯妮修<br>（獸神化後）</h5>`;

test('季節限定：小標題的獸神化後名稱 → 獸神化前的名稱 (用內文「」引用的名稱確認)', () => {
    const lists = X.parseHeadingLists(SEASONAL);
    assert.equal(lists.length, 1);
    assert.equal(lists[0].poolName, '');
    assert.deepEqual(lists[0].names, ['達太喵α', '莫斯科蘿兒α', 'Two for all α', '奈特梅雅α']);
    assert.deepEqual(lists[0].guessed, []);
    // 內文沒有引用的名稱：用最後一段，記成推測的
    const g = X.parseHeadingLists('<h4>新登場角色介紹！</h4><h5>★6 心靈相通的宇宙冒險家 鄭和（獸神化後）</h5>');
    assert.deepEqual([g[0].names, g[0].guessed], [['鄭和'], ['鄭和']]);
    // 有限定角色表的公告不看小標題
    assert.equal(X.extractPoolData(FESTIVAL + SEASONAL).limited.every((l) => !l.fromHeadings), true);
});

test('季節限定：沒有對到既有卡池時，用活動名稱新增限定卡池 (只在那個月)', () => {
    const { readPools, poolsForEvent } = require('../pools.js');
    const r = X.planPoolChanges(POOLS(), [item('2024-06月 祝宴！怪物彈珠新娘 4', '2024-06-02', 'honke', SEASONAL)]);
    assert.deepEqual(r.changes.map((c) => [c.type, c.pool, c.month, c.chars]),
        [['new-limited', '祝宴！怪物彈珠新娘 4', '2024-06', ['達太喵α', '莫斯科蘿兒α', 'Two for all α', '奈特梅雅α']]]);
    const P = readPools(r.data);
    assert.equal(poolsForEvent(P, '2024-06月 祝宴！怪物彈珠新娘 4').length, 1);
    assert.deepEqual(poolsForEvent(P, '2025-06月 祝宴！怪物彈珠新娘 4'), []);
});

test('季節限定復刻：一篇公告好幾個轉蛋，只用活動名稱點名的那個', () => {
    const html = '<p>「瑪爾大α」「格林兄弟α」</p>'
        + '<h4>「復刻！聖誕節 2021」轉蛋活動現身！</h4><h5>★6 飛過夜空的聖誕聖女 瑪爾大α（獸神化後）</h5>'
        + '<h4>「復刻！聖誕節 2019」轉蛋活動現身！</h4><h5>★6 聖誕節冒險譚 格林兄弟α（獸神化・改）</h5>';
    assert.deepEqual(X.parseHeadingLists(html).map((l) => [l.poolName, l.names]),
        [['復刻！聖誕節 2021', ['瑪爾大α']], ['復刻！聖誕節 2019', ['格林兄弟α']]]);
    const r = X.planPoolChanges(POOLS(), [item('2023-12月 復刻！聖誕節 2021', '2023-12-03', 'honke', html)]);
    assert.deepEqual(r.changes.map((c) => [c.type, c.pool, c.chars]), [['new-limited', '復刻！聖誕節 2021', ['瑪爾大α']]]);
});

test('限定角色表頭：前面有文字的「新年特別版「超獸神祭」限定角色」、只寫「限定角色」(卡池名稱看前面的標題)', () => {
    const table = (th, td) => `<table><tbody><tr><th>${th}</th></tr><tr><td>${td}</td></tr></tbody></table>`;
    assert.deepEqual(X.parseLimitedLists(table('新年特別版「超獸神祭」限定角色', '正宗　八雲：荒神之後裔 MV　凜寧')),
        [{ header: '新年特別版「超獸神祭」限定角色', poolName: '超獸神祭', names: ['正宗', '八雲：荒神之後裔 MV', '凜寧'] }]);
    const live = X.parseLimitedLists('<h4>「Zero Gravity LIVE!!」轉蛋活動開幕！</h4>' + table('限定角色', '甘露　告別重力')
        + '<h4>儲值活動</h4>' + table('限定角色', '不相干'));
    assert.deepEqual(live.map((l) => [l.poolName, l.names]), [['Zero Gravity LIVE!!', ['甘露', '告別重力']], ['', ['不相干']]]);
    assert.deepEqual(X.parseLimitedLists(table('額外附贈', '甲　乙')), []);
});

test('活動名稱對不到表頭寫的卡池：這期的版本加上 "=活動名稱"', () => {
    const { readPools, poolsForEvent } = require('../pools.js');
    const pools = POOLS();
    const pool = pools.pools.find((p) => p.kind === 'limited').pool;
    const html = `<table><tbody><tr><th>「${pool}」限定角色</th></tr><tr><td>新角色甲　新角色乙</td></tr></tbody></table>`;
    const r = X.planPoolChanges(pools, [item('2026-07月 世足特別轉蛋', '2026-07-04', 'honke', html)]);
    assert.equal(r.changes.length, 1);
    assert.deepEqual(poolsForEvent(readPools(r.data), '2026-07月 世足特別轉蛋').map((p) => [p.pool, p.chars]), [[pool, ['新角色甲', '新角色乙']]]);
});

test('合作複刻：表格前面寫的第幾彈、其他轉蛋段落的名稱，存成複刻卡池的 label', () => {
    const { readPools, poolsForEvent } = require('../pools.js');
    const rows = (names) => '<table><tbody><tr><th>角色</th><th>稀有度</th><th>屬性</th></tr>'
        + names.map((n) => `<tr><td>${n}</td><td>★6（獸神化前）</td><td>火</td></tr>`).join('') + '</tbody></table>';
    const html = '<h2>轉蛋「測試作品」開跑！</h2><p>▼轉蛋活動期間：<br>10月1日<br>▼第2彈合作活動角色：</p>' + rows(['新甲', '新乙'])
        + '<p>▼第1彈合作活動角色：</p>' + rows(['舊甲', '舊乙'])
        + '<h2>轉蛋「聖誕節 × 測試作品」再度登場！</h2><p>▼轉出對象的合作活動角色：</p>' + rows(['聖誕甲α']);
    const sections = X.parseCollabSections(html);
    assert.deepEqual(sections.map((s) => s.labels), [['第2彈', '第1彈'], ['']]);
    const r = X.planPoolChanges({ pools: [] }, [item('2026-10月 測試作品 第2彈', '2026-10-01', 'collab', html)]);
    assert.deepEqual(r.data.pools.map((p) => [p.pool, p.label || '', p.chars]), [
        ['測試作品', '', ['新甲', '新乙']],
        ['測試作品・複刻 1', '第1彈', ['舊甲', '舊乙']],
        ['測試作品・複刻 2', '聖誕節 × 測試作品', ['聖誕甲α']]
    ]);
    assert.deepEqual(poolsForEvent(readPools(r.data), '2026-10月 測試作品 第2彈').map((p) => p.label), ['', '第1彈', '聖誕節 × 測試作品']);
    // 舊資料的複刻卡池沒有 label：名單相同也補上
    const old = { pools: r.data.pools.map(({ label, ...p }) => p) };
    const again = X.planPoolChanges(old, [item('2026-10月 測試作品 第2彈', '2026-10-01', 'collab', html)]);
    assert.deepEqual(again.changes.map((c) => [c.type, c.label]), [['update-rerun', '第1彈'], ['update-rerun', '聖誕節 × 測試作品']]);
    assert.equal(X.planPoolChanges(again.data, [item('2026-10月 測試作品 第2彈', '2026-10-01', 'collab', html)]).changes.length, 0);
});

test('屬性：五個屬性祭典每一期的名單也補上屬性 (公告沒有用顏色標的新角色)', () => {
    const pools = { pools: [
        { pool: '綠色幻想', kind: 'limited', chars: ['舊木'] },
        { pool: '綠色幻想', kind: 'limited', months: ['2026-08'], chars: ['舊木', 'CALEzMA'] }
    ] };
    const m = X.mergeElements({}, [], pools, {});
    assert.deepEqual(m.elements, { CALEzMA: '木', '舊木': '木' });
    // 機率特別UP 的特別造型可能是別的屬性，不補
    const special = { event: { event: 'E', date: '2026-08-01', source: 'u' }, data: { limited: [{ names: ['舊木', 'CALEzMA'], specials: ['CALEzMA'] }] } };
    assert.deepEqual(X.mergeElements({}, [special], pools, {}).elements, { '舊木': '木' });
});

test('限定角色表前面「機率特別UP角色」裡註明轉出形態的特別造型，也算這期卡池', () => {
    const table = '<table><tbody><tr><th>「世代 2018」限定角色</th></tr><tr><td>瑪娜　摩西</td></tr></tbody></table>';
    const html = '<p>▼轉出機率特別UP角色：<br>瑪娜<br>享受年菜的慈愛天使 瑪娜（只會轉出「獸神化・改」形態）<br>'
        + '團結人心的慈愛天使 瑪娜 MV（只會轉出「獸神化・改」形態）<br>＊（修正說明：）轉出的「團結人心的慈愛天使 瑪娜 MV」為已使用的狀態</p><p>▼限定角色：</p>' + table;
    assert.deepEqual(X.parseLimitedLists(html)[0].names, ['瑪娜', '摩西', '享受年菜的慈愛天使 瑪娜', '團結人心的慈愛天使 瑪娜 MV']);
    assert.deepEqual(X.parseLimitedLists(html)[0].specials, ['享受年菜的慈愛天使 瑪娜', '團結人心的慈愛天使 瑪娜 MV']);
    // 沒有註明形態的不算：屬性祭典的機率 UP 角色、「（聖誕節造型）」這種說明
    const plain = '<p>▼出現機率超UP角色：<br>雪之女王 芙麗茲</p><p>▼出現機率特別UP角色：<br>・弁財天<br>・弁財天（聖誕節造型）</p>' + table;
    assert.deepEqual(X.parseLimitedLists(plain)[0].names, ['瑪娜', '摩西']);
    // 前一張表的機率 UP 名單不會算到下一張表
    const two = html + '<p>▼限定角色：</p>' + table.replace('2018', '2017');
    assert.deepEqual(X.parseLimitedLists(two).map((l) => l.names.length), [4, 2]);
    assert.deepEqual(X.parseLimitedLists('<p>▼轉出機率特別UP角色：<br>惡魔女神 阿波羅（會以獸神化形態轉出）</p>' + table)[0].names, ['瑪娜', '摩西', '惡魔女神 阿波羅']);
    // 說明文字 (「新年造型 潘朵拉」)、表裡已經有的同一隻 (官網漏字) 不加
    const skip = '<p>▼轉出機率特別UP角色：<br>新年造型 潘朵拉（轉出時會以獸神化・改形態現身）<br>開啟天國者 MV（只會轉出「獸神化・改」形態）</p>'
        + table + '<table><tbody><tr><th>轉出對象期間限定角色</th></tr><tr><td>開啟天國者 烏列爾 MV　另一隻</td></tr></tbody></table>';
    assert.deepEqual(X.parseLimitedLists(skip).map((l) => l.names), [['瑪娜', '摩西'], ['開啟天國者 烏列爾 MV', '另一隻']]);
});
