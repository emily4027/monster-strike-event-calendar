// 執行：node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { poolKey, readPools, eventMonth, matchingPools, poolsForEvent, buildLimitedLookup, readNameFixes, resolveName, isDistinct, applyNameFix } = require('../pools.js');

const POOLS = readPools(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pools.json'), 'utf8')));
// 活動名稱對到哪些卡池 (不管有沒有那個月的版本)
const namesFor = (event) => [...new Set(matchingPools(POOLS, event).filter((p) => !p.rerun).map((p) => p.pool))];

test('比對鍵：忽略空白、間隔號、全形半形、大小寫、結尾標點', () => {
    assert.equal(poolKey('彩・獸神祭'), poolKey('彩獸神祭'));
    assert.equal(poolKey('Midnight Party'), poolKey('MIDNIGHT PARTY'));
    assert.equal(poolKey('伊波妮＆艾波莉'), poolKey('伊波妮&艾波莉'));
    assert.equal(poolKey('惠比天少女組。'), poolKey('惠比天少女組'));
    assert.equal(poolKey('超狂的女高中生們，'), poolKey('超狂的女高中生們'));
});

test('pools.json：格式正確，每個卡池都有角色', () => {
    assert.ok(POOLS.length >= 16);
    POOLS.forEach((p) => {
        assert.ok(p.chars.length > 0, p.pool);
        assert.ok(p.match.length > 0, p.pool);
    });
});

test('活動 → 卡池：抽卡統計實際的活動名稱', () => {
    assert.deepEqual(namesFor('2025-10月 激獸神祭'), ['激獸神祭']);
    assert.deepEqual(namesFor('2025-09月 激獸神祭 (厄莉絲)'), ['激獸神祭']);
    assert.deepEqual(namesFor('2026-01月 激獸神祭24%'), ['激獸神祭']);
    assert.deepEqual(namesFor('2026-01月 新年特別版「超獸神祭」 (凜寧)'), ['超獸神祭']);
    assert.deepEqual(namesFor('2026-08月 彩・獸神祭'), ['彩獸神祭']);
    assert.deepEqual(namesFor('2023-11月 火祭 火焰之星'), ['火焰之星']);
    assert.deepEqual(namesFor('2025-05月 木季 綠色幻想 (艾特華爾)'), ['綠色幻想']);
    assert.deepEqual(namesFor('2026-07月 怪物彈珠精選角色DX～亞森篇〜'), ['怪物彈珠精選角色 DX']);
    assert.deepEqual(namesFor('2026-07月 怪物彈珠世代2019〜所羅門篇〜'), ['怪物彈珠世代 2019']);
    assert.deepEqual(namesFor('2023-10月 週年2016世代池'), ['怪物彈珠世代 2016']);
    assert.deepEqual(namesFor('2024-09月 怪物彈珠世代 2013＆2014＆2017 (烏列爾、諾斯特拉達姆斯)'),
        ['怪物彈珠世代 2013＆2014', '怪物彈珠世代 2017', '怪物彈珠世代 2013＆2014＆2017']);
    assert.deepEqual(namesFor('2025-06月 綠色幻想×MIDNIGHT PARTY×藥師少女的獨語'), ['藥師少女的獨語', '綠色幻想', 'Midnight Party']);
    assert.deepEqual(namesFor('2026-11月 藍色監獄'), ['藍色監獄']);
    assert.deepEqual(namesFor('2026-03月 可用特玉抽！全明星大集合感謝轉蛋'), []);
    assert.deepEqual(namesFor(''), []);
});

test('合作卡池：同一作品的不同彈用年月區分，合作祭典同時列出限定卡池', () => {
    assert.deepEqual(namesFor('2026-07月 咒術迴戰'), ['咒術迴戰 第3彈']);
    assert.deepEqual(namesFor('2024-01月 咒術迴戰 & STARLIGHT MIRAGE×劇場版 咒術迴戰 0'), ['咒術迴戰 第2彈', 'Starlight Mirage']);
    assert.deepEqual(namesFor('2024-07月 【我推的孩子】'), ['【我推的孩子】']);
    assert.deepEqual(namesFor('2026-02月 【我推的孩子】第二彈'), ['【我推的孩子】第2彈']);
    assert.deepEqual(namesFor('2024-04月 激獸神祭×葬送的芙莉蓮'), ['葬送的芙莉蓮', '激獸神祭']);
    assert.deepEqual(namesFor('2026-01月 葬送的芙莉蓮第二彈'), ['葬送的芙莉蓮 第2彈']);
    assert.deepEqual(namesFor('2025-10月 超獸神祭×鬼滅之刃'), ['鬼滅之刃 第4彈', '超獸神祭']);
    assert.deepEqual(namesFor('2024-06月 怪獸８號'), ['怪獸８號']);
    assert.deepEqual(namesFor('2026-08月 香格里拉・開拓異境'), ['香格里拉・開拓異境']);
});

test('活動 → 卡池：合作卡池排在限定卡池前面；match 用 + 表示全部都要有', () => {
    const pools = readPools({ pools: [
        { pool: '超獸神祭', kind: 'limited', months: ['2025-10'], chars: ['正宗'] },
        { pool: '鬼滅之刃', kind: 'collab', chars: ['竈門炭治郎'] },
        { pool: '世代 2015', kind: 'limited', match: ['世代+2015'], chars: ['卑彌呼'] }
    ] });
    assert.deepEqual(poolsForEvent(pools, '2025-10月 超獸神祭×鬼滅之刃').map((p) => p.pool), ['鬼滅之刃', '超獸神祭']);
    assert.deepEqual(poolsForEvent(pools, '2015 年回顧').map((p) => p.pool), []);
});

test('readPools：格式不正確的卡池與角色被略過', () => {
    const pools = readPools({ pools: [
        { pool: 'A', kind: 'limited', chars: ['x', '', 3, ' y '] },
        { pool: 'B', kind: 'other', chars: ['z'] },
        { pool: 'C', chars: 'z' },
        null
    ] });
    assert.deepEqual(pools.map((p) => [p.pool, p.chars]), [['A', ['x', 'y']]]);
    assert.deepEqual(readPools(null), []);
});

test('限定角色查詢：官網名稱和抽卡紀錄寫法差在符號也認得', () => {
    const limitedOf = buildLimitedLookup(POOLS);
    assert.equal(limitedOf('阿露卡'), '激獸神祭');
    assert.equal(limitedOf('惠比天少女組'), '綠色幻想');
    assert.equal(limitedOf('傑奇＆海德'), '怪物彈珠世代 2015');
    assert.equal(limitedOf('妮奧'), '怪物彈珠精選角色 DX');
    assert.equal(limitedOf('尼奧'), '');
    assert.equal(limitedOf('新春・亞森'), '');
});

test('水祭：舊的水屬性祭典名稱也對到水之遊宴', () => {
    assert.deepEqual(namesFor('2024-07月 水祭 Zero Gravity LIVE!! (告別重力)'), ['水之遊宴']);
});

const charsFor = (event, pool) => (poolsForEvent(POOLS, event).find((p) => p.pool === pool) || {}).chars || [];

test('活動年月：從活動名稱開頭取出', () => {
    assert.equal(eventMonth('2026-11月 彩獸神祭'), '2026-11');
    assert.equal(eventMonth('2024-1月 激獸神祭'), '2024-01');
    assert.equal(eventMonth('彩獸神祭'), '');
});

test('卡池版本：每期活動用那期公告的角色；沒有那個月的版本時不顯示', () => {
    assert.deepEqual(charsFor('2026-11月 彩獸神祭', '彩獸神祭'), ['卡蜜菈', '九十九', '馬克士威']);
    assert.deepEqual(charsFor('2026-08月 彩・獸神祭', '彩獸神祭'), ['卡蜜菈', '九十九']);
    assert.ok(charsFor('2026-10月 超獸神祭', '超獸神祭').includes('卡古雅'));
    assert.deepEqual(charsFor('2026-12月 超獸神祭', '超獸神祭'), []);   // 不沿用 2026-10 的名單
    assert.ok(charsFor('2026-11月 綠色幻想', '綠色幻想').includes('CALEzMA'));
    assert.ok(charsFor('2026-07月 怪物彈珠精選角色DX～亞森篇〜', '怪物彈珠精選角色 DX').includes('新年怪盜亞森：羽根突模式'));
    // 同一個卡池只會出現一次
    assert.deepEqual(namesFor('2026-11月 彩獸神祭'), ['彩獸神祭']);
});

test('卡池版本：只用 months 含有活動年月的版本，不沿用別期；預設版本不用在活動上', () => {
    const pools = readPools({ pools: [
        { pool: 'A祭', kind: 'limited', chars: ['基本'] },
        { pool: 'A祭', kind: 'limited', months: ['2026-03', '2026-05'], chars: ['三月'] },
        { pool: 'A祭', kind: 'limited', months: ['2026-08'], chars: ['八月'] },
        { pool: 'B祭', kind: 'limited', since: '2026-05', chars: ['舊格式'] },
        { pool: 'C祭', kind: 'limited', months: ['20260'], chars: ['格式錯誤'] }
    ] });
    const of = (event) => poolsForEvent(pools, event).map((p) => p.chars[0]);
    assert.deepEqual(of('2026-03月 A祭'), ['三月']);
    assert.deepEqual(of('2026-05月 A祭'), ['三月']);
    assert.deepEqual(of('2026-08月 A祭'), ['八月']);
    assert.deepEqual(of('2026-04月 A祭'), []);
    assert.deepEqual(of('2026-12月 A祭'), []);
    assert.deepEqual(of('A祭'), []);
    assert.deepEqual(of('2026-05月 B祭'), ['舊格式']);
    assert.deepEqual(of('2026-06月 B祭'), []);
    assert.deepEqual(of('2026-06月 C祭'), []);
});

test('限定角色查詢：新版本才加入的角色也認得', () => {
    const limitedOf = buildLimitedLookup(POOLS);
    assert.equal(limitedOf('馬克士威'), '彩獸神祭');
    assert.equal(limitedOf('卡古雅'), '超獸神祭');
    assert.equal(limitedOf('CALEzMA'), '綠色幻想');
});

// ---- 名稱修正 (shared/characters) ----
test('名稱修正：讀取、連續修正、繞回自己時停在原名', () => {
    const fixes = readNameFixes({
        renames: [{ from: '羌廆', to: '羌瘣' }, { from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'X', to: 'Y' }, { from: 'Y', to: 'X' },
            { from: '', to: 'Z' }, { from: 'Q', to: 'Q' }, null],
        distinct: [{ a: '杏子', b: '杏仁' }, { a: '同', b: '同' }]
    });
    assert.equal(resolveName(fixes, '羌廆'), '羌瘣');
    assert.equal(resolveName(fixes, '羌瘣'), '羌瘣');
    assert.equal(resolveName(fixes, 'A'), 'C');
    assert.equal(resolveName(fixes, 'X'), 'X');
    assert.equal(fixes.renames.has('Q'), false);
    assert.equal(isDistinct(fixes, '杏仁', '杏子'), true);
    assert.equal(isDistinct(fixes, '同', '同'), false);
    assert.equal(resolveName(readNameFixes(null), '亞森'), '亞森');
});

test('名稱修正：新增、覆蓋、取消', () => {
    let data = applyNameFix({}, { type: 'rename', from: ' 羌廆 ', to: '羌瘣' });
    assert.deepEqual(data.renames, [{ from: '羌廆', to: '羌瘣' }]);
    data = applyNameFix(data, { type: 'rename', from: '羌廆', to: '羌瘣２' });
    assert.deepEqual(data.renames, [{ from: '羌廆', to: '羌瘣２' }]);
    data = applyNameFix(data, { type: 'unrename', from: '羌廆' });
    assert.deepEqual(data.renames, []);
});

test('名稱修正：空白、改成自己、形成循環會被擋下', () => {
    assert.throws(() => applyNameFix({}, { type: 'rename', from: 'A', to: ' ' }), /空白/);
    assert.throws(() => applyNameFix({}, { type: 'rename', from: 'A', to: 'A' }), /一樣/);
    const data = applyNameFix({}, { type: 'rename', from: 'A', to: 'B' });
    assert.throws(() => applyNameFix(data, { type: 'rename', from: 'B', to: 'A' }), /繞回/);
    assert.throws(() => applyNameFix({}, { type: 'distinct', a: 'A', b: 'A' }), /不同的名稱/);
    assert.throws(() => applyNameFix({}, { type: 'oops' }));
});

test('名稱修正：不同角色的標記可以新增、取消；合併兩個名稱時拿掉標記', () => {
    let data = applyNameFix({}, { type: 'distinct', a: '杏子', b: '杏仁' });
    data = applyNameFix(data, { type: 'distinct', a: '杏仁', b: '杏子' });
    assert.deepEqual(data.distinct, [{ a: '杏仁', b: '杏子' }]);
    assert.equal(isDistinct(readNameFixes(data), '杏子', '杏仁'), true);
    const merged = applyNameFix(data, { type: 'rename', from: '杏仁', to: '杏子' });
    assert.deepEqual(merged.distinct, []);
    assert.deepEqual(applyNameFix(data, { type: 'undistinct', a: '杏子', b: '杏仁' }).distinct, []);
});

test('限定角色查詢：預設版本 (官網名單) 優先，since 版本裡別的祭典的角色不會被標錯', () => {
    const pools = readPools({ pools: [
        { pool: '激獸神祭', kind: 'limited', months: ['2023-09'], chars: ['惠比壽', '新角色乙'] },
        { pool: '激獸神祭', kind: 'limited', chars: ['阿露卡'] },
        { pool: '火焰之星', kind: 'limited', chars: ['惠比壽'] },
        { pool: '世代', kind: 'limited', months: ['2023-01'], chars: ['新角色甲', '一', '二', '三'] },
        { pool: '彩獸神祭', kind: 'limited', months: ['2023-01'], chars: ['新角色甲'] }
    ] });
    const limitedOf = buildLimitedLookup(pools);
    assert.equal(limitedOf('惠比壽'), '火焰之星');
    assert.equal(limitedOf('新角色乙'), '激獸神祭');
    assert.equal(limitedOf('新角色甲'), '彩獸神祭');   // 同時出現時名單短的優先
});

test('複刻卡池的 label：讀進來，沒有時是空字串', () => {
    const { readPools } = require('../pools.js');
    const P = readPools({ pools: [
        { pool: 'A・複刻 1', kind: 'collab', rerun: true, label: ' 第1彈 ', chars: ['x'] },
        { pool: 'A', kind: 'collab', chars: ['y'] }
    ] });
    assert.deepEqual(P.map((p) => p.label), ['第1彈', '']);
});
