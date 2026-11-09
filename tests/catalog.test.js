// 執行：node --test tests/
// 解析規則要和果實分配 (parseGachaCharacters、CHARACTER_TAG_RE) 一致
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    parseGachaCharacters, stripTag, baseNameOf, buildAliasMap, listAccounts,
    buildCatalog, sortCatalog, filterByQuery, differsByOneCjk, findSimilarNames,
    poolOf, charactersInNotes
} = require('../catalog.js');

const rec = (over) => ({ id: 'r' + Math.random(), date: '2026-01-01', event: '活動A', account: '羽入', pulls: 10, notes: '', tag: 'collab', ...over });

test('解析：角色*數量、頓號分隔', () => {
    assert.deepEqual(parseGachaCharacters('亞森*2、尼奧'), [{ name: '亞森', count: 2 }, { name: '尼奧', count: 1 }]);
});

test('解析：全形逗號、半形逗號、空白、加號分隔', () => {
    const expected = [{ name: '亞森', count: 1 }, { name: '尼奧', count: 1 }, { name: '杏子', count: 1 }];
    for (const s of ['亞森，尼奧，杏子', '亞森,尼奧 杏子', '亞森+尼奧  杏子', '亞森、 尼奧、杏子']) {
        assert.deepEqual(parseGachaCharacters(s), expected, s);
    }
});

test('解析：數量寫法、單獨的 *2、不是角色的項目', () => {
    assert.deepEqual(parseGachaCharacters('亞森 x2'), [{ name: '亞森', count: 2 }]);
    assert.deepEqual(parseGachaCharacters('2新春'), [{ name: '新春', count: 2 }]);
    assert.deepEqual(parseGachaCharacters('杏子α、*2'), [{ name: '杏子α', count: 2 }]);
    assert.deepEqual(parseGachaCharacters('3抽、無、11顆、5'), []);
    assert.deepEqual(parseGachaCharacters('2B'), [{ name: '2B', count: 1 }]);
    assert.deepEqual(parseGachaCharacters(''), []);
    assert.deepEqual(parseGachaCharacters(undefined), []);
});

test('註記：半形、全形括號都拿掉', () => {
    assert.equal(stripTag('虹夏(同族)'), '虹夏');
    assert.equal(stripTag('虹夏（同族）'), '虹夏');
    assert.equal(stripTag('虹夏 (戰型)'), '虹夏');
    assert.equal(stripTag('虹夏(雙削)'), '虹夏');
    assert.equal(stripTag('虹夏(其他)'), '虹夏(其他)');
});

test('編號：虹夏-2、虹夏-3(擊種) 都算虹夏', () => {
    assert.equal(baseNameOf('虹夏-2'), '虹夏');
    assert.equal(baseNameOf('虹夏-3(擊種)'), '虹夏');
    assert.equal(baseNameOf('虹夏'), '虹夏');
});

test('圖鑑：寶珠紀錄被略過', () => {
    const list = buildCatalog([rec({ tag: 'orb', notes: '114顆' }), rec({ tag: 'orb', notes: '虹夏' }), rec({ notes: '尼奧' })]);
    assert.deepEqual(list.map((e) => e.name), ['尼奧']);
    assert.deepEqual(listAccounts([rec({ tag: 'orb', account: '梨花', notes: '1' })]), []);
});

test('圖鑑：同名角色跨帳號、跨活動合併', () => {
    const list = buildCatalog([
        rec({ account: '羽入', event: '活動A', date: '2026-01-01', notes: '虹夏*3、尼奧' }),
        rec({ account: '梨花', event: '活動B', date: '2026-03-01', notes: '虹夏' }),
        rec({ account: '羽入', event: '活動B', date: '2026-03-01', notes: '虹夏(同族)' })
    ]);
    const hong = list.find((e) => e.name === '虹夏');
    assert.equal(hong.total, 5);
    assert.equal(hong.lastDate, '2026-03-01');
    assert.deepEqual(hong.accounts.map((a) => [a.account, a.count]), [['羽入', 4], ['梨花', 1]]);
    assert.deepEqual(hong.accounts[0].entries.map((e) => e.event), ['活動B', '活動A']);
});

test('圖鑑：只看某個帳號、篩選活動類型', () => {
    const records = [
        rec({ account: '羽入', tag: 'honke', notes: '亞森' }),
        rec({ account: '梨花', tag: 'collab', notes: '虹夏' })
    ];
    assert.deepEqual(buildCatalog(records, { account: '梨花' }).map((e) => e.name), ['虹夏']);
    assert.deepEqual(buildCatalog(records, { tags: ['honke'] }).map((e) => e.name), ['亞森']);
    assert.deepEqual(buildCatalog(records, { tags: [] }).length, 2);
});

test('活動別名：舊名稱顯示為新名稱', () => {
    const aliasMap = buildAliasMap([{ event: '2025-03月 新名稱', aliases: ['2024-03月 舊名稱'] }]);
    const [entry] = buildCatalog([rec({ event: '2024-03月 舊名稱', notes: '魯路修' })], { aliasMap });
    assert.equal(entry.accounts[0].entries[0].event, '2025-03月 新名稱');
    // 別名和現存活動同名時不對應
    assert.equal(buildAliasMap([{ event: 'A', aliases: ['B'] }, { event: 'B' }]).size, 0);
});

test('格式不正確的紀錄被略過', () => {
    assert.deepEqual(buildCatalog([null, {}, { notes: 3 }, rec({ notes: '尼奧' })]).map((e) => e.name), ['尼奧']);
});

test('排序與搜尋', () => {
    const list = buildCatalog([
        rec({ date: '2026-01-01', notes: '亞森*5' }),
        rec({ date: '2026-05-01', notes: '尼奧' }),
        rec({ date: '2026-03-01', notes: '杏子*2' })
    ]);
    assert.deepEqual(sortCatalog(list, 'recent').map((e) => e.name), ['尼奧', '杏子', '亞森']);
    assert.deepEqual(sortCatalog(list, 'count').map((e) => e.name), ['亞森', '杏子', '尼奧']);
    assert.deepEqual(filterByQuery(list, ' 杏 ').map((e) => e.name), ['杏子']);
});

test('疑似相同：只差一個中文字', () => {
    assert.equal(differsByOneCjk('羌廆', '羌瘣'), true);
    assert.equal(differsByOneCjk('杏子α', '杏子β'), false);
    assert.equal(differsByOneCjk('杏子', '杏子α'), false);
    assert.equal(differsByOneCjk('虹', '紅'), false);
    assert.equal(differsByOneCjk('羌廆', '羌廆'), false);
    const map = findSimilarNames(['羌廆', '羌瘣', '尼奧']);
    assert.deepEqual(map.get('羌廆'), ['羌瘣']);
    assert.equal(map.has('尼奧'), false);
});

test('卡池標記：限定角色標卡池、合作活動抽到的標活動名稱、常駐角色不標', () => {
    const limitedOf = (name) => (name === '亞森' ? '精選角色 DX' : '');
    const list = buildCatalog([
        rec({ notes: '虹夏*2', event: '孤獨搖滾', tag: 'collab' }),
        rec({ notes: '虹夏', event: '孤獨搖滾', tag: 'collab', account: '小號' }),
        rec({ notes: '虹夏', event: '孤獨搖滾 第二彈', tag: 'collab' }),
        rec({ notes: '哥布林、亞森', event: '激獸神祭', tag: 'honke' })
    ]);
    const of = (name) => poolOf(list.find((e) => e.name === name), limitedOf);
    assert.equal(of('虹夏').kind, 'collab');
    assert.deepEqual([...of('虹夏').pools].sort(), ['孤獨搖滾', '孤獨搖滾 第二彈']);
    assert.equal(of('哥布林'), null);
    assert.deepEqual(of('亞森'), { kind: 'limited', pools: ['精選角色 DX'] });
    assert.equal(poolOf(list.find((e) => e.name === '亞森'), null), null);
});

test('名稱修正：寫錯的名稱合併到正確名稱，記下原名稱', () => {
    const fixes = { 羌廆: '羌瘣' };
    const list = buildCatalog([
        rec({ notes: '羌瘣', date: '2026-01-02' }),
        rec({ notes: '羌廆*2', account: '梨花', date: '2026-01-05' })
    ], { rename: (n) => fixes[n] || n });
    assert.equal(list.length, 1);
    assert.equal(list[0].name, '羌瘣');
    assert.equal(list[0].total, 3);
    assert.equal(list[0].lastDate, '2026-01-05');
    assert.deepEqual(list[0].oldNames, ['羌廆']);
    assert.equal(list[0].accounts.find((a) => a.account === '梨花').entries[0].rawName, '羌廆');
    assert.deepEqual(buildCatalog([rec({ notes: '亞森' })])[0].oldNames, []);
});

test('charactersInNotes：多筆獲得角色合計，拿掉註記與編號並套用名稱修正', () => {
    const fixes = new Map([['棉津見', '綿津見']]);
    const counts = charactersInNotes(['九十九*2、虹夏-2(同族)', '棉津見、50抽', '九十九'], (n) => fixes.get(n) || n);
    assert.deepEqual([...counts], [['九十九', 3], ['虹夏', 1], ['綿津見', 1]]);
    assert.deepEqual([...charactersInNotes([])], []);
});
